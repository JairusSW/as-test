import {
  Source,
  Statement,
  Token,
  CallExpression,
  BinaryExpression,
  CommaExpression,
  IdentifierExpression,
  PropertyAccessExpression,
  ParenthesizedExpression,
  Expression,
  ParameterNode,
  BlockStatement,
  ExpressionStatement,
  FunctionDeclaration,
  IfStatement,
  MethodDeclaration,
  ReturnStatement,
  SwitchCase,
  TernaryExpression,
  NodeKind,
  ArrowKind,
  Node,
} from "assemblyscript/dist/assemblyscript.js";
import { RangeTransform } from "./range.js";
import { isStdlib, SimpleParser } from "./util.js";
import { Visitor } from "./visitor.js";
import { DecoratorNode } from "types:assemblyscript/src/ast";

enum CoverType {
  Function,
  Expression,
  Block,
}

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
  public file: string = "";
  public hash: string = "";
  public line: number = 0;
  public column: number = 0;
  public type!: CoverType;
  public executed: boolean = false;
}

export class CoverageTransform extends Visitor {
  public mustImport: boolean = false;
  public points: Map<string, CoverPoint> = new Map<string, CoverPoint>();
  public globalStatements: Statement[] = [];
  visitCallExpression(node: CallExpression): void {
    const callName = getCallName(node);
    if (callName && COVERAGE_IGNORED_CALLS.has(callName)) {
      this.visit(node.expression, node);
      this.visit(node.typeArguments, node);
      for (const arg of node.args) {
        if (arg.kind == NodeKind.Function) continue;
        this.visit(arg, node);
      }
      return;
    }
    super.visitCallExpression(node);
  }
  visitDecoratorNode(_node: DecoratorNode, _ref?: Node | null): void {}
  visitBinaryExpression(node: BinaryExpression): void {
    super.visitBinaryExpression(node);
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    const path = node.range.source.normalizedPath;

    switch (node.operator) {
      case Token.Bar_Bar:
      case Token.Ampersand_Ampersand: {
        const right = node.right;
        if (isBuiltinCallExpression(right)) break;
        const rightLc = getLineCol(node);

        const point = new CoverPoint();
        point.line = rightLc?.line!;
        point.column = rightLc?.column!;
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
  visitMethodDeclaration(node: MethodDeclaration): void {
    super.visitMethodDeclaration(node);
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    if (node.body) {
      // @ts-ignore
      if (node.body.visited) return;
      // @ts-ignore
      node.body.visited = true;
      const path = node.range.source.normalizedPath;
      const funcLc = getLineCol(node);

      const point = new CoverPoint();
      point.line = funcLc?.line!;
      point.column = funcLc?.column!;
      point.file = path;
      point.type = CoverType.Function;

      point.hash = hash(point);

      const replacer = new RangeTransform(node);
      const registerStmt = createRegisterStatement(point);
      replacer.visit(registerStmt);

      const coverStmt = createCoverStatement(point.hash, node);
      replacer.visit(coverStmt);

      const bodyBlock = node.body as BlockStatement;
      bodyBlock.statements.unshift(coverStmt);

      this.globalStatements.push(registerStmt);
    }
  }
  visitParameter(node: ParameterNode): void {
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    const path = node.range.source.normalizedPath;
    if (node.initializer) {
      // @ts-ignore
      if (node.initializer.visited) return;
      // @ts-ignore
      node.initializer.visited = true;
      super.visitParameter(node);
      if (isBuiltinCallExpression(node.initializer)) return;
      const paramLc = getLineCol(node.initializer);

      const point = new CoverPoint();
      point.line = paramLc?.line!;
      point.column = paramLc?.column!;
      point.file = path;
      point.type = CoverType.Expression;

      point.hash = hash(point);

      const replacer = new RangeTransform(node);
      const registerStmt = createRegisterStatement(point);
      replacer.visit(registerStmt);

      const coverExpression = createCoverExpression(
        point.hash,
        node.initializer,
        node,
      );
      replacer.visit(coverExpression);

      node.initializer = coverExpression;

      this.globalStatements.push(registerStmt);
    }
  }
  visitFunctionDeclaration(
    node: FunctionDeclaration,
    isDefault?: boolean | undefined,
  ): void {
    super.visitFunctionDeclaration(node, isDefault);
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    if (node.body) {
      // @ts-ignore
      if (node.body.visited) return;
      // @ts-ignore
      node.body.visited = true;

      const path = node.range.source.normalizedPath;
      const funcLc = getLineCol(node);
      const point = new CoverPoint();
      point.line = funcLc?.line!;
      point.column = funcLc?.column!;
      point.file = path;
      point.type = CoverType.Function;

      point.hash = hash(point);

      const replacer = new RangeTransform(node);
      const registerStmt = createRegisterStatement(point);
      replacer.visit(registerStmt);

      this.globalStatements.push(registerStmt);

      if (node.body.kind === NodeKind.Export) {
        const coverStmt = SimpleParser.parseStatement(`{
                __COVER("${point.hash}")
                return $$REPLACE_ME
            }`) as BlockStatement;
        replacer.visit(coverStmt);

        const bodyReturn = coverStmt.statements[1] as ReturnStatement;
        const body = node.body as ExpressionStatement;
        node.arrowKind = ArrowKind.Single;
        bodyReturn.value = body.expression;
        node.body = body;
      } else {
        const coverStmt = createCoverStatement(point.hash, node);
        replacer.visit(coverStmt);

        if (node.body instanceof BlockStatement) {
          node.body.statements.unshift(coverStmt);
        } else if (node.body instanceof ExpressionStatement) {
          const expression = (node.body as ExpressionStatement).expression;
          node.body = Node.createBlockStatement(
            [Node.createReturnStatement(expression, expression.range)],
            expression.range,
          );

          const bodyBlock = node.body as BlockStatement;
          bodyBlock.statements.unshift(coverStmt);
        }
      }
    }
  }
  visitIfStatement(node: IfStatement): void {
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    let visitIfTrue = false;
    let visitIfFalse = false;

    const ifTrue = node.ifTrue;
    const ifFalse = node.ifFalse;

    const path = node.range.source.normalizedPath;

    if (ifTrue.kind !== NodeKind.Block && !isBuiltinStatement(ifTrue)) {
      const trueLc = getLineCol(ifTrue);
      const point = new CoverPoint();

      point.line = trueLc?.line!;
      point.column = trueLc?.column!;
      point.file = path;
      point.type = CoverType.Expression;

      point.hash = hash(point);

      const replacer = new RangeTransform(ifTrue);

      const registerStmt = createRegisterStatement(point);
      replacer.visit(registerStmt);

      const coverStmt = Node.createBlockStatement(
        [createCoverStatement(point.hash, ifTrue)],
        ifTrue.range,
      );
      replacer.visit(coverStmt);

      coverStmt.statements.push(ifTrue);
      node.ifTrue = coverStmt;

      this.globalStatements.push(registerStmt);

      visitIfTrue = true;
      visitIfFalse = !!ifFalse;
    }

    if (
      ifFalse &&
      ifFalse.kind !== NodeKind.Block &&
      !isBuiltinStatement(ifFalse)
    ) {
      const falseLc = getLineCol(ifFalse);
      const point = new CoverPoint();

      point.line = falseLc?.line!;
      point.column = falseLc?.column!;
      point.file = path;
      point.type = CoverType.Expression;

      point.hash = hash(point);

      const replacer = new RangeTransform(ifFalse);

      const registerStmt = createRegisterStatement(point);
      replacer.visit(registerStmt);

      const coverStmt = Node.createBlockStatement(
        [createCoverStatement(point.hash, ifFalse)],
        ifFalse.range,
      );
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
        if (ifTrue.visited) return;
        // @ts-ignore
        ifTrue.visited = true;
        this.visit(ifTrue);
      }
      if (visitIfFalse) {
        // @ts-ignore
        if (ifFalse.visited) return;
        // @ts-ignore
        ifFalse.visited = true;
        this.visit(ifFalse!);
      }
    } else {
      super.visitIfStatement(node);
    }
  }
  visitTernaryExpression(node: TernaryExpression): void {
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    super.visitTernaryExpression(node);

    const trueExpression = node.ifThen;
    const falseExpression = node.ifElse;

    const path = node.range.source.normalizedPath;
    {
      if (!isBuiltinCallExpression(trueExpression)) {
        const trueLc = getLineCol(trueExpression);
        const point = new CoverPoint();
        point.line = trueLc?.line!;
        point.column = trueLc?.column!;
        point.file = path;
        point.type = CoverType.Expression;

        point.hash = hash(point);

        const replacer = new RangeTransform(trueExpression);

        const registerStmt = createRegisterStatement(point);
        replacer.visit(registerStmt);

        const coverExpression = createCoverExpression(
          point.hash,
          trueExpression,
          trueExpression,
        );
        replacer.visit(coverExpression);
        node.ifThen = coverExpression;

        this.globalStatements.push(registerStmt);
      }
    }
    {
      if (!isBuiltinCallExpression(falseExpression)) {
        const falseLc = getLineCol(falseExpression);
        const point = new CoverPoint();
        point.line = falseLc?.line!;
        point.column = falseLc?.column!;
        point.file = path;
        point.type = CoverType.Expression;

        point.hash = hash(point);

        const replacer = new RangeTransform(falseExpression);

        const registerStmt = createRegisterStatement(point);
        replacer.visit(registerStmt);

        const coverExpression = createCoverExpression(
          point.hash,
          falseExpression,
          falseExpression,
        );
        replacer.visit(coverExpression);
        node.ifElse = coverExpression;
        this.globalStatements.push(registerStmt);
      }
    }
  }
  visitSwitchCase(node: SwitchCase): void {
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    const path = node.range.source.normalizedPath;
    const caseLc = getLineCol(node);

    const point = new CoverPoint();
    point.line = caseLc?.line!;
    point.column = caseLc?.column!;
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
  visitBlockStatement(node: BlockStatement): void {
    // @ts-ignore
    if (node.visited) return;
    // @ts-ignore
    node.visited = true;
    if (!isConcreteSourceBlock(node)) {
      super.visitBlockStatement(node);
      return;
    }
    const path = node.range.source.normalizedPath;

    const blockLc = getLineCol(node);

    const point = new CoverPoint();
    point.line = blockLc?.line!;
    point.column = blockLc?.column!;
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
  visitSource(node: Source): void {
    if (node.isLibrary) return;
    if (node.simplePath === "coverage") return;
    // Ignore all lib and std. Visit everything else.
    if (isStdlib(node)) return;
    super.visitSource(node);
  }
}

function getCallName(node: CallExpression): string | null {
  return getExpressionName(node.expression);
}

function isBuiltinStatement(node: Node): boolean {
  if (node.kind !== NodeKind.Expression) return false;
  return isBuiltinCallExpression((node as ExpressionStatement).expression);
}

function isBuiltinCallExpression(node: Node): boolean {
  const unwrapped = unwrapParenthesized(node);
  if (unwrapped.kind !== NodeKind.Call) return false;
  const call = unwrapped as CallExpression;
  const expression = unwrapParenthesized(call.expression);
  if (expression.kind !== NodeKind.Identifier) return false;
  const name = (expression as IdentifierExpression).text;
  return COVERAGE_IGNORED_BUILTINS.has(name);
}

function unwrapParenthesized(node: Node): Node {
  let current = node;
  while (current.kind === NodeKind.Parenthesized) {
    current = (current as ParenthesizedExpression).expression;
  }
  return current;
}

function getExpressionName(node: Node): string | null {
  switch (node.kind) {
    case NodeKind.Identifier:
      return (node as IdentifierExpression).text;
    case NodeKind.PropertyAccess:
      return (
        (node as PropertyAccessExpression).property as IdentifierExpression
      ).text;
    case NodeKind.Parenthesized:
      return getExpressionName((node as ParenthesizedExpression).expression);
    default:
      return null;
  }
}

/**
 * A simple djb2hash that returns a hash of a given string. See http://www.cse.yorku.ca/~oz/hash.html
 * for implementation details.
 *
 * @param {string} str - The string to be hashed
 * @returns {number} The hash of the string
 */
function djb2Hash(str: string): number {
  const points = Array.from(str);
  let h = 5381;
  for (let p = 0; p < points.length; p++)
    // h = (h * 31 + c) | 0;
    h = ((h << 5) - h + points[p]!.codePointAt(0)!) | 0;
  return h;
}

function hash(point: CoverPoint): string {
  const hsh = djb2Hash(
    point.file +
      point.line.toString() +
      point.column.toString() +
      point.type.toString(),
  );
  if (hsh < 0) {
    const out = hsh.toString(16);
    return "3" + out.slice(1);
  } else {
    return hsh.toString(16);
  }
}

class LineColumn {
  public line!: number;
  public column!: number;
}

function getLineCol(node: Node): LineColumn {
  return {
    line: node.range.source.lineAt(node.range.start),
    column: node.range.source.columnAt(),
  };
}

function createRegisterStatement(point: CoverPoint): Statement {
  return SimpleParser.parseTopLevelStatement(
    `__REGISTER_RAW(${asStringLiteral(point.file)}, ${asStringLiteral(point.hash)}, ${point.line}, ${point.column}, ${asStringLiteral(coverTypeToString(point.type))})`,
  );
}

function createCoverStatement(hashValue: string, ref: Node): Statement {
  return Node.createExpressionStatement(
    createCoverCallExpression(hashValue, ref),
  );
}

function createCoverExpression(
  hashValue: string,
  replacement: Expression,
  ref: Node,
): ParenthesizedExpression {
  return Node.createParenthesizedExpression(
    Node.createCommaExpression(
      [createCoverCallExpression(hashValue, ref), replacement] as Expression[],
      ref.range,
    ) as CommaExpression,
    ref.range,
  );
}

function createCoverCallExpression(hashValue: string, ref: Node): CallExpression {
  return Node.createCallExpression(
    Node.createIdentifierExpression("__COVER", ref.range),
    null,
    [Node.createStringLiteralExpression(hashValue, ref.range)],
    ref.range,
  );
}

function coverTypeToString(type: CoverType): string {
  switch (type) {
    case CoverType.Function:
      return "Function";
    case CoverType.Expression:
      return "Expression";
    default:
      return "Block";
  }
}

function asStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function isConcreteSourceBlock(node: BlockStatement): boolean {
  const source = node.range.source;
  const start = node.range.start;
  if (start < 0 || start >= source.text.length) return false;
  return source.text.charCodeAt(start) == 123; // "{"
}
