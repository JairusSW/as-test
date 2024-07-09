import { Transform } from "assemblyscript/dist/transform.js";
import { Source, Tokenizer } from "assemblyscript/dist/assemblyscript.js";
import { isStdlib } from "visitor-as/dist/utils.js";
import { CoverageTransform } from "./coverage.js";
import { MockTransform } from "./mock.js";
export default class Transformer extends Transform {
  afterParse(parser) {
    const mock = new MockTransform();
    const coverage = new CoverageTransform();
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
    for (const source of sources) {
      mock.visit(source);
      coverage.visit(source);
      if (coverage.globalStatements.length) {
        source.statements.unshift(...coverage.globalStatements);
        const tokenizer = new Tokenizer(
          new Source(
            0,
            source.normalizedPath,
            'import { __REGISTER, __COVER } from "as-test/assembly/coverage";',
          ),
        );
        parser.currentSource = tokenizer.source;
        source.statements.unshift(parser.parseTopLevelStatement(tokenizer));
        parser.currentSource = source;
      }
    }
    coverage.globalStatements = [];
  }
}
//# sourceMappingURL=index.js.map
