import { Node } from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";

export class RangeTransform extends Visitor {
  constructor(private node: Node) {
    super();
  }
  _visit(node: Node, ref: Node | null): void {
    node.range = this.node.range;
    return super._visit(node, ref);
  }
}
