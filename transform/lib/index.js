import { Transform } from "assemblyscript/dist/transform.js";
import { Node, Source, Tokenizer, } from "assemblyscript/dist/assemblyscript.js";
import { CoverageTransform } from "./coverage.js";
import { MockTransform } from "./mock.js";
import { LocationTransform } from "./location.js";
import { isStdlib } from "./util.js";
export default class Transformer extends Transform {
    afterParse(parser) {
        const mock = new MockTransform();
        const coverage = new CoverageTransform();
        const location = new LocationTransform();
        const sources = parser.sources
            .filter((source) => !isStdlib(source))
            .sort((_a, _b) => {
            const a = _a.internalPath;
            const b = _b.internalPath;
            if (a[0] === "~" && b[0] !== "~") {
                return -1;
            }
            else if (a[0] !== "~" && b[0] === "~") {
                return 1;
            }
            else {
                return 0;
            }
        });
        const entryFile = sources.find((v) => v.sourceKind == 1).simplePath;
        for (const source of sources) {
            const node = Node.createVariableStatement(null, [
                Node.createVariableDeclaration(Node.createIdentifierExpression("ENTRY_FILE", source.range), null, 8, null, Node.createStringLiteralExpression(entryFile + ".ts", source.range), source.range),
            ], source.range);
            source.statements.unshift(node);
            mock.visit(source);
            coverage.visit(source);
            location.visit(source);
            if (coverage.globalStatements.length) {
                source.statements.unshift(...coverage.globalStatements);
                const tokenizer = new Tokenizer(new Source(0, source.normalizedPath, 'import { __REGISTER, __COVER } from "as-test/assembly/coverage";'));
                parser.currentSource = tokenizer.source;
                source.statements.unshift(parser.parseTopLevelStatement(tokenizer));
                parser.currentSource = source;
            }
        }
        coverage.globalStatements = [];
    }
}
//# sourceMappingURL=index.js.map