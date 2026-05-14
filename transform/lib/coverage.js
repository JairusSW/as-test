import { BlockStatement, ExpressionStatement, Node, } from "assemblyscript/dist/assemblyscript.js";
import { RangeTransform } from "./range.js";
import { isStdlib, SimpleParser } from "./util.js";
import { Visitor } from "./visitor.js";
import { NodeKind } from "./types.js";
const COVERAGE_IGNORED_CALLS = new Set([
    "beforeAll",
    "afterAll",
    "mockFn",
    "unmockFn",
    "mockImport",
    "unmockImport",
    "snapshotFn",
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
    "isVector",
    "isVoid",
    "isUnsigned",
    "lengthof",
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
    type = "Expression";
    executed = false;
    parentHash = "";
    scopeKind = "";
    scopeName = "";
    depth = 0;
}
export class CoverageTransform extends Visitor {
    mustImport = false;
    points = new Map();
    globalStatements = [];
    scopeStack = [];
    getCurrentScope() {
        return this.scopeStack.length
            ? this.scopeStack[this.scopeStack.length - 1]
            : null;
    }
    withScope(point, callback) {
        this.scopeStack.push(point);
        try {
            callback();
        }
        finally {
            this.scopeStack.pop();
        }
    }
    assignParentMetadata(point) {
        const currentScope = this.getCurrentScope();
        if (!currentScope)
            return;
        point.parentHash = currentScope.hash;
        point.scopeKind = currentScope.scopeKind;
        point.scopeName = currentScope.scopeName;
        point.depth = currentScope.depth + 1;
    }
    assignScopeMetadata(point, scopeKind, scopeName = null) {
        point.scopeKind = scopeKind;
        point.scopeName = scopeName ?? "";
    }
    createFunctionPoint(path, node, scopeKind, scopeName = null) {
        const funcLc = getLineCol(node);
        const point = new CoverPoint();
        point.line = funcLc?.line;
        point.column = funcLc?.column;
        point.file = path;
        point.type = scopeKind;
        this.assignParentMetadata(point);
        this.assignScopeMetadata(point, scopeKind, scopeName);
        point.hash = hash(point);
        return point;
    }
    createPoint(path, node, type) {
        const lc = getLineCol(node);
        const point = new CoverPoint();
        point.line = lc?.line;
        point.column = lc?.column;
        point.file = path;
        point.type = type;
        this.assignParentMetadata(point);
        point.hash = hash(point);
        return point;
    }
    instrumentStatementBody(path, node, type) {
        const point = this.createPoint(path, node, type);
        const replacer = new RangeTransform(node);
        const registerStmt = createRegisterStatement(point);
        replacer.visit(registerStmt);
        const coverStmt = createCoverStatement(point.hash, node);
        replacer.visit(coverStmt);
        this.globalStatements.push(registerStmt);
        if (node.kind == NodeKind.Block) {
            const block = node;
            block.statements.unshift(coverStmt);
            return block;
        }
        const coverBlock = Node.createBlockStatement([coverStmt], node.range);
        replacer.visit(coverBlock);
        coverBlock.statements.push(node);
        return coverBlock;
    }
    isAssignmentOperator(operator) {
        switch (operator) {
            case 101:
            case 102:
            case 103:
            case 104:
            case 105:
            case 106:
            case 107:
            case 108:
            case 109:
            case 110:
            case 111:
            case 112:
            case 113:
                return true;
            default:
                return false;
        }
    }
    visitCallExpression(node) {
        const callName = getCallName(node);
        if (callName && COVERAGE_IGNORED_CALLS.has(callName)) {
            this.visit(node.expression, node);
            this.visit(node.typeArguments, node);
            for (const arg of node.args) {
                if (arg.kind == NodeKind.Function)
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
                point.type = "LogicalBranch";
                this.assignParentMetadata(point);
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
            default: {
                if (!this.isAssignmentOperator(node.operator))
                    break;
                const right = node.right;
                if (isBuiltinCallExpression(right))
                    break;
                const point = this.createPoint(path, right, "Assignment");
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
        if (node.visited)
            return;
        node.visited = true;
        if (node.body) {
            if (node.body.visited)
                return;
            node.body.visited = true;
            const path = node.range.source.normalizedPath;
            const methodName = getNodeName(node.name);
            const scopeKind = methodName == "constructor" ? "Constructor" : "Method";
            const point = this.createFunctionPoint(path, node, scopeKind, methodName);
            const replacer = new RangeTransform(node);
            const registerStmt = createRegisterStatement(point);
            replacer.visit(registerStmt);
            const coverStmt = createCoverStatement(point.hash, node);
            replacer.visit(coverStmt);
            const bodyBlock = node.body;
            bodyBlock.statements.unshift(coverStmt);
            this.globalStatements.push(registerStmt);
            this.withScope(point, () => {
                this.visit(node.name, node);
                this.visit(node.typeParameters, node);
                this.visit(node.signature, node);
                this.visit(node.decorators, node);
                this.visit(bodyBlock.statements, bodyBlock);
            });
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
            point.type = "DefaultValue";
            this.assignParentMetadata(point);
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
    visitFunctionDeclaration(node) {
        if (node.visited)
            return;
        node.visited = true;
        if (node.body) {
            if (node.body.visited)
                return;
            node.body.visited = true;
            const path = node.range.source.normalizedPath;
            const point = this.createFunctionPoint(path, node, "Function", node.name?.text ?? null);
            const replacer = new RangeTransform(node);
            const registerStmt = createRegisterStatement(point);
            replacer.visit(registerStmt);
            this.globalStatements.push(registerStmt);
            if (node.body.kind === NodeKind.Export) {
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
                    const exprBody = node.body;
                    exprBody.expression = createCoverExpression(point.hash, exprBody.expression, node);
                }
                this.withScope(point, () => {
                    this.visit(node.name, node);
                    this.visit(node.decorators, node);
                    this.visit(node.typeParameters, node);
                    this.visit(node.signature, node);
                    if (node.body instanceof BlockStatement) {
                        this.visit(node.body.statements, node.body);
                    }
                    else {
                        this.visit(node.body, node);
                    }
                });
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
        if (ifTrue &&
            ifTrue.kind !== NodeKind.Block &&
            !isBuiltinStatement(ifTrue)) {
            node.ifTrue = this.instrumentStatementBody(path, ifTrue, "IfBranch");
            visitIfTrue = true;
            visitIfFalse = !!ifFalse;
        }
        if (ifFalse &&
            ifFalse.kind !== NodeKind.Block &&
            !isBuiltinStatement(ifFalse)) {
            node.ifFalse = this.instrumentStatementBody(path, ifFalse, "IfBranch");
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
                point.type = "Ternary";
                this.assignParentMetadata(point);
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
                point.type = "Ternary";
                this.assignParentMetadata(point);
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
    visitForStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        const path = node.range.source.normalizedPath;
        node.body = this.instrumentStatementBody(path, node.body, "Loop");
        super.visitForStatement(node);
    }
    visitForOfStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        const path = node.range.source.normalizedPath;
        node.body = this.instrumentStatementBody(path, node.body, "Loop");
        super.visitForOfStatement(node);
    }
    visitWhileStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        const path = node.range.source.normalizedPath;
        node.body = this.instrumentStatementBody(path, node.body, "Loop");
        super.visitWhileStatement(node);
    }
    visitDoStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        const path = node.range.source.normalizedPath;
        node.body = this.instrumentStatementBody(path, node.body, "Loop");
        super.visitDoStatement(node);
    }
    visitReturnStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        super.visitReturnStatement(node);
        if (!node.value || isBuiltinCallExpression(node.value))
            return;
        if (node.value.kind === NodeKind.This)
            return;
        const path = node.range.source.normalizedPath;
        const point = this.createPoint(path, node.value, "Return");
        const replacer = new RangeTransform(node);
        const registerStmt = createRegisterStatement(point);
        replacer.visit(registerStmt);
        const coverExpression = createCoverExpression(point.hash, node.value, node);
        replacer.visit(coverExpression);
        node.value = coverExpression;
        this.globalStatements.push(registerStmt);
    }
    visitThrowStatement(node) {
        if (node.visited)
            return;
        node.visited = true;
        super.visitThrowStatement(node);
        if (!node.value || isBuiltinCallExpression(node.value))
            return;
        const path = node.range.source.normalizedPath;
        const point = this.createPoint(path, node.value, "Throw");
        const replacer = new RangeTransform(node);
        const registerStmt = createRegisterStatement(point);
        replacer.visit(registerStmt);
        const coverExpression = createCoverExpression(point.hash, node.value, node);
        replacer.visit(coverExpression);
        node.value = coverExpression;
        this.globalStatements.push(registerStmt);
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
        point.type = "SwitchCase";
        this.assignParentMetadata(point);
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
        point.type = "Block";
        this.assignParentMetadata(point);
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
    if (node.kind !== NodeKind.Expression)
        return false;
    return isBuiltinCallExpression(node.expression);
}
function isBuiltinCallExpression(node) {
    const unwrapped = unwrapParenthesized(node);
    if (unwrapped.kind !== NodeKind.Call)
        return false;
    const call = unwrapped;
    const expression = unwrapParenthesized(call.expression);
    if (expression.kind !== NodeKind.Identifier)
        return false;
    const name = expression.text;
    return COVERAGE_IGNORED_BUILTINS.has(name);
}
function unwrapParenthesized(node) {
    let current = node;
    while (current.kind === NodeKind.Parenthesized) {
        current = current.expression;
    }
    return current;
}
function getExpressionName(node) {
    switch (node.kind) {
        case NodeKind.Identifier:
            return node.text;
        case NodeKind.PropertyAccess:
            return node.property.text;
        case NodeKind.Parenthesized:
            return getExpressionName(node.expression);
        default:
            return null;
    }
}
function getNodeName(node) {
    if (!node)
        return null;
    return getExpressionName(node);
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
    return SimpleParser.parseTopLevelStatement(`__REGISTER_RAW(${asStringLiteral(point.file)}, ${asStringLiteral(point.hash)}, ${point.line}, ${point.column}, ${asStringLiteral(point.type)}, ${asStringLiteral(point.parentHash)}, ${asStringLiteral(point.scopeKind)}, ${asStringLiteral(point.scopeName)}, ${point.depth})`);
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
