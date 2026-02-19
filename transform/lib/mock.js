import { Node, FunctionDeclaration, } from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";
import { toString } from "./util.js";
export class MockTransform extends Visitor {
    srcCurrent = null;
    globalStatements = [];
    mocked = new Set();
    importFns = [];
    importMocked = new Set();
    visitCallExpression(node) {
        super.visitCallExpression(node);
        const name = normalizeName(toString(node.expression));
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
            this.mocked.delete(normalizeName(toString(oldFn)) + "_mock");
            return;
        }
        if (name == "unmockImport") {
            return;
        }
        if (name != "mockFn")
            return;
        const ov = toString(node.args[0]);
        const cb = node.args[1];
        const newName = normalizeName(ov);
        const newFn = Node.createFunctionDeclaration(Node.createIdentifierExpression(newName + "_mock", cb.range), cb.declaration.decorators, 0, cb.declaration.typeParameters, cb.declaration.signature, cb.declaration.body, cb.declaration.arrowKind, cb.range);
        const stmts = this.srcCurrent.statements;
        let index = -1;
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (stmt.range.start != node.range.start)
                continue;
            index = i;
            break;
        }
        if (index === -1)
            return;
        stmts.splice(index, 1, newFn);
        this.mocked.add(newFn.name.text);
    }
    visitFunctionDeclaration(node, isDefault) {
        if (!node.body)
            this.importFns.push(node);
        super.visitFunctionDeclaration(node, isDefault);
    }
    visitSource(node) {
        this.mocked = new Set();
        this.srcCurrent = node;
        this.importFns = [];
        super.visitSource(node);
        for (const node of this.importFns) {
            let path;
            const dec = node.decorators?.find((v) => v.name.text == "external");
            if (!dec) {
                path = "env." + node.name.text;
            }
            else if (dec.args[0] && dec.args[1])
                path = dec.args
                    .map((v) => v.value)
                    .join(".");
            else if (dec.args[0])
                path =
                    this.srcCurrent.simplePath +
                        "." +
                        dec.args[0].value;
            else
                path = this.srcCurrent.simplePath + "." + node.name.text;
            const stmts = this.srcCurrent.statements;
            let index = -1;
            for (let i = 0; i < stmts.length; i++) {
                const stmt = stmts[i];
                if (stmt instanceof FunctionDeclaration &&
                    stmt.name.text === node.name.text) {
                    index = i;
                    break;
                }
            }
            if (index === -1)
                continue;
            const registerImportTarget = Node.createExpressionStatement(Node.createCallExpression(Node.createPropertyAccessExpression(Node.createIdentifierExpression("__mock_import_target_by_index", node.range), Node.createIdentifierExpression("set", node.range), node.range), null, [
                Node.createPropertyAccessExpression(Node.createIdentifierExpression(node.name.text, node.range), Node.createIdentifierExpression("index", node.range), node.range),
                Node.createStringLiteralExpression(path, node.range),
            ], node.range));
            if (!this.importMocked.has(path)) {
                stmts.splice(index + 1, 0, registerImportTarget);
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
        }
    }
}
function normalizeName(value) {
    return value
        .replaceAll(".", "_")
        .replaceAll("[", "_")
        .replaceAll("]", "_")
        .replace(/[^A-Za-z0-9_]/g, "_");
}
//# sourceMappingURL=mock.js.map