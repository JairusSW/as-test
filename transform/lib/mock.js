import { Node, FunctionDeclaration, } from "assemblyscript/dist/assemblyscript.js";
import { BaseVisitor } from "visitor-as/dist/index.js";
import { toString } from "visitor-as/dist/utils.js";
export class MockTransform extends BaseVisitor {
    currentSource;
    globalStatements = [];
    mocked = new Set();
    importFns = [];
    importMocked = new Set();
    visitCallExpression(node) {
        super.visitCallExpression(node);
        const name = toString(node.expression)
            .replaceAll(".", "_")
            .replaceAll("[", "_")
            .replaceAll("]", "_");
        if (this.mocked.has(name + "_mock")) {
            node.expression = Node.createIdentifierExpression(name + "_mock", node.expression.range);
            return;
        }
        if (name == "mockImport") {
            this.importMocked.add(node.args[0].value);
            return;
        }
        if (name != "mockFn")
            return;
        const ov = toString(node.args[0]);
        const cb = node.args[1];
        const newName = ov
            .replaceAll(".", "_")
            .replaceAll("[", "_")
            .replaceAll("]", "_");
        const newFn = Node.createFunctionDeclaration(Node.createIdentifierExpression(newName + "_mock", cb.range), cb.declaration.decorators, 0, cb.declaration.typeParameters, cb.declaration.signature, cb.declaration.body, cb.declaration.arrowKind, cb.range);
        const stmts = this.currentSource.statements;
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
        this.currentSource = node;
        this.importFns = [];
        super.visitSource(node);
        for (const node of this.importFns) {
            let path = "";
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
                    this.currentSource.simplePath +
                        "." +
                        dec.args[0].value;
            else
                path = this.currentSource.simplePath + "." + node.name.text;
            if (!this.importMocked.has(path))
                return;
            let args = [
                Node.createCallExpression(Node.createPropertyAccessExpression(Node.createIdentifierExpression("__mock_import", node.range), Node.createIdentifierExpression("get", node.range), node.range), null, [Node.createStringLiteralExpression(path, node.range)], node.range),
            ];
            for (const param of node.signature.parameters) {
                args.push(Node.createIdentifierExpression(param.name.text, node.range));
            }
            const newFn = Node.createFunctionDeclaration(node.name, node.decorators.filter((v) => v.name.text != "external"), node.flags - 32768 - 4, null, node.signature, Node.createBlockStatement([
                Node.createReturnStatement(Node.createCallExpression(Node.createIdentifierExpression("call_indirect", node.range), null, args, node.range), node.range),
            ], node.range), 0, node.range);
            const stmts = this.currentSource.statements;
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
                return;
            stmts.splice(index, 1, newFn);
        }
    }
}
//# sourceMappingURL=mock.js.map