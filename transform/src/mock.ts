import {
  Source,
  Statement,
  CallExpression,
  StringLiteralExpression,
  FunctionExpression,
  CommonFlags,
  Node,
  ArrowKind,
  IdentifierExpression,
  Expression,
  FunctionDeclaration,
} from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";
import { toString } from "./util.js";
export class MockTransform extends Visitor {
  public srcCurrent: Source | null = null;
  public globalStatements: Statement[] = [];
  public mocked = new Set<string>();
  public importMocked: Set<string> = new Set<string>();
  visitCallExpression(node: CallExpression): void {
    super.visitCallExpression(node);
    const name = normalizeName(expressionName(node.expression));

    if (this.mocked.has(name + "_mock")) {
      node.expression = Node.createIdentifierExpression(
        name + "_mock",
        node.expression.range,
      );
      return;
    }

    if (name == "mockImport") {
      const path = node.args[0] as StringLiteralExpression | undefined;
      if (path) {
        this.importMocked.add(path.value);
      }
      return;
    }

    if (name == "unmockFn") {
      const oldFn = node.args[0];
      if (!oldFn) return;
      this.mocked.delete(normalizeName(expressionName(oldFn)) + "_mock");
      return;
    }

    if (name == "unmockImport") {
      return;
    }

    if (name != "mockFn") return;
    const oldValue = node.args[0];
    const callback = node.args[1] as FunctionExpression | undefined;
    if (!oldValue || !callback) return;
    const newName = normalizeName(expressionName(oldValue));

    const newFn = Node.createFunctionDeclaration(
      Node.createIdentifierExpression(newName + "_mock", callback.range),
      callback.declaration.decorators,
      CommonFlags.None,
      callback.declaration.typeParameters,
      callback.declaration.signature,
      callback.declaration.body,
      callback.declaration.arrowKind,
      callback.range,
    );

    const currentSource = this.srcCurrent;
    if (!currentSource) return;
    const stmts = currentSource.statements;
    let index = -1;
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      if (stmt.range.start != node.range.start) continue;
      index = i;
      break;
    }
    if (index === -1) return;
    stmts.splice(index, 1, newFn);
    this.mocked.add(newFn.name.text);
  }
  visitFunctionDeclaration(
    node: FunctionDeclaration,
    isDefault?: boolean,
  ): void {
    if (this.mocked.has(node.name.text)) return;
    super.visitFunctionDeclaration(node, isDefault);
  }
  visitSource(node: Source): void {
    this.mocked = new Set<string>();
    this.srcCurrent = node;
    super.visitSource(node);
    const currentSource = this.srcCurrent;
    if (!currentSource) return;
    const stmts = currentSource.statements;
    for (let index = 0; index < stmts.length; index++) {
      const node = stmts[index] as FunctionDeclaration;
      if (!isBodylessTopLevelFunction(node)) continue;
      let path: string;
      const dec = node.decorators?.find(
        (v) => (v.name as IdentifierExpression).text == "external",
      );
      const decArgs = dec?.args ?? [];
      if (!dec) {
        path = "env." + node.name.text;
      } else if (decArgs[0] && decArgs[1])
        path = decArgs
          .map((v) => (v as StringLiteralExpression).value)
          .join(".");
      else if (decArgs[0])
        path =
          currentSource.simplePath +
          "." +
          (decArgs[0] as StringLiteralExpression).value;
      else path = currentSource.simplePath + "." + node.name.text;

      const registerImportTarget = Node.createExpressionStatement(
        Node.createCallExpression(
          Node.createPropertyAccessExpression(
            Node.createIdentifierExpression(
              "__mock_import_target_by_index",
              node.range,
            ),
            Node.createIdentifierExpression("set", node.range),
            node.range,
          ),
          null,
          [
            Node.createPropertyAccessExpression(
              Node.createIdentifierExpression(node.name.text, node.range),
              Node.createIdentifierExpression("index", node.range),
              node.range,
            ),
            Node.createStringLiteralExpression(path, node.range),
          ],
          node.range,
        ),
      );
      if (!this.importMocked.has(path)) {
        stmts.splice(index + 1, 0, registerImportTarget);
        index++;
        continue;
      }

      const args: Expression[] = [
        Node.createCallExpression(
          Node.createPropertyAccessExpression(
            Node.createIdentifierExpression("__mock_import", node.range),
            Node.createIdentifierExpression("get", node.range),
            node.range,
          ),
          null,
          [Node.createStringLiteralExpression(path, node.range)],
          node.range,
        ),
      ];

      for (const param of node.signature.parameters) {
        args.push(Node.createIdentifierExpression(param.name.text, node.range));
      }

      const newFn = Node.createFunctionDeclaration(
        node.name,
        (node.decorators ?? []).filter(
          (v) => (v.name as IdentifierExpression).text != "external",
        ),
        node.flags - CommonFlags.Ambient - CommonFlags.Declare,
        node.typeParameters,
        node.signature,
        Node.createBlockStatement(
          [
            Node.createReturnStatement(
              Node.createCallExpression(
                Node.createIdentifierExpression("call_indirect", node.range),
                null,
                args,
                node.range,
              ),
              node.range,
            ),
          ],
          node.range,
        ),
        ArrowKind.None,
        node.range,
      );

      stmts.splice(index, 1, newFn, registerImportTarget);
      index++;
    }
  }
}

function isBodylessTopLevelFunction(
  node: Statement | FunctionDeclaration,
): node is FunctionDeclaration {
  const candidate = node as FunctionDeclaration;
  return (
    candidate != null &&
    typeof candidate == "object" &&
    candidate.name instanceof IdentifierExpression &&
    "signature" in candidate &&
    candidate.body == null
  );
}

function normalizeName(value: string): string {
  return value
    .replaceAll(".", "_")
    .replaceAll("[", "_")
    .replaceAll("]", "_")
    .replace(/[^A-Za-z0-9_]/g, "_");
}

function expressionName(node: Expression | null | undefined): string {
  const candidate = node as Expression & {
    text?: string;
    expression?: Expression;
    property?: { text?: string };
  };
  if (!candidate || typeof candidate != "object") return "";
  if (typeof candidate.text == "string") return candidate.text;
  const propertyText = candidate.property?.text;
  if (propertyText && candidate.expression) {
    const left = expressionName(candidate.expression);
    return left.length ? `${left}.${propertyText}` : propertyText;
  }
  const sourceText = candidate.range?.source?.text;
  if (typeof sourceText == "string") {
    const raw = sourceText
      .slice(candidate.range.start, candidate.range.end)
      .trim();
    if (raw.length) return raw;
  }
  return toString(candidate);
}
