import { Visitor } from "./visitor.js";
export class RangeTransform extends Visitor {
    node;
    constructor(node) {
        super();
        this.node = node;
    }
    _visit(node, ref) {
        node.range = this.node.range;
        return super._visit(node, ref);
    }
}
//# sourceMappingURL=range.js.map