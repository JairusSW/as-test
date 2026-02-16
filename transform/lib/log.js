import { Node, Source, Tokenizer, } from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";
import { toString } from "./util.js";
const LOG_VALUE_FN = "__as_test_log_value";
const LOG_CALL_FN = "__as_test_log_call";
const LOG_ENABLED_IMPORT = "__as_test_log_is_enabled_internal";
const LOG_SERIALIZED_IMPORT = "__as_test_log_serialized_internal";
const LOG_DEFAULT_IMPORT = "__as_test_log_default_internal";
export class LogTransform extends Visitor {
    parser;
    activeSource = null;
    touchedSource = null;
    hasLogCalls = false;
    classNames = [];
    constructor(parser) {
        super();
        this.parser = parser;
    }
    visitSource(node) {
        if (!isUserSource(node))
            return;
        this.activeSource = node;
        this.touchedSource = node;
        this.hasLogCalls = false;
        this.classNames = [];
        super.visitSource(node);
        if (!this.hasLogCalls) {
            this.activeSource = null;
            this.touchedSource = null;
            return;
        }
        const asTestPath = detectAsTestImportPath(node.text) ?? "as-test";
        const tokenizer = new Tokenizer(new Source(0, node.normalizedPath, `import { __as_test_log_is_enabled as ${LOG_ENABLED_IMPORT}, __as_test_log_serialized as ${LOG_SERIALIZED_IMPORT}, __as_test_log_default as ${LOG_DEFAULT_IMPORT} } from "${asTestPath}";`));
        this.parser.currentSource = tokenizer.source;
        node.statements.unshift(this.parser.parseTopLevelStatement(tokenizer));
        this.parser.currentSource = node;
        const jsonTokenizer = new Tokenizer(new Source(0, node.normalizedPath, `import { JSON } from "json-as";`));
        this.parser.currentSource = jsonTokenizer.source;
        node.statements.unshift(this.parser.parseTopLevelStatement(jsonTokenizer));
        this.parser.currentSource = node;
        const classFallbackLines = this.classNames
            .map((className) => `if (idof<nonnull<T>>() == idof<${className}>()) return JSON.stringify<${className}>(changetype<${className}>(value));`)
            .join(" ");
        const genericTokenizer = new Tokenizer(new Source(0, node.normalizedPath, `function ${LOG_VALUE_FN}<T>(value: T): string { const formatted = ${LOG_DEFAULT_IMPORT}<T>(value); if (formatted != "none") return formatted; if (isReference<T>()) { ${classFallbackLines} } return formatted; }`));
        this.parser.currentSource = genericTokenizer.source;
        node.statements.push(this.parser.parseTopLevelStatement(genericTokenizer));
        this.parser.currentSource = node;
        const callTokenizer = new Tokenizer(new Source(0, node.normalizedPath, `function ${LOG_CALL_FN}<T>(value: T): void { if (!${LOG_ENABLED_IMPORT}()) return; ${LOG_SERIALIZED_IMPORT}(${LOG_VALUE_FN}(value)); }`));
        this.parser.currentSource = callTokenizer.source;
        node.statements.push(this.parser.parseTopLevelStatement(callTokenizer));
        this.parser.currentSource = node;
        this.activeSource = null;
        this.touchedSource = null;
    }
    visitCallExpression(node) {
        super.visitCallExpression(node);
        if (!this.activeSource || this.touchedSource !== this.activeSource)
            return;
        if (toString(node.expression) !== "log")
            return;
        if (node.args.length !== 1)
            return;
        const arg = node.args[0];
        node.expression = Node.createIdentifierExpression(LOG_CALL_FN, node.expression.range);
        node.args[0] = arg;
        this.hasLogCalls = true;
    }
    visitClassDeclaration(node, isDefault = false) {
        super.visitClassDeclaration(node, isDefault);
        if (!this.activeSource || this.touchedSource !== this.activeSource)
            return;
        if (!node.name)
            return;
        if (node.flags & 32768)
            return;
        if (node.decorators?.some((decorator) => isDecoratorNamed(decorator, "json")))
            return;
        if (node.decorators?.some((decorator) => isDecoratorNamed(decorator, "unmanaged")))
            return;
        const className = node.name.text;
        if (!this.classNames.includes(className)) {
            this.classNames.push(className);
        }
        const decorators = node.decorators ? [...node.decorators] : [];
        decorators.unshift(Node.createDecorator(Node.createIdentifierExpression("json", node.range), [], node.range));
        node.decorators = decorators;
    }
}
function isUserSource(source) {
    return (source.sourceKind === 0 ||
        source.sourceKind === 1);
}
function isDecoratorNamed(node, name) {
    return toString(node.name) === name;
}
function detectAsTestImportPath(sourceText) {
    const text = stripComments(sourceText);
    const imports = text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g);
    for (const match of imports) {
        const specifiers = match[1] ?? "";
        const modulePath = (match[2] ?? "").trim();
        if (!modulePath.length)
            continue;
        if (looksLikeAsTestImport(specifiers, modulePath)) {
            return modulePath;
        }
    }
    return null;
}
function looksLikeAsTestImport(specifiers, modulePath) {
    if (modulePath === "as-test" || modulePath.endsWith("/as-test"))
        return true;
    return /\b(?:describe|test|it|expect|beforeAll|afterAll|beforeEach|afterEach|mockFn|mockImport|log|run)\b/.test(specifiers);
}
function stripComments(sourceText) {
    return sourceText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
//# sourceMappingURL=log.js.map