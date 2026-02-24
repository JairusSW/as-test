import {
  CallExpression,
  Node,
  Parser,
  Source,
  SourceKind,
  Tokenizer,
} from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";
import { toString } from "./util.js";

const LOG_CALL_FN = "__as_test_log_call";
const LOG_ENABLED_IMPORT = "__as_test_log_is_enabled_internal";
const LOG_SERIALIZED_IMPORT = "__as_test_log_serialized_internal";
const LOG_DEFAULT_IMPORT = "__as_test_log_default_internal";

export class LogTransform extends Visitor {
  private activeSource: Source | null = null;
  private touchedSource: Source | null = null;
  private hasLogCalls: boolean = false;

  constructor(private parser: Parser) {
    super();
  }

  visitSource(node: Source): void {
    if (!isUserSource(node)) return;

    this.activeSource = node;
    this.touchedSource = node;
    this.hasLogCalls = false;
    super.visitSource(node);

    if (!this.hasLogCalls) {
      this.activeSource = null;
      this.touchedSource = null;
      return;
    }

    const asTestPath = detectAsTestImportPath(node.text) ?? "as-test";
    const tokenizer = new Tokenizer(
      new Source(
        SourceKind.User,
        node.normalizedPath,
        `import { __as_test_log_is_enabled as ${LOG_ENABLED_IMPORT}, __as_test_log_serialized as ${LOG_SERIALIZED_IMPORT}, __as_test_log_default as ${LOG_DEFAULT_IMPORT} } from "${asTestPath}";`,
      ),
    );
    this.parser.currentSource = tokenizer.source;
    node.statements.unshift(this.parser.parseTopLevelStatement(tokenizer)!);
    this.parser.currentSource = node;

    const callTokenizer = new Tokenizer(
      new Source(
        SourceKind.User,
        node.normalizedPath,
        `function ${LOG_CALL_FN}<T>(value: T): void { if (!${LOG_ENABLED_IMPORT}()) return; ${LOG_SERIALIZED_IMPORT}(${LOG_DEFAULT_IMPORT}<T>(value)); }`,
      ),
    );
    this.parser.currentSource = callTokenizer.source;
    node.statements.push(this.parser.parseTopLevelStatement(callTokenizer)!);
    this.parser.currentSource = node;

    this.activeSource = null;
    this.touchedSource = null;
  }

  visitCallExpression(node: CallExpression): void {
    super.visitCallExpression(node);
    if (!this.activeSource || this.touchedSource !== this.activeSource) return;
    if (toString(node.expression) !== "log") return;
    if (node.args.length !== 1) return;

    const arg = node.args[0];
    node.expression = Node.createIdentifierExpression(
      LOG_CALL_FN,
      node.expression.range,
    );
    node.args[0] = arg;
    this.hasLogCalls = true;
  }
}

function isUserSource(source: Source): boolean {
  return (
    source.sourceKind === SourceKind.User ||
    source.sourceKind === SourceKind.UserEntry
  );
}

function detectAsTestImportPath(sourceText: string): string | null {
  const text = stripComments(sourceText);
  const imports = text.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
  );
  for (const match of imports) {
    const specifiers = match[1] ?? "";
    const modulePath = (match[2] ?? "").trim();
    if (!modulePath.length) continue;
    if (looksLikeAsTestImport(specifiers, modulePath)) {
      return modulePath;
    }
  }
  return null;
}

function looksLikeAsTestImport(
  specifiers: string,
  modulePath: string,
): boolean {
  if (modulePath === "as-test" || modulePath.endsWith("/as-test")) return true;
  return /\b(?:describe|test|it|expect|beforeAll|afterAll|beforeEach|afterEach|mockFn|unmockFn|mockImport|unmockImport|snapshotImport|restoreImport|log|run)\b/.test(
    specifiers,
  );
}

function stripComments(sourceText: string): string {
  return sourceText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
