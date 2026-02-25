import { Transform } from "assemblyscript/dist/transform.js";
import { Node, Source, Tokenizer, } from "assemblyscript/dist/assemblyscript.js";
import { CoverageTransform } from "./coverage.js";
import { MockTransform } from "./mock.js";
import { LocationTransform } from "./location.js";
import { LogTransform } from "./log.js";
import { isStdlib } from "./util.js";
export default class Transformer extends Transform {
    afterParse(parser) {
        const mock = new MockTransform();
        const location = new LocationTransform();
        const log = new LogTransform(parser);
        const coverage = isCoverageEnabled() ? new CoverageTransform() : null;
        const sources = parser.sources
            .filter((source) => !isStdlib(source))
            .sort((_a, _b) => {
            const a = _a.internalPath;
            const b = _b.internalPath;
            if (a[0] === "~" && b[0] !== "~") {
                return -1;
            }
            else if (a[0] !== "~" && b[0] === "~") {
                return 1;
            }
            else {
                return 0;
            }
        });
        const entryFile = sources.find((v) => v.sourceKind == 1).simplePath;
        const mockedImportTargets = collectMockImportTargets(sources);
        for (const target of mockedImportTargets) {
            mock.importMocked.add(target);
        }
        for (const source of sources) {
            const sourceInfo = analyzeSourceText(source.text);
            const shouldInjectRunCall = source.sourceKind == 1 &&
                sourceInfo.hasSuiteCalls &&
                !sourceInfo.hasRunCall;
            const node = Node.createVariableStatement(null, [
                Node.createVariableDeclaration(Node.createIdentifierExpression("ENTRY_FILE", source.range), null, 8, null, Node.createStringLiteralExpression(entryFile + ".ts", source.range), source.range),
            ], source.range);
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
                    const autoImport = new Tokenizer(new Source(0, source.normalizedPath, `import { run as __as_test_auto_run } from "${runImportPath}";`));
                    parser.currentSource = autoImport.source;
                    source.statements.unshift(parser.parseTopLevelStatement(autoImport));
                    runCall = "__as_test_auto_run();";
                }
                const autoCall = new Tokenizer(new Source(0, source.normalizedPath, runCall));
                parser.currentSource = autoCall.source;
                source.statements.push(parser.parseTopLevelStatement(autoCall));
                parser.currentSource = source;
            }
            if (coverage && coverage.globalStatements.length) {
                source.statements.unshift(...coverage.globalStatements);
                const tokenizer = new Tokenizer(new Source(0, source.normalizedPath, 'import { __REGISTER_RAW, __COVER } from "as-test/assembly/coverage";'));
                parser.currentSource = tokenizer.source;
                source.statements.unshift(parser.parseTopLevelStatement(tokenizer));
                parser.currentSource = source;
                coverage.globalStatements = [];
            }
        }
        if (coverage) {
            coverage.globalStatements = [];
        }
    }
}
function collectMockImportTargets(sources) {
    const out = new Set();
    const pattern = /\bmockImport\s*\(\s*["']([^"']+)["']/g;
    for (const source of sources) {
        const text = stripComments(source.text);
        for (const match of text.matchAll(pattern)) {
            const target = (match[1] ?? "").trim();
            if (!target.length)
                continue;
            out.add(target);
        }
    }
    return out;
}
function analyzeSourceText(sourceText) {
    const text = stripComments(sourceText);
    const runImportPath = detectRunImportPath(text);
    const runAlias = detectRunAlias(text);
    const hasRunCall = runAlias
        ? new RegExp(`\\b${escapeRegex(runAlias)}\\s*\\(`).test(text)
        : /\brun\s*\(/.test(text);
    return {
        hasSuiteCalls: /\b(?:describe|test|it)\s*\(/.test(text),
        hasRunCall,
        runImportPath,
        hasMockCalls: /\b(?:mockFn|unmockFn|mockImport|unmockImport)\s*\(/.test(text),
        hasLogCall: /\blog\s*\(/.test(text),
        hasExpectCall: /\bexpect\s*\(/.test(text),
    };
}
function detectRunImportPath(text) {
    const imports = text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g);
    for (const match of imports) {
        const specifiers = match[1] ?? "";
        if (!looksLikeAsTestImport(specifiers))
            continue;
        const modulePath = (match[2] ?? "").trim();
        if (modulePath.length)
            return modulePath;
    }
    return null;
}
function detectRunAlias(text) {
    const imports = text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g);
    for (const match of imports) {
        const specifiers = match[1] ?? "";
        if (!looksLikeAsTestImport(specifiers))
            continue;
        const runAlias = specifiers.match(/\brun\b(?:\s+as\s+([A-Za-z_$][\w$]*))?/);
        if (runAlias) {
            return runAlias[1] ?? "run";
        }
    }
    return null;
}
function looksLikeAsTestImport(specifiers) {
    return /\b(?:describe|test|it|expect|beforeAll|afterAll|beforeEach|afterEach|mockFn|unmockFn|mockImport|unmockImport|snapshotImport|restoreImport|log|run)\b/.test(specifiers);
}
function stripComments(sourceText) {
    return sourceText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isCoverageEnabled() {
    return process.env.AS_TEST_COVERAGE_ENABLED !== "0";
}
//# sourceMappingURL=index.js.map