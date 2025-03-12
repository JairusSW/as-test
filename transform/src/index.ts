import { Transform } from "assemblyscript/dist/transform.js";
import {
  CommonFlags,
  Node,
  Parser,
  SourceKind,
  Source,
  Tokenizer,
} from "assemblyscript/dist/assemblyscript.js";
import { CoverageTransform } from "./coverage.js";
import { MockTransform } from "./mock.js";
import { isStdlib } from "./util.js";

export default class Transformer extends Transform {
  // Trigger the transform after parse.
  afterParse(parser: Parser): void {
    // Create new transform
    const mock = new MockTransform();
    const coverage = new CoverageTransform();

    // Sort the sources so that user scripts are visited last
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
    const entryFile = sources.find(
      (v) => v.sourceKind == SourceKind.UserEntry,
    ).simplePath;
    // Loop over every source
    for (const source of sources) {
      const node = Node.createVariableStatement(
        null,
        [
          Node.createVariableDeclaration(
            Node.createIdentifierExpression("ENTRY_FILE", source.range),
            null,
            CommonFlags.Const,
            null,
            Node.createStringLiteralExpression(entryFile + ".ts", source.range),
            source.range,
          ),
        ],
        source.range,
      );
      source.statements.unshift(node);
      mock.visit(source);
      coverage.visit(source);
      if (coverage.globalStatements.length) {
        source.statements.unshift(...coverage.globalStatements);
        const tokenizer = new Tokenizer(
          new Source(
            SourceKind.User,
            source.normalizedPath,
            'import { __REGISTER, __COVER } from "as-test/assembly/coverage";',
          ),
        );
        parser.currentSource = tokenizer.source;
        source.statements.unshift(parser.parseTopLevelStatement(tokenizer)!);
        parser.currentSource = source;
      }
    }
    coverage.globalStatements = [];
  }
}
