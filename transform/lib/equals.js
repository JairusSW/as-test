import { Source, Tokenizer, } from "assemblyscript/dist/assemblyscript.js";
import { NodeKind } from "./types.js";
import { readFileSync } from "fs";
import { join } from "path";
import { SimpleParser, isStdlib } from "./util.js";
const EQUALS_METHOD = "__AS_TEST_EQUALS";
const TOJSON_METHOD = "toJSON";
const REFLECT_LOCAL = "__AS_TEST_REFLECT_EQUALS_INTERNAL";
const STRINGIFY_LOCAL = "__AS_TEST_STRINGIFY_INTERNAL";
const ALREADY_INJECTED_EQUALS = new WeakSet();
const ALREADY_INJECTED_TOJSON = new WeakSet();
const JSON_DECORATORS = ["json", "serializable"];
export class EqualsTransform {
    parser;
    touchedSources = new Set();
    classesByName = new Map();
    constructor(parser) {
        this.parser = parser;
    }
    apply(sources) {
        for (const source of sources) {
            if (isStdlib(source))
                continue;
            if (!isUserSource(source))
                continue;
            if (isAsTestInternal(source))
                continue;
            this.indexClasses(source.statements);
        }
        for (const source of this.parser.sources) {
            if (isStdlib(source))
                continue;
            if (!isUserSource(source))
                continue;
            if (isAsTestInternal(source))
                continue;
            this.traverseStatements(source, source.statements);
        }
        for (const source of this.touchedSources) {
            this.injectRuntimeImports(source);
        }
    }
    indexClasses(statements) {
        for (const stmt of statements) {
            if (!stmt)
                continue;
            if (stmt.kind === NodeKind.ClassDeclaration) {
                const klass = stmt;
                const list = this.classesByName.get(klass.name.text);
                if (list)
                    list.push(klass);
                else
                    this.classesByName.set(klass.name.text, [klass]);
            }
            else if (stmt.kind === NodeKind.NamespaceDeclaration) {
                const members = stmt.members;
                if (members)
                    this.indexClasses(members);
            }
        }
    }
    traverseStatements(source, statements) {
        for (const stmt of statements) {
            if (!stmt)
                continue;
            if (stmt.kind === NodeKind.ClassDeclaration) {
                const klass = stmt;
                const injectedEquals = this.injectEqualsMethod(klass);
                const injectedToJSON = this.injectToJSONMethod(klass);
                if (injectedEquals || injectedToJSON) {
                    this.touchedSources.add(source);
                }
            }
            else if (stmt.kind === NodeKind.NamespaceDeclaration) {
                const members = stmt.members;
                if (members)
                    this.traverseStatements(source, members);
            }
        }
    }
    injectEqualsMethod(klass) {
        if (ALREADY_INJECTED_EQUALS.has(klass))
            return false;
        if (declaresMethod(klass, EQUALS_METHOD))
            return false;
        if (klass.typeParameters && klass.typeParameters.length)
            return false;
        const fieldNames = [];
        for (const member of klass.members) {
            if (member.kind !== NodeKind.FieldDeclaration)
                continue;
            const field = member;
            if (!field.is(262144))
                continue;
            if ((field.flags & 32) !== 0)
                continue;
            if (!field.name || !field.name.text)
                continue;
            fieldNames.push(field.name.text);
        }
        const fieldHashes = fieldNames.map((n) => djb2Hash(n).toString());
        const className = klass.name.text;
        const otherType = this.pinnedOtherType(klass);
        const lines = [];
        lines.push(`const __o = changetype<${className}>(other);`);
        for (let i = 0; i < fieldNames.length; i++) {
            const name = fieldNames[i];
            const hash = fieldHashes[i];
            lines.push(`if (!ignore.includes(${hash}) && ` +
                `!${REFLECT_LOCAL}(this.${name}, __o.${name}, stack, strict)) return false;`);
        }
        const ignoreLiteral = fieldHashes.length
            ? `[${fieldHashes.join(", ")}] as StaticArray<i64>`
            : `[] as StaticArray<i64>`;
        lines.push(`if (isDefined(super.__AS_TEST_EQUALS)) {` +
            ` if (!super.__AS_TEST_EQUALS(other, stack, ` +
            `StaticArray.concat<i64>(ignore, ${ignoreLiteral}), strict)) return false;` +
            ` }`);
        lines.push(`return true;`);
        const code = `${EQUALS_METHOD}(` +
            `other: ${otherType}, ` +
            `stack: usize[], ` +
            `ignore: StaticArray<i64>, ` +
            `strict: bool` +
            `): bool { ${lines.join(" ")} }`;
        try {
            const method = SimpleParser.parseClassMember(code, klass);
            klass.members.push(method);
            ALREADY_INJECTED_EQUALS.add(klass);
            return true;
        }
        catch {
            return false;
        }
    }
    pinnedOtherType(klass) {
        const seen = new Set();
        let current = klass;
        let rootName = klass.name.text;
        while (current && !seen.has(current)) {
            seen.add(current);
            const userType = userDeclaredEqualsOtherType(current);
            if (userType)
                return userType;
            rootName = current.name.text;
            const parentName = extendsName(current);
            if (!parentName)
                return rootName;
            const parents = this.classesByName.get(parentName);
            if (!parents || parents.length === 0)
                return rootName;
            current = parents[0];
        }
        return rootName;
    }
    injectRuntimeImports(source) {
        const asTestPath = detectAsTestImportPath(source.text) ?? "as-test";
        const importLine = `import { reflectEquals as ${REFLECT_LOCAL}, ` +
            `__as_test_stringify as ${STRINGIFY_LOCAL} } from "${asTestPath}";`;
        const tokenizer = new Tokenizer(new Source(0, source.normalizedPath, importLine));
        this.parser.currentSource = tokenizer.source;
        source.statements.unshift(this.parser.parseTopLevelStatement(tokenizer));
        this.parser.currentSource = source;
    }
    injectToJSONMethod(klass) {
        if (ALREADY_INJECTED_TOJSON.has(klass))
            return false;
        if (declaresMethod(klass, TOJSON_METHOD))
            return false;
        if (hasAnyDecorator(klass, JSON_DECORATORS))
            return false;
        if (klass.typeParameters && klass.typeParameters.length)
            return false;
        const fieldNames = this.collectChainFieldNames(klass);
        const chainNames = this.collectChainClassNames(klass);
        const renderable = [];
        for (const name of fieldNames) {
            const fieldType = this.fieldTypeName(klass, name);
            if (fieldType && chainNames.has(fieldType))
                continue;
            renderable.push(name);
        }
        const parts = [];
        for (let i = 0; i < renderable.length; i++) {
            const name = renderable[i];
            const prefix = i === 0 ? "" : ",";
            parts.push(`"${prefix}\\"${name}\\":" + ${STRINGIFY_LOCAL}(this.${name})`);
        }
        const body = parts.length
            ? `return "{" + ${parts.join(" + ")} + "}";`
            : `return "{}";`;
        const code = `toJSON(): string { ${body} }`;
        try {
            const method = SimpleParser.parseClassMember(code, klass);
            klass.members.push(method);
            ALREADY_INJECTED_TOJSON.add(klass);
            return true;
        }
        catch {
            return false;
        }
    }
    collectChainFieldNames(klass) {
        const chain = [];
        const seen = new Set();
        let current = klass;
        while (current && !seen.has(current)) {
            seen.add(current);
            chain.unshift(current);
            const parentName = extendsName(current);
            if (!parentName)
                break;
            const parents = this.classesByName.get(parentName);
            if (!parents || parents.length === 0)
                break;
            current = parents[0];
        }
        const ordered = [];
        const known = new Set();
        for (const cls of chain) {
            for (const member of cls.members) {
                if (member.kind !== NodeKind.FieldDeclaration)
                    continue;
                const field = member;
                if (!field.is(262144))
                    continue;
                if ((field.flags & 32) !== 0)
                    continue;
                if (!field.name || !field.name.text)
                    continue;
                const name = field.name.text;
                if (known.has(name))
                    continue;
                known.add(name);
                ordered.push(name);
            }
        }
        return ordered;
    }
    collectChainClassNames(klass) {
        const out = new Set();
        const seen = new Set();
        let current = klass;
        while (current && !seen.has(current)) {
            seen.add(current);
            out.add(current.name.text);
            const parentName = extendsName(current);
            if (!parentName)
                break;
            const parents = this.classesByName.get(parentName);
            if (!parents || parents.length === 0)
                break;
            current = parents[0];
        }
        return out;
    }
    fieldTypeName(klass, fieldName) {
        const seen = new Set();
        let current = klass;
        while (current && !seen.has(current)) {
            seen.add(current);
            for (const member of current.members) {
                if (member.kind !== NodeKind.FieldDeclaration)
                    continue;
                const field = member;
                if (!field.name || field.name.text !== fieldName)
                    continue;
                return namedTypeText(field.type);
            }
            const parentName = extendsName(current);
            if (!parentName)
                break;
            const parents = this.classesByName.get(parentName);
            if (!parents || parents.length === 0)
                break;
            current = parents[0];
        }
        return null;
    }
}
function declaresMethod(klass, name) {
    for (const member of klass.members) {
        if (member.kind !== NodeKind.MethodDeclaration)
            continue;
        const method = member;
        if (method.name && method.name.text === name)
            return true;
    }
    return false;
}
function hasAnyDecorator(klass, names) {
    if (!klass.decorators)
        return false;
    for (const dec of klass.decorators) {
        const decName = dec.name.text;
        if (decName && names.indexOf(decName) !== -1)
            return true;
    }
    return false;
}
function userDeclaredEqualsOtherType(klass) {
    for (const member of klass.members) {
        if (member.kind !== NodeKind.MethodDeclaration)
            continue;
        const method = member;
        if (!method.name || method.name.text !== EQUALS_METHOD)
            continue;
        const params = method.signature.parameters;
        if (!params || params.length === 0)
            return null;
        return namedTypeText(params[0].type);
    }
    return null;
}
function extendsName(klass) {
    const extendsType = klass
        .extendsType;
    if (!extendsType)
        return null;
    return namedTypeText(extendsType);
}
function namedTypeText(type) {
    if (!type)
        return null;
    if (type.kind !== NodeKind.NamedType)
        return null;
    const named = type;
    if (!named.name)
        return null;
    const ident = named.name
        .identifier;
    if (ident && typeof ident.text === "string")
        return ident.text;
    const text = named.name.text;
    return text ?? null;
}
function isUserSource(source) {
    return (source.sourceKind === 0 ||
        source.sourceKind === 1);
}
let cachedIsAsTestCwd = null;
function isAsTestOwnCwd() {
    if (cachedIsAsTestCwd !== null)
        return cachedIsAsTestCwd;
    try {
        const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
        const pkg = JSON.parse(raw);
        cachedIsAsTestCwd = pkg.name === "as-test";
    }
    catch {
        cachedIsAsTestCwd = false;
    }
    return cachedIsAsTestCwd;
}
function isAsTestInternal(source) {
    const p = source.normalizedPath;
    if (/(?:^|\/)as-test\/assembly\/(?!__tests__\/)/.test(p))
        return true;
    if (isAsTestOwnCwd() && /^assembly\/(?!__tests__\/)/.test(p))
        return true;
    return false;
}
function detectAsTestImportPath(sourceText) {
    const text = sourceText
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
    const imports = text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g);
    for (const match of imports) {
        const specifiers = match[1] ?? "";
        const modulePath = (match[2] ?? "").trim();
        if (!modulePath.length)
            continue;
        if (modulePath === "as-test" || modulePath.endsWith("/as-test")) {
            return modulePath;
        }
        if (/\b(?:describe|test|it|expect|beforeAll|afterAll|beforeEach|afterEach|mockFn|unmockFn|mockImport|unmockImport|snapshotFn|log|run)\b/.test(specifiers)) {
            return modulePath;
        }
    }
    return null;
}
function djb2Hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return h >>> 0;
}
