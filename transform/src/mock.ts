import {
    Source,
    Statement,
    CallExpression,
    IdentifierExpression,
    StringLiteralExpression,
    NodeKind,
    FunctionExpression,
    CommonFlags,
    Node,
    PropertyAccessExpression,
} from "assemblyscript/dist/assemblyscript.js";
import { FunctionDeclaration } from "types:assemblyscript/src/ast";

import { BaseVisitor } from "visitor-as/dist/index.js";
import { toString } from "visitor-as/dist/utils.js";
export class MockTransform extends BaseVisitor {
    public currentSource: Source;
    public globalStatements: Statement[] = [];
    public fn = new Map<string, FunctionDeclaration>();
    public mocked = new Set<string>();
    visitCallExpression(node: CallExpression): void {
        super.visitCallExpression(node);
        if (node.expression instanceof PropertyAccessExpression) {
            const name = toString(node.expression).replaceAll(".", "_").replaceAll("[", "_").replaceAll("]", "_");
            if (this.mocked.has(name + "_mock")) {
                //console.log("fn rn " + name + " -> " + name + "_mock");
                node.expression = Node.createIdentifierExpression(name + "_mock", node.expression.range)
                //console.log(toString(node.expression))
                return;
            }
        }
        if (!(node.expression instanceof IdentifierExpression)) return;
        if (node.expression.text != "mock") return;
        const ov = node.args[0] as StringLiteralExpression;
        const cb = node.args[1] as FunctionExpression;

        const newName = ov.value.replaceAll(".", "_").replaceAll("[", "_").replaceAll("]", "_");
        const newFn = Node.createFunctionDeclaration(
            Node.createIdentifierExpression(
                newName + "_mock",
                cb.range
            ),
            cb.declaration.decorators,
            CommonFlags.None,
            cb.declaration.typeParameters,
            cb.declaration.signature,
            cb.declaration.body,
            cb.declaration.arrowKind,
            cb.range
        );
        const stmts = this.currentSource.statements;
        let index = -1;
        for (let i = 0; i < stmts.length; i++) {
            const stmt = stmts[i];
            if (toString(stmt) != toString(node)) continue;
            index = i;
            break;
        }
        if (index === -1) return;
        //console.log("fn mock " + newName + "_mock" + " at index " + index.toString());
        stmts.splice(index, 1, newFn);
        this.mocked.add(newFn.name.text);
    }
    visitFunctionDeclaration(node: FunctionDeclaration, isDefault?: boolean): void {
        super.visitFunctionDeclaration(node, isDefault);
        const name = node.name.text;
        if (!name) return;
        this.fn.set(name, node);
    }
    visitSource(node: Source): void {
        this.mocked = new Set<string>();
        this.currentSource = node;
        super.visitSource(node);
    }
}