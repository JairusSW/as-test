import { Transform } from "assemblyscript/dist/transform.js";
import {
  CommonFlags,
  LiteralKind,
  Node,
  Parser,
  SourceKind,
  Source,
  StringLiteralExpression,
  Tokenizer,
  VariableDeclaration,
  VariableStatement,
} from "assemblyscript/dist/assemblyscript.js";
import { CoverageTransform } from "./coverage.js";
import { MockTransform } from "./mock.js";
import { LocationTransform } from "./location.js";
import { LogTransform } from "./log.js";
import { EqualsTransform } from "./equals.js";
import { isStdlib } from "./util.js";
import { NodeKind } from "./types.js";

export default class Transformer extends Transform {
  // Trigger the transform after parse.
  afterParse(parser: Parser): void {
    patchModeName(parser, process.env.AS_TEST_MODE_NAME ?? "default");

    // Create new transforms
    const mock = new MockTransform();
    const location = new LocationTransform();
    const log = new LogTransform(parser);
    const coverage = isCoverageEnabled() ? new CoverageTransform() : null;

    // Sort the sources so that user scripts are visited last
    const sources = parser.sources
      .filter((source) => !isStdlib(source))
      .sort((_a, _b) => {
        const a = _a.internalPath;
        const b = _b.internalPath;
        if (a[0] === "~" && b[0] !== "~") {
          return -1;
        } else if (a[0] !== "~" && b[0] === "~") {
          return 1;
        } else {
          return 0;
        }
      });
    const entrySource = sources.find(
      (v) => v.sourceKind == SourceKind.UserEntry,
    );
    const entryFile = entrySource
      ? entrySource.normalizedPath.replace(/\.ts$/, "")
      : "unknown";

    // Gather mocked import targets across all sources before transform rewrite pass.
    const mockedImportTargets = collectMockImportTargets(sources);
    for (const target of mockedImportTargets) {
      mock.importMocked.add(target);
    }
    // Imports that are unmocked somewhere keep their real binding so the
    // unmocked call falls back to it; imports that are only ever mocked have
    // their real import removed entirely.
    const unmockedImportTargets = collectUnmockImportTargets(sources);
    for (const target of unmockedImportTargets) {
      mock.importUnmocked.add(target);
    }

    // Loop over every source
    for (const source of sources) {
      const sourceInfo = analyzeSourceText(source.text);
      const shouldInjectRunCall =
        source.sourceKind == SourceKind.UserEntry &&
        sourceInfo.hasSuiteCalls &&
        !sourceInfo.hasRunCall;

      const node = Node.createVariableStatement(
        null,
        [
          Node.createVariableDeclaration(
            Node.createIdentifierExpression("ENTRY_FILE", source.range),
            null,
            CommonFlags.Const,
            null,
            Node.createStringLiteralExpression(entryFile + ".ts", source.range),
            source.range,
          ),
        ],
        source.range,
      );
      source.statements.unshift(node);

      mock.visit(source);
      if (coverage) {
        coverage.visit(source);
      }
      if (sourceInfo.hasExpectCall) {
        location.visit(source);
      }
      if (sourceInfo.hasLogCall) {
        log.visit(source);
      }

      if (shouldInjectRunCall) {
        const runImportPath = sourceInfo.runImportPath;
        let runCall = "run();";
        if (runImportPath) {
          const autoImport = new Tokenizer(
            new Source(
              SourceKind.User,
              source.normalizedPath,
              `import { run as __as_test_auto_run } from "${runImportPath}";`,
            ),
          );
          parser.currentSource = autoImport.source;
          source.statements.unshift(parser.parseTopLevelStatement(autoImport)!);
          runCall = "__as_test_auto_run();";
        }
        const autoCall = new Tokenizer(
          new Source(SourceKind.User, source.normalizedPath, runCall),
        );
        parser.currentSource = autoCall.source;
        source.statements.push(parser.parseTopLevelStatement(autoCall)!);
        parser.currentSource = source;
      }
      if (coverage && coverage.globalStatements.length) {
        source.statements.unshift(...coverage.globalStatements);
        const tokenizer = new Tokenizer(
          new Source(
            SourceKind.User,
            source.normalizedPath,
            'import { __REGISTER_RAW, __COVER } from "as-test/assembly/coverage";',
          ),
        );
        parser.currentSource = tokenizer.source;
        source.statements.unshift(parser.parseTopLevelStatement(tokenizer)!);
        parser.currentSource = source;
        coverage.globalStatements = [];
      }
    }
    if (coverage) {
      coverage.globalStatements = [];
    }

    // Inject `__as_test_equals(other, strict)` on every class that shows up
    // as an expect()/matcher operand (or is reachable from one via field
    // types). Runs after the per-source visitors so any earlier rewrites
    // are visible to the candidate scan.
    new EqualsTransform(parser).apply(parser.sources);
  }
}

