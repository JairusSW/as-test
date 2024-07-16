import { Transform } from "assemblyscript/dist/transform.js";
import { Node } from "assemblyscript/dist/assemblyscript.js";
import { isStdlib } from "visitor-as/dist/utils.js";
export default class Transformer extends Transform {
  afterParse(parser) {
    const sources = parser.sources
      .filter((source) => !isStdlib(source))
      .sort((_a, _b) => {
        const a = _a.internalPath;
        const b = _b.internalPath;
        if (a[0] === "~" && b[0] !== "~") {
          return -1;
        } else if (a[0] !== "~" && b[0] === "~") {
          return 1;
        } else {
          return 0;
        }
      });
    const entryFile = sources.find((v) => v.sourceKind == 1).simplePath;
    for (const source of sources) {
      const node = Node.createVariableStatement(
        null,
        [
          Node.createVariableDeclaration(
            Node.createIdentifierExpression("ENTRY_FILE", source.range),
            null,
            8,
            null,
            Node.createStringLiteralExpression(entryFile + ".ts", source.range),
            source.range,
          ),
        ],
        source.range,
      );
      source.statements.unshift(node);
    }
  }
}
//# sourceMappingURL=index.js.map
