import { Transform } from "assemblyscript/dist/transform.js";
import {
  CommonFlags,
  Node,
  Parser,
  SourceKind,
  Source,
  Tokenizer,
} from "assemblyscript/dist/assemblyscript.js";
import { CoverageTransform } from "./coverage.js";
import { MockTransform } from "./mock.js";
import { LocationTransform } from "./location.js";
import { LogTransform } from "./log.js";
import { isStdlib } from "./util.js";

export default class Transformer extends Transform {
  // Trigger the transform after parse.
  afterParse(parser: Parser): void {
    // Create new transform
    const mock = new MockTransform();
    const coverage = new CoverageTransform();
    const location = new LocationTransform();
    const log = new LogTransform(parser);

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
    const entryFile = sources.find(
      (v) => v.sourceKind == SourceKind.UserEntry,
    ).simplePath;
    // Loop over every source
    for (const source of sources) {
      const shouldInjectRunCall =
        source.sourceKind == SourceKind.UserEntry &&
        shouldAutoInjectRun(source.text);

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
      coverage.visit(source);
      location.visit(source);
      log.visit(source);
      if (shouldInjectRunCall) {
        const runImportPath = detectRunImportPath(source.text);
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
      if (coverage.globalStatements.length) {
        source.statements.unshift(...coverage.globalStatements);
        const tokenizer = new Tokenizer(
          new Source(
            SourceKind.User,
            source.normalizedPath,
            'import { __REGISTER, __COVER } from "as-test/assembly/coverage";',
          ),
        );
        parser.currentSource = tokenizer.source;
        source.statements.unshift(parser.parseTopLevelStatement(tokenizer)!);
        parser.currentSource = source;
      }
    }
    coverage.globalStatements = [];
  }
}

function shouldAutoInjectRun(sourceText: string): boolean {
  const text = stripComments(sourceText);
  const hasSuiteCalls = /\b(?:describe|test|it)\s*\(/.test(text);
  if (!hasSuiteCalls) return false;
  const runAlias = detectRunAlias(text);
  if (runAlias && new RegExp(`\\b${escapeRegex(runAlias)}\\s*\\(`).test(text)) {
    return false;
  }
  const hasRunCall = /\brun\s*\(/.test(text);
  return !hasRunCall;
}

function detectRunImportPath(sourceText: string): string | null {
  const text = stripComments(sourceText);
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

function detectRunAlias(sourceText: string): string | null {
  const text = stripComments(sourceText);
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
  return /\b(?:describe|test|it|expect|beforeAll|afterAll|beforeEach|afterEach|mockFn|mockImport|log|run)\b/.test(
    specifiers,
  );
}

function stripComments(sourceText: string): string {
  return sourceText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
