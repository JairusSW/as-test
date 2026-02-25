import { BlockStatement, ExpressionStatement, Node, } from "assemblyscript/dist/assemblyscript.js";
import { RangeTransform } from "./range.js";
import { isStdlib, SimpleParser } from "./util.js";
import { Visitor } from "./visitor.js";
var CoverType;
(function (CoverType) {
    CoverType[CoverType["Function"] = 0] = "Function";
    CoverType[CoverType["Expression"] = 1] = "Expression";
    CoverType[CoverType["Block"] = 2] = "Block";
})(CoverType || (CoverType = {}));
const COVERAGE_IGNORED_CALLS = new Set([
    "beforeAll",
    "afterAll",
    "mockFn",
    "unmockFn",
    "mockImport",
    "unmockImport",
    "snapshotImport",
    "restoreImport",
]);
const COVERAGE_IGNORED_BUILTINS = new Set([
    "alignof",
    "changetype",
    "idof",
    "isArray",
    "isArrayLike",
    "isBoolean",
    "isConstant",
    "isDefined",
    "isFloat",
    "isFunction",
    "isInteger",
    "isManaged",
    "isNullable",
    "isReference",
    "isSigned",
    "isString",
    "isUnsigned",
    "load",
    "nameof",
    "offsetof",
    "sizeof",
    "store",
    "unchecked",
]);
class CoverPoint {
    file = "";
    hash = "";
    line = 0;
    column = 0;
    type;
    executed = false;
}
export class CoverageTransform extends Visitor {
    mustImport = false;
    points = new Map();
    globalStatements = [];
    visitCallExpression(node) {
        const callName = getCallName(node);
        if (callName && COVERAGE_IGNORED_CALLS.has(callName)) {
            this.visit(node.expression, node);
            this.visit(node.typeArguments, node);
            for (const arg of node.args) {
                if (arg.kind == 14)
                    continue;
                this.visit(arg, node);
            }
            return;
        }
        super.visitCallExpression(node);
    }
    visitDecoratorNode(_node, _ref) { }
    visitBinaryExpression(node) {
        super.visitBinaryExpression(node);
        if (node.visited)
            return;
        node.visited = true;
        const path = node.range.source.normalizedPath;
        switch (node.operator) {
            case 98:
            case 97: {
                const right = node.right;
                if (isBuiltinCallExpression(right))
                    break;
                const rightLc = getLineCol(node);
                const point = new CoverPoint();
                point.line = rightLc?.line;
                point.column = rightLc?.column;
                point.file = path;
                point.type = CoverType.Expression;
                point.hash = hash(point);
                const replacer = new RangeTransform(node);
                const registerStmt = createRegisterStatement(point);
                replacer.visit(registerStmt);
                const coverExpression = createCoverExpression(point.hash, right, node);
                replacer.visit(coverExpression);
                node.right = coverExpression;
                this.globalStatements.push(registerStmt);
                break;
            }
        }
    }
    visitMethodDeclaration(node) {
        super.visitMethodDeclaration(node);
        if (node.visited)
            return;
        node.visited = true;
        if (node.body) {
            if (node.body.visited)
                return;
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
            const registerStmt = createRegisterStatement(point);
            replacer.visit(registerStmt);
            const coverStmt = createCoverStatement(point.hash, node);
            replacer.visit(coverStmt);
            const bodyBlock = node.body;
            bodyBlock.statements.unshift(coverStmt);
            this.globalStatements.push(registerStmt);
        }
    }
    visitParameter(node) {
        if (node.visited)
            return;
        node.visited = true;
        const path = node.range.source.normalizedPath;
        if (node.initializer) {
            if (node.initializer.visited)
                return;
            node.initializer.visited = true;
            super.visitParameter(node);
            if (isBuiltinCallExpression(node.initializer))
                return;
            const paramLc = getLineCol(node.initializer);
            const point = new CoverPoint();
            point.line = paramLc?.line;
            point.column = paramLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(node);
            const registerStmt = createRegisterStatement(point);
            replacer.visit(registerStmt);
            const coverExpression = createCoverExpression(point.hash, node.initializer, node);
            replacer.visit(coverExpression);
            node.initializer = coverExpression;
            this.globalStatements.push(registerStmt);
        }
    }
    visitFunctionDeclaration(node, isDefault) {
        super.visitFunctionDeclaration(node, isDefault);
        if (node.visited)
            return;
        node.visited = true;
        if (node.body) {
            if (node.body.visited)
                return;
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
            const registerStmt = createRegisterStatement(point);
            replacer.visit(registerStmt);
            this.globalStatements.push(registerStmt);
            if (node.body.kind === 35) {
                const coverStmt = SimpleParser.parseStatement(`{
                __COVER("${point.hash}")
                return $$REPLACE_ME
            }`);
                replacer.visit(coverStmt);
                const bodyReturn = coverStmt.statements[1];
                const body = node.body;
                node.arrowKind = 2;
                bodyReturn.value = body.expression;
                node.body = body;
            }
            else {
                const coverStmt = createCoverStatement(point.hash, node);
                replacer.visit(coverStmt);
                if (node.body instanceof BlockStatement) {
                    node.body.statements.unshift(coverStmt);
                }
                else if (node.body instanceof ExpressionStatement) {
                    const expression = node.body.expression;
                    node.body = Node.createBlockStatement([Node.createReturnStatement(expression, expression.range)], expression.range);
                    const bodyBlock = node.body;
                    bodyBlock.statements.unshift(coverStmt);
                }
            }
        }
    }
    visitIfStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        let visitIfTrue = false;
        let visitIfFalse = false;
        const ifTrue = node.ifTrue;
        const ifFalse = node.ifFalse;
        const path = node.range.source.normalizedPath;
        if (ifTrue.kind !== 30 && !isBuiltinStatement(ifTrue)) {
            const trueLc = getLineCol(ifTrue);
            const point = new CoverPoint();
            point.line = trueLc?.line;
            point.column = trueLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(ifTrue);
            const registerStmt = createRegisterStatement(point);
            replacer.visit(registerStmt);
            const coverStmt = Node.createBlockStatement([createCoverStatement(point.hash, ifTrue)], ifTrue.range);
            replacer.visit(coverStmt);
            coverStmt.statements.push(ifTrue);
            node.ifTrue = coverStmt;
            this.globalStatements.push(registerStmt);
            visitIfTrue = true;
            visitIfFalse = !!ifFalse;
        }
        if (ifFalse &&
            ifFalse.kind !== 30 &&
            !isBuiltinStatement(ifFalse)) {
            const falseLc = getLineCol(ifFalse);
            const point = new CoverPoint();
            point.line = falseLc?.line;
            point.column = falseLc?.column;
            point.file = path;
            point.type = CoverType.Expression;
            point.hash = hash(point);
            const replacer = new RangeTransform(ifFalse);
            const registerStmt = createRegisterStatement(point);
            replacer.visit(registerStmt);
            const coverStmt = Node.createBlockStatement([createCoverStatement(point.hash, ifFalse)], ifFalse.range);
            replacer.visit(coverStmt);
            coverStmt.statements.push(ifFalse);
            node.ifFalse = coverStmt;
            this.globalStatements.push(registerStmt);
            visitIfTrue = true;
            visitIfFalse = true;
        }
        if (visitIfTrue || visitIfFalse) {
            if (visitIfTrue) {
                if (ifTrue.visited)
                    return;
                ifTrue.visited = true;
                this.visit(ifTrue);
            }
            if (visitIfFalse) {
                if (ifFalse.visited)
                    return;
                ifFalse.visited = true;
                this.visit(ifFalse);
            }
        }
        else {
            super.visitIfStatement(node);
        }
    }
    visitTernaryExpression(node) {
        if (node.visited)
            return;
        node.visited = true;
        super.visitTernaryExpression(node);
        const trueExpression = node.ifThen;
        const falseExpression = node.ifElse;
        const path = node.range.source.normalizedPath;
        {
            if (!isBuiltinCallExpression(trueExpression)) {
                const trueLc = getLineCol(trueExpression);
                const point = new CoverPoint();
                point.line = trueLc?.line;
                point.column = trueLc?.column;
                point.file = path;
                point.type = CoverType.Expression;
                point.hash = hash(point);
                const replacer = new RangeTransform(trueExpression);
                const registerStmt = createRegisterStatement(point);
                replacer.visit(registerStmt);
                const coverExpression = createCoverExpression(point.hash, trueExpression, trueExpression);
                replacer.visit(coverExpression);
                node.ifThen = coverExpression;
                this.globalStatements.push(registerStmt);
            }
        }
        {
            if (!isBuiltinCallExpression(falseExpression)) {
                const falseLc = getLineCol(falseExpression);
                const point = new CoverPoint();
                point.line = falseLc?.line;
                point.column = falseLc?.column;
                point.file = path;
                point.type = CoverType.Expression;
                point.hash = hash(point);
                const replacer = new RangeTransform(falseExpression);
                const registerStmt = createRegisterStatement(point);
                replacer.visit(registerStmt);
                const coverExpression = createCoverExpression(point.hash, falseExpression, falseExpression);
                replacer.visit(coverExpression);
                node.ifElse = coverExpression;
                this.globalStatements.push(registerStmt);
            }
        }
    }
    visitSwitchCase(node) {
        if (node.visited)
            return;
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
        const registerStmt = createRegisterStatement(point);
        replacer.visit(registerStmt);
        const coverStmt = createCoverStatement(point.hash, node);
        replacer.visit(coverStmt);
        this.globalStatements.push(registerStmt);
        super.visitSwitchCase(node);
        node.statements.unshift(coverStmt);
    }
    visitBlockStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        if (!isConcreteSourceBlock(node)) {
            super.visitBlockStatement(node);
            return;
        }
        const path = node.range.source.normalizedPath;
        const blockLc = getLineCol(node);
        const point = new CoverPoint();
        point.line = blockLc?.line;
        point.column = blockLc?.column;
        point.file = path;
        point.type = CoverType.Block;
        point.hash = hash(point);
        const replacer = new RangeTransform(node);
        const registerStmt = createRegisterStatement(point);
        replacer.visit(registerStmt);
        const coverStmt = createCoverStatement(point.hash, node);
        replacer.visit(coverStmt);
        this.globalStatements.push(registerStmt);
        super.visitBlockStatement(node);
        node.statements.unshift(coverStmt);
    }
    visitSource(node) {
        if (node.isLibrary)
            return;
        if (node.simplePath === "coverage")
            return;
        if (isStdlib(node))
            return;
        super.visitSource(node);
    }
}
function getCallName(node) {
    return getExpressionName(node.expression);
}
function isBuiltinStatement(node) {
    if (node.kind !== 38)
        return false;
    return isBuiltinCallExpression(node.expression);
}
function isBuiltinCallExpression(node) {
    const unwrapped = unwrapParenthesized(node);
    if (unwrapped.kind !== 9)
        return false;
    const call = unwrapped;
    const expression = unwrapParenthesized(call.expression);
    if (expression.kind !== 6)
        return false;
    const name = expression.text;
    return COVERAGE_IGNORED_BUILTINS.has(name);
}
function unwrapParenthesized(node) {
    let current = node;
    while (current.kind === 20) {
        current = current.expression;
    }
    return current;
}
function getExpressionName(node) {
    switch (node.kind) {
        case 6:
            return node.text;
        case 21:
            return node.property.text;
        case 20:
            return getExpressionName(node.expression);
        default:
            return null;
    }
}
function djb2Hash(str) {
    const points = Array.from(str);
    let h = 5381;
    for (let p = 0; p < points.length; p++)
        h = ((h << 5) - h + points[p].codePointAt(0)) | 0;
    return h;
}
function hash(point) {
    const hsh = djb2Hash(point.file +
        point.line.toString() +
        point.column.toString() +
        point.type.toString());
    if (hsh < 0) {
        const out = hsh.toString(16);
        return "3" + out.slice(1);
    }
    else {
        return hsh.toString(16);
    }
}
class LineColumn {
    line;
    column;
}
function getLineCol(node) {
    return {
        line: node.range.source.lineAt(node.range.start),
        column: node.range.source.columnAt(),
    };
}
function createRegisterStatement(point) {
    return SimpleParser.parseTopLevelStatement(`__REGISTER_RAW(${asStringLiteral(point.file)}, ${asStringLiteral(point.hash)}, ${point.line}, ${point.column}, ${asStringLiteral(coverTypeToString(point.type))})`);
}
function createCoverStatement(hashValue, ref) {
    return Node.createExpressionStatement(createCoverCallExpression(hashValue, ref));
}
function createCoverExpression(hashValue, replacement, ref) {
    return Node.createParenthesizedExpression(Node.createCommaExpression([createCoverCallExpression(hashValue, ref), replacement], ref.range), ref.range);
}
function createCoverCallExpression(hashValue, ref) {
    return Node.createCallExpression(Node.createIdentifierExpression("__COVER", ref.range), null, [Node.createStringLiteralExpression(hashValue, ref.range)], ref.range);
}
function coverTypeToString(type) {
    switch (type) {
        case CoverType.Function:
            return "Function";
        case CoverType.Expression:
            return "Expression";
        default:
            return "Block";
    }
}
function asStringLiteral(value) {
    return JSON.stringify(value);
}
function isConcreteSourceBlock(node) {
    const source = node.range.source;
    const start = node.range.start;
    if (start < 0 || start >= source.text.length)
        return false;
    return source.text.charCodeAt(start) == 123;
}
//# sourceMappingURL=coverage.js.map