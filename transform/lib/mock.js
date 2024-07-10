import { Node, } from "assemblyscript/dist/assemblyscript.js";
import { BaseVisitor } from "visitor-as/dist/index.js";
import { isStdlib, toString } from "visitor-as/dist/utils.js";
export class MockTransform extends BaseVisitor {
    currentSource;
    globalStatements = [];
    fn = new Map();
    mocked = new Set();
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
        if (name != "mockFn")
            return;
        const ov = node.args[0];
        const cb = node.args[1];
        const newName = ov.value
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
        super.visitFunctionDeclaration(node, isDefault);
        const name = node.name.text;
        if (!name)
            return;
        this.fn.set(name, node);
    }
    visitSource(node) {
        if (node.isLibrary || isStdlib(node)) {
            if (!node.normalizedPath.startsWith("~lib/as-test")) {
                console.log("Not Visiting: " + node.normalizedPath);
                return;
            }
        }
        console.log("Are Visiting: " + node.normalizedPath);
        this.mocked = new Set();
        this.currentSource = node;
        super.visitSource(node);
    }
}
//# sourceMappingURL=mock.js.map