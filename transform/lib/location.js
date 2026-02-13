import { Node } from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";
import { toString } from "./util.js";
export class LocationTransform extends Visitor {
    visitCallExpression(node) {
        super.visitCallExpression(node);
        if (toString(node.expression) != "expect")
            return;
        if (node.args.length >= 3)
            return;
        const line = node.range.source.lineAt(node.range.start).toString();
        const column = node.range.source.columnAt().toString();
        const location = `${line}:${column}`;
        if (node.args.length == 1) {
            node.args.push(Node.createStringLiteralExpression("", node.range));
        }
        node.args.push(Node.createStringLiteralExpression(location, node.range));
    }
}
//# sourceMappingURL=location.js.map