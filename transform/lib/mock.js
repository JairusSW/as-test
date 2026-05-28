import { Node, IdentifierExpression, } from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";
import { toString } from "./util.js";
export class MockTransform extends Visitor {
    srcCurrent = null;
    globalStatements = [];
    mocked = new Set();
    importMocked = new Set();
    importUnmocked = new Set();
    pendingHoist = [];
    pendingRemoval = [];
    visitCallExpression(node, ref = null) {
        super.visitCallExpression(node, ref);
        const name = normalizeName(expressionName(node.expression));
        if (this.mocked.has(name + "_mock")) {
            node.expression = Node.createIdentifierExpression(name + "_mock", node.expression.range);
            return;
        }
        if (name == "mockImport") {
            const path = node.args[0];
            if (path) {
                this.importMocked.add(path.value);
            }
            return;
        }
        if (name == "unmockFn") {
            const oldFn = node.args[0];
            if (!oldFn)
                return;
            this.mocked.delete(normalizeName(expressionName(oldFn)) + "_mock");
            this.scheduleRemoval(node, ref);
            return;
        }
        if (name == "unmockImport") {
            return;
        }
        if (name != "mockFn")
            return;
        const oldValue = node.args[0];
        const callback = node.args[1];
        if (!oldValue || !callback || !callback.declaration)
            return;
        const mockName = normalizeName(expressionName(oldValue)) + "_mock";
        const newFn = Node.createFunctionDeclaration(Node.createIdentifierExpression(mockName, callback.range), callback.declaration.decorators, 0, callback.declaration.typeParameters, callback.declaration.signature, callback.declaration.body, callback.declaration.arrowKind, callback.range);
        this.pendingHoist.push(newFn);
        this.mocked.add(mockName);
        this.scheduleRemoval(node, ref);
    }
    scheduleRemoval(node, ref) {
        const container = asStatementContainer(ref);
        if (!container)
            return;
        const stmt = container.statements.find((s) => s.expression === node);
        if (stmt)
            this.pendingRemoval.push({ container, stmt });
    }
    visitFunctionDeclaration(node, isDefault) {
        if (this.mocked.has(node.name.text))
            return;
        super.visitFunctionDeclaration(node, isDefault);
    }
    visitSource(node) {
        this.mocked = new Set();
        this.pendingHoist = [];
        this.pendingRemoval = [];
        this.srcCurrent = node;
        super.visitSource(node);
        const currentSource = this.srcCurrent;
        if (!currentSource)
            return;
        for (const { container, stmt } of this.pendingRemoval) {
            const i = container.statements.indexOf(stmt);
            if (i !== -1)
                container.statements.splice(i, 1);
        }
        this.pendingRemoval = [];
        if (this.pendingHoist.length) {
            currentSource.statements.unshift(...this.pendingHoist);
            this.pendingHoist = [];
        }
        const stmts = currentSource.statements;
        for (let index = 0; index < stmts.length; index++) {
            const node = stmts[index];
            if (!isBodylessTopLevelFunction(node))
                continue;
            let path;
            const dec = node.decorators?.find((v) => v.name.text == "external");
            const decArgs = dec?.args ?? [];
            if (!dec) {
                path = "env." + node.name.text;
            }
            else if (decArgs[0] && decArgs[1])
                path = decArgs
                    .map((v) => v.value)
                    .join(".");
            else if (decArgs[0])
                path =
                    currentSource.simplePath +
                        "." +
                        decArgs[0].value;
            else
                path = currentSource.simplePath + "." + node.name.text;
            const registerImportTarget = Node.createExpressionStatement(Node.createCallExpression(Node.createPropertyAccessExpression(Node.createIdentifierExpression("__mock_import_target_by_index", node.range), Node.createIdentifierExpression("set", node.range), node.range), null, [
                Node.createPropertyAccessExpression(Node.createIdentifierExpression(node.name.text, node.range), Node.createIdentifierExpression("index", node.range), node.range),
                Node.createStringLiteralExpression(path, node.range),
            ], node.range));
            if (!this.importMocked.has(path)) {
                stmts.splice(index + 1, 0, registerImportTarget);
                index++;
                continue;
            }
            if (this.importUnmocked.has(path) && node.signature.returnType) {
                const realName = "__as_test_real_" + node.name.text;
                const r = node.range;
                const wrapper = buildFallbackWrapper(node, path, realName, r);
                const mutable = node;
                mutable.name = Node.createIdentifierExpression(realName, r);
                mutable.flags &= ~2;
                stmts.splice(index + 1, 0, wrapper);
                index++;
                continue;
            }
            const args = [
                Node.createCallExpression(Node.createPropertyAccessExpression(Node.createIdentifierExpression("__mock_import", node.range), Node.createIdentifierExpression("get", node.range), node.range), null, [Node.createStringLiteralExpression(path, node.range)], node.range),
            ];
            for (const param of node.signature.parameters) {
                args.push(Node.createIdentifierExpression(param.name.text, node.range));
            }
            const newFn = Node.createFunctionDeclaration(node.name, (node.decorators ?? []).filter((v) => v.name.text != "external"), node.flags - 32768 - 4, node.typeParameters, node.signature, Node.createBlockStatement([
                Node.createReturnStatement(Node.createCallExpression(Node.createIdentifierExpression("call_indirect", node.range), null, args, node.range), node.range),
            ], node.range), 0, node.range);
            stmts.splice(index, 1, newFn, registerImportTarget);
            index++;
        }
    }
}
function isBodylessTopLevelFunction(node) {
    const candidate = node;
    return (candidate != null &&
        typeof candidate == "object" &&
        candidate.name instanceof IdentifierExpression &&
        "signature" in candidate &&
        candidate.body == null);
}
function buildFallbackWrapper(node, path, realName, range) {
    const mockImportGet = Node.createCallExpression(Node.createPropertyAccessExpression(Node.createIdentifierExpression("__mock_import", range), Node.createIdentifierExpression("get", range), range), null, [Node.createStringLiteralExpression(path, range)], range);
    const indirectArgs = [mockImportGet];
    const forwardArgs = [];
    for (const param of node.signature.parameters) {
        indirectArgs.push(Node.createIdentifierExpression(param.name.text, range));
        forwardArgs.push(Node.createIdentifierExpression(param.name.text, range));
    }
    const ifMocked = Node.createIfStatement(Node.createCallExpression(Node.createPropertyAccessExpression(Node.createIdentifierExpression("__mock_import", range), Node.createIdentifierExpression("has", range), range), null, [Node.createStringLiteralExpression(path, range)], range), Node.createReturnStatement(Node.createCallExpression(Node.createIdentifierExpression("call_indirect", range), null, indirectArgs, range), range), null, range);
    const callReal = Node.createReturnStatement(Node.createCallExpression(Node.createIdentifierExpression(realName, range), null, forwardArgs, range), range);
    const signature = Node.createFunctionType(node.signature.parameters, node.signature.returnType, node.signature.explicitThisType, node.signature.isNullable, range);
    const exported = (node.flags & 2) != 0;
    return Node.createFunctionDeclaration(Node.createIdentifierExpression(node.name.text, range), null, exported ? 2 : 0, node.typeParameters, signature, Node.createBlockStatement([ifMocked, callReal], range), 0, range);
}
function asStatementContainer(ref) {
    const candidate = ref;
    if (candidate && Array.isArray(candidate.statements)) {
        return candidate;
    }
    return null;
}
function normalizeName(value) {
    return value
        .replaceAll(".", "_")
        .replaceAll("[", "_")
        .replaceAll("]", "_")
        .replace(/[^A-Za-z0-9_]/g, "_");
}
function expressionName(node) {
    const candidate = node;
    if (!candidate || typeof candidate != "object")
        return "";
    if (typeof candidate.text == "string")
        return candidate.text;
    const propertyText = candidate.property?.text;
    if (propertyText && candidate.expression) {
        const left = expressionName(candidate.expression);
        return left.length ? `${left}.${propertyText}` : propertyText;
    }
    const sourceText = candidate.range?.source?.text;
    if (typeof sourceText == "string") {
        const raw = sourceText
            .slice(candidate.range.start, candidate.range.end)
            .trim();
        if (raw.length)
            return raw;
    }
    return toString(candidate);
}
