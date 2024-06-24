import { Transform } from "assemblyscript/dist/transform.js";
import { Source, Tokenizer, BlockStatement, ExpressionStatement, Node } from "assemblyscript/dist/assemblyscript.js";
import { BaseVisitor, SimpleParser } from "visitor-as/dist/index.js";
import { isStdlib, toString } from "visitor-as/dist/utils.js";
import { RangeTransform } from "visitor-as/dist/transformRange.js";
let ENABLED = false;
var CoverType;
(function (CoverType) {
    CoverType[CoverType["Function"] = 0] = "Function";
    CoverType[CoverType["Expression"] = 1] = "Expression";
    CoverType[CoverType["Block"] = 2] = "Block";
})(CoverType || (CoverType = {}));
class CoverPoint {
    constructor() {
        this.file = "";
        this.hash = "";
        this.line = 0;
        this.column = 0;
        this.executed = false;
    }
}
class CoverageTransform extends BaseVisitor {
    constructor() {
        super(...arguments);
        this.mustImport = false;
        this.points = new Map();
        this.globalStatements = [];
    }
    visitBinaryExpression(node) {
        super.visitBinaryExpression(node);
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        const path = node.range.source.normalizedPath;
        switch (node.operator) {
            case 98 /* Token.Bar_Bar */:
            case 97 /* Token.Ampersand_Ampersand */: {
                const right = node.right;
                const rightLc = getLineCol(node);
                const point = new CoverPoint();
                point.line = rightLc?.line;
                point.column = rightLc?.column;
                point.file = path;
                point.type = CoverType.Expression;
                point.hash = hash(point);
                const replacer = new RangeTransform(node);
                const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                        file: "${point.file}",
                        hash: "${point.hash}",
                        line: ${point.line},
                        column: ${point.column},
                        type: __COVERTYPES.Expression,
                        executed: false
                    });`);
                replacer.visit(registerStmt);
                let coverExpression = SimpleParser.parseExpression(`(__COVER("${point.hash}"), $$REPLACE_ME)`);
                replacer.visit(coverExpression);
                coverExpression.expression.expressions[1] = right;
                node.right = coverExpression;
                this.globalStatements.push(registerStmt);
                break;
            }
        }
    }
    visitMethodDeclaration(node) {
        super.visitMethodDeclaration(node);
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        if (node.body) {
            // @ts-ignore
            if (node.body.visited)
                return;
            // @ts-ignore
            node.body.visited = true;
            const path = node.range.source.normalizedPath;
            const funcLc = getLineCol(node);
            const point = new CoverPoint();
            point.line = funcLc?.line;
            point.column = funcLc?.column;
            point.file = path;
            point.type = CoverType.Function;
            point.hash = hash(point);
            const replacer = new RangeTransform(node);
            const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                    file: "${point.file}",
                    hash: "${point.hash}",
                    line: ${point.line},
                    column: ${point.column},
                    type: __COVERTYPES.Function,
                    executed: false
                })`);
            replacer.visit(registerStmt);
            const coverStmt = SimpleParser.parseStatement(`__COVER("${point.hash}")`, true);
            replacer.visit(coverStmt);
            const bodyBlock = node.body;
            bodyBlock.statements.unshift(coverStmt);
            this.globalStatements.push(registerStmt);
        }
    }
    visitParameter(node) {
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        const path = node.range.source.normalizedPath;
        if (node.initializer) {
            // @ts-ignore
            if (node.initializer.visited)
                return;
            // @ts-ignore
            node.initializer.visited = true;
            super.visitParameter(node);
            const paramLc = getLineCol(node.initializer);
            const point = new CoverPoint();
            point.line = paramLc?.line;
            point.column = paramLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(node);
            const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                    file: "${point.file}",
                    hash: "${point.hash}",
                    line: ${point.line},
                    column: ${point.column},
                    type: __COVERTYPES.Expression,
                    executed: false
                })`);
            replacer.visit(registerStmt);
            const coverExpression = SimpleParser.parseExpression(`(__COVER("${point.hash}"), $$REPLACE_ME)`);
            replacer.visit(coverExpression);
            coverExpression.expression.expressions[1] = node.initializer;
            node.initializer = coverExpression;
            this.globalStatements.push(registerStmt);
        }
    }
    visitFunctionDeclaration(node, isDefault) {
        super.visitFunctionDeclaration(node, isDefault);
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        if (node.body) {
            // @ts-ignore
            if (node.body.visited)
                return;
            // @ts-ignore
            node.body.visited = true;
            const path = node.range.source.normalizedPath;
            const funcLc = getLineCol(node);
            const point = new CoverPoint();
            point.line = funcLc?.line;
            point.column = funcLc?.column;
            point.file = path;
            point.type = CoverType.Function;
            point.hash = hash(point);
            const replacer = new RangeTransform(node);
            const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                    file: "${point.file}",
                    hash: "${point.hash}",
                    line: ${point.line},
                    column: ${point.column},
                    type: __COVERTYPES.Function,
                    executed: false
                })`);
            replacer.visit(registerStmt);
            this.globalStatements.push(registerStmt);
            if (node.body.kind === 35 /* NodeKind.Export */) {
                const coverStmt = SimpleParser.parseStatement(`{
                __COVER("${point.hash}")
                return $$REPLACE_ME
            }`);
                replacer.visit(coverStmt);
                const bodyReturn = coverStmt.statements[1];
                const body = node.body;
                node.arrowKind = 2 /* ArrowKind.Single */;
                bodyReturn.value = body.expression;
                node.body = body;
            }
            else {
                const coverStmt = SimpleParser.parseStatement(`__COVER("${point.hash}")`, true);
                replacer.visit(coverStmt);
                if (node.body instanceof BlockStatement) {
                    node.body.statements.unshift(coverStmt);
                    console.log(node);
                }
                else if (node.body instanceof ExpressionStatement) {
                    const expression = node.body.expression;
                    node.body = Node.createBlockStatement([
                        Node.createReturnStatement(expression, expression.range)
                    ], expression.range);
                    const bodyBlock = node.body;
                    bodyBlock.statements.unshift(coverStmt);
                }
            }
        }
    }
    visitIfStatement(node) {
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        let visitIfTrue = false;
        let visitIfFalse = false;
        const ifTrue = node.ifTrue;
        const ifFalse = node.ifFalse;
        const path = node.range.source.normalizedPath;
        if (ifTrue.kind !== 30 /* NodeKind.Block */) {
            const trueLc = getLineCol(ifTrue);
            const point = new CoverPoint();
            point.line = trueLc?.line;
            point.column = trueLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(ifTrue);
            const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                    file: "${point.file}",
                    hash: "${point.hash}",
                    line: ${point.line},
                    column: ${point.column},
                    type: __COVERTYPES.Expression,
                    executed: false
                })`);
            replacer.visit(registerStmt);
            const coverStmt = SimpleParser.parseStatement(`{__COVER("${point.hash}")};`, true);
            replacer.visit(coverStmt);
            coverStmt.statements.push(ifTrue);
            node.ifTrue = coverStmt;
            this.globalStatements.push(registerStmt);
            visitIfTrue = true;
            visitIfFalse = !!ifFalse;
        }
        if (ifFalse && ifFalse.kind !== 30 /* NodeKind.Block */) {
            const falseLc = getLineCol(ifFalse);
            const point = new CoverPoint();
            point.line = falseLc?.line;
            point.column = falseLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(ifTrue);
            const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                    file: "${point.file}",
                    hash: "${point.hash}",
                    line: ${point.line},
                    column: ${point.column},
                    type: __COVERTYPES.Expression,
                    executed: false
                })`);
            replacer.visit(registerStmt);
            const coverStmt = SimpleParser.parseStatement(`{__COVER("${point.hash}")};`, true);
            replacer.visit(coverStmt);
            coverStmt.statements.push(ifFalse);
            node.ifFalse = coverStmt;
            this.globalStatements.push(registerStmt);
            visitIfTrue = true;
            visitIfFalse = true;
        }
        if (visitIfTrue || visitIfFalse) {
            if (visitIfTrue) {
                // @ts-ignore
                if (ifTrue.visited)
                    return;
                // @ts-ignore
                ifTrue.visited = true;
                this._visit(ifTrue);
            }
            if (visitIfFalse) {
                // @ts-ignore
                if (ifFalse.visited)
                    return;
                // @ts-ignore
                ifFalse.visited = true;
                this._visit(ifFalse);
            }
        }
        else {
            super.visitIfStatement(node);
        }
    }
    visitTernaryExpression(node) {
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        super.visitTernaryExpression(node);
        const trueExpression = node.ifThen;
        const falseExpression = node.ifElse;
        const path = node.range.source.normalizedPath;
        {
            const trueLc = getLineCol(trueExpression);
            const point = new CoverPoint();
            point.line = trueLc?.line;
            point.column = trueLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(trueExpression);
            const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                    file: "${point.file}",
                    hash: "${point.hash}",
                    line: ${point.line},
                    column: ${point.column},
                    type: __COVERTYPES.Expression,
                    executed: false
                })`);
            replacer.visit(registerStmt);
            const coverExpression = SimpleParser.parseExpression(`(__COVER("${point.hash}"), $$REPLACE_ME)`);
            replacer.visit(coverExpression);
            coverExpression.expression.expressions[1] = trueExpression;
            node.ifThen = coverExpression;
            this.globalStatements.push(registerStmt);
        }
        {
            const falseLc = getLineCol(falseExpression);
            const point = new CoverPoint();
            point.line = falseLc?.line;
            point.column = falseLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(falseExpression);
            const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                    file: "${point.file}",
                    hash: "${point.hash}",
                    line: ${point.line},
                    column: ${point.column},
                    type: __COVERTYPES.Expression,
                    executed: false
                })`);
            replacer.visit(registerStmt);
            const coverExpression = SimpleParser.parseExpression(`(__COVER("${point.hash}"), $$REPLACE_ME)`);
            replacer.visit(coverExpression);
            coverExpression.expression.expressions[1] = falseExpression;
            node.ifElse = coverExpression;
            this.globalStatements.push(registerStmt);
        }
    }
    visitSwitchCase(node) {
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        const path = node.range.source.normalizedPath;
        const caseLc = getLineCol(node);
        const point = new CoverPoint();
        point.line = caseLc?.line;
        point.column = caseLc?.column;
        point.file = path;
        point.type = CoverType.Block;
        point.hash = hash(point);
        const replacer = new RangeTransform(node);
        const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                file: "${point.file}",
                hash: "${point.hash}",
                line: ${point.line},
                column: ${point.column},
                type: __COVERTYPES.Block,
                executed: false
            })`);
        replacer.visit(registerStmt);
        const coverStmt = SimpleParser.parseStatement(`__COVER("${point.hash}")`);
        replacer.visit(coverStmt);
        this.globalStatements.push(registerStmt);
        super.visitSwitchCase(node);
        node.statements.unshift(coverStmt);
    }
    visitBlockStatement(node) {
        // @ts-ignore
        if (node.visited)
            return;
        // @ts-ignore
        node.visited = true;
        const path = node.range.source.normalizedPath;
        const blockLc = getLineCol(node);
        const point = new CoverPoint();
        point.line = blockLc?.line;
        point.column = blockLc?.column;
        point.file = path;
        point.type = CoverType.Block;
        point.hash = hash(point);
        const replacer = new RangeTransform(node);
        const registerStmt = SimpleParser.parseTopLevelStatement(`__REGISTER({
                file: "${point.file}",
                hash: "${point.hash}",
                line: ${point.line},
                column: ${point.column},
                type: __COVERTYPES.Block,
                executed: false
            })`);
        replacer.visit(registerStmt);
        const coverStmt = SimpleParser.parseStatement(`__COVER("${point.hash}")`);
        replacer.visit(coverStmt);
        this.globalStatements.push(registerStmt);
        super.visitBlockStatement(node);
        node.statements.unshift(coverStmt);
    }
    visitSource(node) {
        super.visitSource(node);
    }
}
class CoverageFinder extends BaseVisitor {
    visitObjectLiteralExpression(node) {
        for (let i = 0; i < node.names.length; i++) {
            const name = node.names[i];
            if (name.text === "coverage") {
                const v = node.values[i];
                if (v.kind === 25 /* NodeKind.True */) {
                    ENABLED = true;
                }
            }
        }
    }
}
export default class Transformer extends Transform {
    // Trigger the transform after parse.
    afterParse(parser) {
        for (const source of parser.sources) {
            if (source.sourceKind === 1 /* SourceKind.UserEntry */) {
                const transform = new CoverageFinder();
                transform.visit(source);
            }
        }
        if (!ENABLED)
            return;
        // Create new transform
        const transformer = new CoverageTransform();
        // Sort the sources so that user scripts are visited last
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
        // Loop over every source
        for (const source of sources) {
            if (source.isLibrary)
                continue;
            if (source.simplePath === "coverage")
                continue;
            // Ignore all lib and std. Visit everything else.
            if (!isStdlib(source)) {
                transformer.visit(source);
                if (transformer.globalStatements.length) {
                    source.statements.unshift(...transformer.globalStatements);
                    const tokenizer = new Tokenizer(new Source(0 /* SourceKind.User */, source.normalizedPath, "import { __REGISTER, __COVER, __COVERTYPES, __COVERAGE_STATS } from \"as-test/coverage\";"));
                    parser.currentSource = tokenizer.source;
                    source.statements.unshift(parser.parseTopLevelStatement(tokenizer));
                    parser.currentSource = source;
                    // @ts-ignore
                    if (process && process.env["TEST_DEBUG"]?.toString().toLowerCase() == "all") {
                        console.log(toString(source));
                    }
                }
            }
            transformer.globalStatements = [];
        }
    }
}
/**
 * A simple djb2hash that returns a hash of a given string. See http://www.cse.yorku.ca/~oz/hash.html
 * for implementation details.
 *
 * @param {string} str - The string to be hashed
 * @returns {number} The hash of the string
 */
function djb2Hash(str) {
    const points = Array.from(str);
    let h = 5381;
    for (let p = 0; p < points.length; p++)
        // h = (h * 31 + c) | 0;
        h = ((h << 5) - h + points[p].codePointAt(0)) | 0;
    return h;
}
function hash(point) {
    const hsh = djb2Hash(point.file + point.line.toString() + point.column.toString() + point.type.toString());
    if (hsh < 0) {
        const out = hsh.toString(16);
        return "3" + out.slice(1);
    }
    else {
        return hsh.toString(16);
    }
}
class LineColumn {
}
function getLineCol(node) {
    return {
        line: node.range.source.lineAt(node.range.start),
        column: node.range.source.columnAt()
    };
}