// Replaces the initializer of `export const AS_TEST_MODE_NAME` in as-test's
// `assembly/src/mode.ts` with a string literal of the current build mode.
// AS lacks --use support for strings, so the value is baked into the AST here.
function patchModeName(parser: Parser, modeName: string): void {
  for (const source of parser.sources) {
    if (!source.normalizedPath.endsWith("assembly/src/mode.ts")) continue;
    for (const stmt of source.statements) {
      if (stmt.kind !== NodeKind.Variable) continue;
      const decls = (stmt as VariableStatement).declarations;
      for (const decl of decls as VariableDeclaration[]) {
        if (decl.name.text !== "AS_TEST_MODE_NAME") continue;
        if (!decl.initializer) continue;
        if (decl.initializer.kind !== NodeKind.Literal) continue;
        const literal = decl.initializer as StringLiteralExpression;
        if (literal.literalKind !== LiteralKind.String) continue;
        literal.value = modeName;
        return;
      }
    }
  }
}

function collectMockImportTargets(sources: Source[]): Set<string> {
  return collectImportTargets(sources, /\bmockImport\s*\(\s*["']([^"']+)["']/g);
}

function collectUnmockImportTargets(sources: Source[]): Set<string> {
  return collectImportTargets(
    sources,
    /\bunmockImport\s*\(\s*["']([^"']+)["']/g,
  );
}

function collectImportTargets(sources: Source[], pattern: RegExp): Set<string> {
  const out = new Set<string>();
  for (const source of sources) {
    const text = stripComments(source.text);
    for (const match of text.matchAll(pattern)) {
      const target = (match[1] ?? "").trim();
      if (!target.length) continue;
      out.add(target);
    }
  }
  return out;
}

type SourceInfo = {
  hasSuiteCalls: boolean;
  hasRunCall: boolean;
  runImportPath: string | null;
  hasMockCalls: boolean;
  hasLogCall: boolean;
  hasExpectCall: boolean;
};

function analyzeSourceText(sourceText: string): SourceInfo {
  const text = stripComments(sourceText);
  const runImportPath = detectRunImportPath(text);
  const runAlias = detectRunAlias(text);
  const hasRunCall = runAlias
    ? new RegExp(`\\b${escapeRegex(runAlias)}\\s*\\(`).test(text)
    : false;
  return {
    // The `x?` variants (xdescribe/xtest/xit/xonly/xfuzz) must count as suite
    // calls too: a file whose only suites are skipped still needs `run()`
    // injected so it reports itself as skipped instead of emitting no frames
    // (which the CLI would otherwise see as a runtime crash).
    hasSuiteCalls: /\b(?:x?describe|x?test|x?it|x?only|todo|x?fuzz)\s*\(/.test(
      text,
    ),
    hasRunCall,
    runImportPath,
    hasMockCalls: /\b(?:mockFn|unmockFn|mockImport|unmockImport)\s*\(/.test(
      text,
    ),
    hasLogCall: /\blog\s*\(/.test(text),
    hasExpectCall: /\bexpect\s*\(/.test(text),
  };
}

function detectRunImportPath(text: string): string | null {
  const imports = text.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
  );
  for (const match of imports) {
    const specifiers = match[1] ?? "";
    if (!looksLikeAsTestImport(specifiers)) continue;
    const modulePath = (match[2] ?? "").trim();
    if (modulePath.length) return modulePath;
  }
  return null;
}

function detectRunAlias(text: string): string | null {
  const imports = text.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
  );
  for (const match of imports) {
    const specifiers = match[1] ?? "";
    if (!looksLikeAsTestImport(specifiers)) continue;
    const runAlias = specifiers.match(/\brun\b(?:\s+as\s+([A-Za-z_$][\w$]*))?/);
    if (runAlias) {
      return runAlias[1] ?? "run";
    }
  }
  return null;
}

function looksLikeAsTestImport(specifiers: string): boolean {
  return /\b(?:x?describe|x?test|x?it|x?only|todo|x?fuzz|expect|beforeAll|afterAll|beforeEach|afterEach|mockFn|unmockFn|mockImport|unmockImport|snapshotFn|log|run)\b/.test(
    specifiers,
  );
}

function stripComments(sourceText: string): string {
  return sourceText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCoverageEnabled(): boolean {
  return process.env.AS_TEST_COVERAGE_ENABLED !== "0";
}
