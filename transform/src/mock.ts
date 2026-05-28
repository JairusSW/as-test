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
  Range,
} from "assemblyscript/dist/assemblyscript.js";
import { Visitor } from "./visitor.js";
import { toString } from "./util.js";
export class MockTransform extends Visitor {
  public srcCurrent: Source | null = null;
  public globalStatements: Statement[] = [];
  public mocked = new Set<string>();
  public importMocked: Set<string> = new Set<string>();
  // Import paths that are unmocked somewhere. Such imports keep their real
  // binding (renamed) so an unmocked call falls back to it; paths that are
  // only ever mocked have their real import removed entirely.
  public importUnmocked: Set<string> = new Set<string>();
  // Mock fns to hoist to the top of the current source. Deferred to the end of
  // visitSource so we never splice a statements array mid-traversal.
  private pendingHoist: FunctionDeclaration[] = [];
  // mockFn/unmockFn directive calls to delete, each paired with the container
  // (Source or block) whose `statements` array holds the wrapping statement.
  private pendingRemoval: { container: StatementContainer; stmt: Statement }[] =
    [];

  visitCallExpression(node: CallExpression, ref: Node | null = null): void {
    super.visitCallExpression(node, ref);
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
      // Drop the directive itself — its argument (e.g. `console.log`) isn't
      // always a valid standalone value expression.
      this.scheduleRemoval(node, ref);
      return;
    }

    if (name == "unmockImport") {
      return;
    }

    if (name != "mockFn") return;
    const oldValue = node.args[0];
    const callback = node.args[1] as FunctionExpression | undefined;
    if (!oldValue || !callback || !callback.declaration) return;
    const mockName = normalizeName(expressionName(oldValue)) + "_mock";

    const newFn = Node.createFunctionDeclaration(
      Node.createIdentifierExpression(mockName, callback.range),
      callback.declaration.decorators,
      CommonFlags.None,
      callback.declaration.typeParameters,
      callback.declaration.signature,
      callback.declaration.body,
      callback.declaration.arrowKind,
      callback.range,
    );

    // Hoist the mock fn to module scope so every rewritten call site can reach
    // it, then delete the original mockFn(...) directive. This makes mockFn
    // work wherever it's written — top level or inside a test()/it() callback.
    this.pendingHoist.push(newFn);
    this.mocked.add(mockName);
    this.scheduleRemoval(node, ref);
  }

  // Records the statement wrapping `node` for later deletion. `ref` is the
  // call's parent in the visitor — the enclosing Source or block whose
  // `statements` array holds the directive statement.
  private scheduleRemoval(node: CallExpression, ref: Node | null): void {
    const container = asStatementContainer(ref);
    if (!container) return;
    const stmt = container.statements.find(
      (s) => (s as unknown as { expression?: Expression }).expression === node,
    );
    if (stmt) this.pendingRemoval.push({ container, stmt });
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
    this.pendingHoist = [];
    this.pendingRemoval = [];
    this.srcCurrent = node;
    super.visitSource(node);
    const currentSource = this.srcCurrent;
    if (!currentSource) return;
    // Delete the collected mockFn/unmockFn directive statements (deferred to
    // here so traversal isn't disturbed), then hoist the generated mock fns to
    // the top of the source where they're in scope for every call site.
    for (const { container, stmt } of this.pendingRemoval) {
      const i = container.statements.indexOf(stmt);
      if (i !== -1) container.statements.splice(i, 1);
    }
    this.pendingRemoval = [];
    if (this.pendingHoist.length) {
      currentSource.statements.unshift(...this.pendingHoist);
      this.pendingHoist = [];
    }
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

      // Mocked AND unmocked somewhere: keep the real import (renamed) and wrap
      // it so a call uses the mock when one is registered and otherwise falls
      // back to the real import. The real import survives in the wasm.
      if (this.importUnmocked.has(path) && node.signature.returnType) {
        const realName = "__as_test_real_" + node.name.text;
        const r = node.range;
        const wrapper = buildFallbackWrapper(node, path, realName, r);
        // The wrapper takes over the original name (and its export, so callers
        // in other modules still resolve it); the real import keeps its
        // @external binding under the renamed symbol and is no longer exported.
        const mutable = node as { name: IdentifierExpression; flags: number };
        mutable.name = Node.createIdentifierExpression(realName, r);
        mutable.flags &= ~CommonFlags.Export;
        stmts.splice(index + 1, 0, wrapper);
        index++;
        continue;
      }

      // Mocked and never unmocked: replace the import outright with a wrapper
      // that always dispatches through the mock table. The real import is gone.
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

// Hand-builds (using the real source range, so nodes resolve against the
// enclosing source) a wrapper that prefers a registered mock and otherwise
// calls the renamed real import — equivalent to:
//   function foo(a: i32): string {
//     if (__mock_import.has("mod.foo")) return call_indirect(__mock_import.get("mod.foo"), a);
//     return __as_test_real_foo(a);
//   }
function buildFallbackWrapper(
  node: FunctionDeclaration,
  path: string,
  realName: string,
  range: Range,
): FunctionDeclaration {
  const mockImportGet = Node.createCallExpression(
    Node.createPropertyAccessExpression(
      Node.createIdentifierExpression("__mock_import", range),
      Node.createIdentifierExpression("get", range),
      range,
    ),
    null,
    [Node.createStringLiteralExpression(path, range)],
    range,
  );
  const indirectArgs: Expression[] = [mockImportGet];
  const forwardArgs: Expression[] = [];
  for (const param of node.signature.parameters) {
    indirectArgs.push(Node.createIdentifierExpression(param.name.text, range));
    forwardArgs.push(Node.createIdentifierExpression(param.name.text, range));
  }
  const ifMocked = Node.createIfStatement(
    Node.createCallExpression(
      Node.createPropertyAccessExpression(
        Node.createIdentifierExpression("__mock_import", range),
        Node.createIdentifierExpression("has", range),
        range,
      ),
      null,
      [Node.createStringLiteralExpression(path, range)],
      range,
    ),
    Node.createReturnStatement(
      Node.createCallExpression(
        Node.createIdentifierExpression("call_indirect", range),
        null,
        indirectArgs,
        range,
      ),
      range,
    ),
    null,
    range,
  );
  const callReal = Node.createReturnStatement(
    Node.createCallExpression(
      Node.createIdentifierExpression(realName, range),
      null,
      forwardArgs,
      range,
    ),
    range,
  );
  // Fresh signature node so it isn't shared with the retained real import.
  const signature = Node.createFunctionType(
    node.signature.parameters,
    node.signature.returnType,
    node.signature.explicitThisType,
    node.signature.isNullable,
    range,
  );
  const exported = (node.flags & CommonFlags.Export) != 0;
  return Node.createFunctionDeclaration(
    Node.createIdentifierExpression(node.name.text, range),
    null,
    exported ? CommonFlags.Export : CommonFlags.None,
    node.typeParameters,
    signature,
    Node.createBlockStatement([ifMocked, callReal], range),
    ArrowKind.None,
    range,
  ) as FunctionDeclaration;
}

interface StatementContainer {
  statements: Statement[];
}

// A node that owns a `statements` array (Source, BlockStatement, …). The
// visitor passes the enclosing such node as `ref`, which is how mockFn/unmockFn
// directives are located for removal regardless of how deeply they're nested.
function asStatementContainer(ref: Node | null): StatementContainer | null {
  const candidate = ref as unknown as { statements?: Statement[] } | null;
  if (candidate && Array.isArray(candidate.statements)) {
    return candidate as StatementContainer;
  }
  return null;
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
