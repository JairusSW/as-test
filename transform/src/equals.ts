// Synthesises a structural-equality method on every class declared in a
// user source. The runtime in `assembly/src/reflect.ts` dispatches into
// these methods through AS's virtual call table.
//
// Approach
// --------
// Modelled on as-pect's createStrictEqualsMember, but using strong types
// for the `other` parameter so the body can access fields with no
// `as Object`/changetype dance.
//
//   * Every ClassDeclaration in every non-stdlib user source gets the
//     method. AssemblyScript tree-shakes the unused instance methods at
//     link time, so the false-positive cost of universal injection is
//     near zero.
//   * Signature:
//
//        __AS_TEST_EQUALS(
//          other: <chain-root-class>,
//          stack: usize[],
//          ignore: StaticArray<i64>,
//          strict: bool,
//        ): bool
//
//     The `other` parameter is pinned to the chain's root class name.
//     Every class in the chain shares that signature, so a descendant
//     override doesn't narrow the parameter — no AS TS2394.
//     If any ancestor declares `__AS_TEST_EQUALS` by hand, we pin to
//     *its* declared `other` type instead so the user's signature wins.
//   * The body opens with `const __o = changetype<Self>(other);` and
//     compares own fields against `__o.field`. For root classes whose
//     chain pin is their own name the cast is a no-op; for descendants
//     it strips the upcasted parameter back to the concrete type.
//   * Per-field comparisons go through `reflectEquals(this.f, __o.f,
//     stack, strict)` gated on the descendant's `ignore` hash list.
//   * Inheritance composes by tail-calling `super.__AS_TEST_EQUALS` with
//     `ignore` concatenated with this class's field hashes — same
//     pattern as as-pect's super call. The `isDefined(super.…)` guard
//     makes the call compile away for chain roots.
//
// We auto-inject an `import { reflectEquals as
// __AS_TEST_REFLECT_EQUALS_INTERNAL }` at the top of every source that
// received at least one method.
//
// Skipped:
//   * Classes that already declare `__AS_TEST_EQUALS` directly — the
//     hand-written method wins.
//   * Generic classes — at the parser stage we can't reliably spell
//     `Class<T>` for the pin without the resolver.

import {
  ClassDeclaration,
  CommonFlags,
  DecoratorNode,
  FieldDeclaration,
  MethodDeclaration,
  NamedTypeNode,
  Parser,
  Source,
  SourceKind,
  Statement,
  Tokenizer,
  TypeNode,
} from "assemblyscript/dist/assemblyscript.js";

// NodeKind comes from `./types.js` (a runtime-captured copy) rather
// than from AS directly. AS exposes NodeKind as a `const enum`, which
// tsc inlines as literals — those literals don't survive when the
// compiled transform is loaded against a different AS minor version
// in the consumer's tree.
import { NodeKind } from "./types.js";
import { readFileSync } from "fs";
import { join } from "path";

import { SimpleParser, isStdlib } from "./util.js";

const EQUALS_METHOD = "__AS_TEST_EQUALS";
const TOJSON_METHOD = "toJSON";
const REFLECT_LOCAL = "__AS_TEST_REFLECT_EQUALS_INTERNAL";
const STRINGIFY_LOCAL = "__AS_TEST_STRINGIFY_INTERNAL";
const ALREADY_INJECTED_EQUALS = new WeakSet<ClassDeclaration>();
const ALREADY_INJECTED_TOJSON = new WeakSet<ClassDeclaration>();
// Decorators we treat as "the user has wired up their own serializer for
// this class" — we skip toJSON injection on them so json-as's
// `__SERIALIZE` (or whatever else) wins when the user explicitly opts in
// via `--transform json-as`.
const JSON_DECORATORS = ["json", "serializable"];

export class EqualsTransform {
  private touchedSources = new Set<Source>();
  private classesByName = new Map<string, ClassDeclaration[]>();

  constructor(private parser: Parser) {}

  apply(sources: readonly Source[]): void {
    for (const source of sources) {
      if (isStdlib(source)) continue;
      if (!isUserSource(source)) continue;
      // Skip as-test's own runtime sources. They define the symbols this
      // transform would otherwise re-import, which AS treats as duplicate
      // globals when the file is reachable via two module paths
      // (`assembly/index.ts` in-tree vs `~lib/as-test/assembly/index.ts`
      // when consumed as a package).
      if (isAsTestInternal(source)) continue;
      this.indexClasses(source.statements);
    }
    for (const source of this.parser.sources) {
      if (isStdlib(source)) continue;
      if (!isUserSource(source)) continue;
      if (isAsTestInternal(source)) continue;
      this.traverseStatements(source, source.statements);
    }
    for (const source of this.touchedSources) {
      this.injectRuntimeImports(source);
    }
  }

  private indexClasses(statements: Statement[]): void {
    for (const stmt of statements) {
      if (!stmt) continue;
      if (stmt.kind === NodeKind.ClassDeclaration) {
        const klass = stmt as ClassDeclaration;
        const list = this.classesByName.get(klass.name.text);
        if (list) list.push(klass);
        else this.classesByName.set(klass.name.text, [klass]);
      } else if (stmt.kind === NodeKind.NamespaceDeclaration) {
        const members = (stmt as unknown as { members: Statement[] }).members;
        if (members) this.indexClasses(members);
      }
    }
  }

  private traverseStatements(source: Source, statements: Statement[]): void {
    for (const stmt of statements) {
      if (!stmt) continue;
      if (stmt.kind === NodeKind.ClassDeclaration) {
        const klass = stmt as ClassDeclaration;
        const injectedEquals = this.injectEqualsMethod(klass);
        const injectedToJSON = this.injectToJSONMethod(klass);
        if (injectedEquals || injectedToJSON) {
          this.touchedSources.add(source);
        }
      } else if (stmt.kind === NodeKind.NamespaceDeclaration) {
        const members = (stmt as unknown as { members: Statement[] }).members;
        if (members) this.traverseStatements(source, members);
      }
    }
  }

  // Returns true when a method was actually injected so the caller can
  // mark the host source as needing the runtime import.
  private injectEqualsMethod(klass: ClassDeclaration): boolean {
    if (ALREADY_INJECTED_EQUALS.has(klass)) return false;
    if (declaresMethod(klass, EQUALS_METHOD)) return false;
    if (klass.typeParameters && klass.typeParameters.length) return false;

    const fieldNames: string[] = [];
    for (const member of klass.members) {
      if (member.kind !== NodeKind.FieldDeclaration) continue;
      const field = member as FieldDeclaration;
      if (!field.is(CommonFlags.Instance)) continue;
      if ((field.flags & CommonFlags.Static) !== 0) continue;
      if (!field.name || !field.name.text) continue;
      fieldNames.push(field.name.text);
    }

    const fieldHashes = fieldNames.map((n) => djb2Hash(n).toString());
    const className = klass.name.text;
    const otherType = this.pinnedOtherType(klass);

    const lines: string[] = [];
    // Cast back to the concrete class so the per-field reads use the
    // right offsets. No-op when `otherType === className`; required
    // when this class is deeper in a chain than its pin.
    lines.push(`const __o = changetype<${className}>(other);`);

    for (let i = 0; i < fieldNames.length; i++) {
      const name = fieldNames[i];
      const hash = fieldHashes[i];
      lines.push(
        `if (!ignore.includes(${hash}) && ` +
          `!${REFLECT_LOCAL}(this.${name}, __o.${name}, stack, strict)) return false;`,
      );
    }

    // Super call. `isDefined(super.__AS_TEST_EQUALS)` is compile-time:
    // false when there's no extends clause or the parent never received
    // the method. When present, the parent has the *same* pinned
    // `other` type so we forward `other` as-is.
    const ignoreLiteral = fieldHashes.length
      ? `[${fieldHashes.join(", ")}] as StaticArray<i64>`
      : `[] as StaticArray<i64>`;
    lines.push(
      `if (isDefined(super.__AS_TEST_EQUALS)) {` +
        ` if (!super.__AS_TEST_EQUALS(other, stack, ` +
        `StaticArray.concat<i64>(ignore, ${ignoreLiteral}), strict)) return false;` +
        ` }`,
    );

    lines.push(`return true;`);

    const code =
      `${EQUALS_METHOD}(` +
      `other: ${otherType}, ` +
      `stack: usize[], ` +
      `ignore: StaticArray<i64>, ` +
      `strict: bool` +
      `): bool { ${lines.join(" ")} }`;

    try {
      const method = SimpleParser.parseClassMember(code, klass);
      klass.members.push(method as MethodDeclaration);
      ALREADY_INJECTED_EQUALS.add(klass);
      return true;
    } catch {
      // Parser refused (e.g. a class member name collides in a future
      // AS release). Fall back silently — the user can still hand-write
      // `__AS_TEST_EQUALS` and the runtime picks it up via the same
      // dispatch.
      return false;
    }
  }

  // The `other` parameter type to pin: walk the extends chain, prefer
  // the first ancestor that declares `__AS_TEST_EQUALS` by hand (use
  // its `other` annotation), otherwise the chain's root class name.
  // Pinning to a common type across the chain avoids AS TS2394 because
  // every override keeps the parameter type identical to the parent's.
  private pinnedOtherType(klass: ClassDeclaration): string {
    const seen = new Set<ClassDeclaration>();
    let current: ClassDeclaration | null = klass;
    let rootName = klass.name.text;
    while (current && !seen.has(current)) {
      seen.add(current);
      const userType = userDeclaredEqualsOtherType(current);
      if (userType) return userType;
      rootName = current.name.text;
      const parentName = extendsName(current);
      if (!parentName) return rootName;
      const parents = this.classesByName.get(parentName);
      if (!parents || parents.length === 0) return rootName;
      current = parents[0];
    }
    return rootName;
  }

  // Injects `__as_test_equals` field-equality helper and the
  // `__as_test_stringify` helper used by both reflectEquals and the
  // toJSON injection. Lands at the top of every source where we
  // injected at least one class method.
  private injectRuntimeImports(source: Source): void {
    const asTestPath = detectAsTestImportPath(source.text) ?? "as-test";
    const importLine =
      `import { reflectEquals as ${REFLECT_LOCAL}, ` +
      `__as_test_stringify as ${STRINGIFY_LOCAL} } from "${asTestPath}";`;
    const tokenizer = new Tokenizer(
      new Source(SourceKind.User, source.normalizedPath, importLine),
    );
    this.parser.currentSource = tokenizer.source;
    source.statements.unshift(this.parser.parseTopLevelStatement(tokenizer)!);
    this.parser.currentSource = source;
  }

  // Synthesises a `toJSON(): string` method that emits a JSON object
  // whose keys are each non-static instance field, values produced by
  // the in-tree `stringify<T>` helper. Lives alongside the
  // `__AS_TEST_EQUALS` injection so a single transform pass covers both
  // report rendering and structural equality.
  //
  // Skip conditions:
  //   * Class already declares `toJSON` directly (user wins).
  //   * Class carries `@json` / `@serializable` — user has opted into
  //     json-as's serializer; we stay out of the way.
  //   * Generic class — same reason as for __AS_TEST_EQUALS.
  //
  // Inheritance: a child class's generated method walks ALL chain
  // fields (root-first, deduped by name) so the output captures
  // inherited state too. We don't try to compose with a parent's
  // hand-written `toJSON` — if the parent has one, the child still
  // gets a structural fallback.
  private injectToJSONMethod(klass: ClassDeclaration): boolean {
    if (ALREADY_INJECTED_TOJSON.has(klass)) return false;
    if (declaresMethod(klass, TOJSON_METHOD)) return false;
    if (hasAnyDecorator(klass, JSON_DECORATORS)) return false;
    if (klass.typeParameters && klass.typeParameters.length) return false;

    const fieldNames = this.collectChainFieldNames(klass);
    // Skip self-referential fields — the auto-generated method has no
    // cycle detection. Users with cyclic graphs hand-write `toJSON`.
    const chainNames = this.collectChainClassNames(klass);
    const renderable: string[] = [];
    for (const name of fieldNames) {
      const fieldType = this.fieldTypeName(klass, name);
      if (fieldType && chainNames.has(fieldType)) continue;
      renderable.push(name);
    }
    const parts: string[] = [];
    for (let i = 0; i < renderable.length; i++) {
      const name = renderable[i];
      const prefix = i === 0 ? "" : ",";
      parts.push(
        `"${prefix}\\"${name}\\":" + ${STRINGIFY_LOCAL}(this.${name})`,
      );
    }
    const body = parts.length
      ? `return "{" + ${parts.join(" + ")} + "}";`
      : `return "{}";`;
    const code = `toJSON(): string { ${body} }`;
    try {
      const method = SimpleParser.parseClassMember(code, klass);
      klass.members.push(method as MethodDeclaration);
      ALREADY_INJECTED_TOJSON.add(klass);
      return true;
    } catch {
      return false;
    }
  }

  // Root-first, deduped by name. Walks `extendsType` via classesByName
  // — anything unreachable (extending stdlib, missing parent) just
  // stops the walk.
  private collectChainFieldNames(klass: ClassDeclaration): string[] {
    const chain: ClassDeclaration[] = [];
    const seen = new Set<ClassDeclaration>();
    let current: ClassDeclaration | null = klass;
    while (current && !seen.has(current)) {
      seen.add(current);
      chain.unshift(current);
      const parentName = extendsName(current);
      if (!parentName) break;
      const parents = this.classesByName.get(parentName);
      if (!parents || parents.length === 0) break;
      current = parents[0];
    }
    const ordered: string[] = [];
    const known = new Set<string>();
    for (const cls of chain) {
      for (const member of cls.members) {
        if (member.kind !== NodeKind.FieldDeclaration) continue;
        const field = member as FieldDeclaration;
        if (!field.is(CommonFlags.Instance)) continue;
        if ((field.flags & CommonFlags.Static) !== 0) continue;
        if (!field.name || !field.name.text) continue;
        const name = field.name.text;
        if (known.has(name)) continue;
        known.add(name);
        ordered.push(name);
      }
    }
    return ordered;
  }

  // All class names along the extends chain (self + ancestors). Used by
  // the toJSON injector to skip self-referential fields and break
  // obvious cycles.
  private collectChainClassNames(klass: ClassDeclaration): Set<string> {
    const out = new Set<string>();
    const seen = new Set<ClassDeclaration>();
    let current: ClassDeclaration | null = klass;
    while (current && !seen.has(current)) {
      seen.add(current);
      out.add(current.name.text);
      const parentName = extendsName(current);
      if (!parentName) break;
      const parents = this.classesByName.get(parentName);
      if (!parents || parents.length === 0) break;
      current = parents[0];
    }
    return out;
  }

  private fieldTypeName(
    klass: ClassDeclaration,
    fieldName: string,
  ): string | null {
    const seen = new Set<ClassDeclaration>();
    let current: ClassDeclaration | null = klass;
    while (current && !seen.has(current)) {
      seen.add(current);
      for (const member of current.members) {
        if (member.kind !== NodeKind.FieldDeclaration) continue;
        const field = member as FieldDeclaration;
        if (!field.name || field.name.text !== fieldName) continue;
        return namedTypeText(field.type);
      }
      const parentName = extendsName(current);
      if (!parentName) break;
      const parents = this.classesByName.get(parentName);
      if (!parents || parents.length === 0) break;
      current = parents[0];
    }
    return null;
  }
}

function declaresMethod(klass: ClassDeclaration, name: string): boolean {
  for (const member of klass.members) {
    if (member.kind !== NodeKind.MethodDeclaration) continue;
    const method = member as MethodDeclaration;
    if (method.name && method.name.text === name) return true;
  }
  return false;
}

function hasAnyDecorator(klass: ClassDeclaration, names: string[]): boolean {
  if (!klass.decorators) return false;
  for (const dec of klass.decorators as DecoratorNode[]) {
    const decName = (dec.name as unknown as { text?: string }).text;
    if (decName && names.indexOf(decName) !== -1) return true;
  }
  return false;
}

function userDeclaredEqualsOtherType(klass: ClassDeclaration): string | null {
  for (const member of klass.members) {
    if (member.kind !== NodeKind.MethodDeclaration) continue;
    const method = member as MethodDeclaration;
    if (!method.name || method.name.text !== EQUALS_METHOD) continue;
    const params = (
      method as unknown as { signature: { parameters: { type: TypeNode }[] } }
    ).signature.parameters;
    if (!params || params.length === 0) return null;
    return namedTypeText(params[0].type);
  }
  return null;
}

function extendsName(klass: ClassDeclaration): string | null {
  const extendsType = (klass as unknown as { extendsType?: TypeNode | null })
    .extendsType;
  if (!extendsType) return null;
  return namedTypeText(extendsType);
}

function namedTypeText(type: TypeNode | null): string | null {
  if (!type) return null;
  if (type.kind !== NodeKind.NamedType) return null;
  const named = type as NamedTypeNode;
  if (!named.name) return null;
  const ident = (named.name as unknown as { identifier?: { text?: string } })
    .identifier;
  if (ident && typeof ident.text === "string") return ident.text;
  const text = (named.name as unknown as { text?: string }).text;
  return text ?? null;
}

function isUserSource(source: Source): boolean {
  return (
    source.sourceKind === SourceKind.User ||
    source.sourceKind === SourceKind.UserEntry
  );
}

// True for as-test's own runtime sources — the ones that define the
// symbols the transform injects imports for. Two cases:
//
//   * Package-installed: AS normalises imports from "as-test" to
//     `~lib/as-test/assembly/...`. We skip anything outside that
//     package's `__tests__/` directory.
//   * In-tree dev (running `npm test` inside the as-test repo): the
//     same files appear with relative paths like `assembly/index.ts`,
//     indistinguishable from a consumer's own `assembly/...` file by
//     path alone. We gate the in-tree skip on whether the asc process
//     was spawned from inside as-test's own package by inspecting
//     `process.cwd()`'s package.json name.
let cachedIsAsTestCwd: boolean | null = null;
function isAsTestOwnCwd(): boolean {
  if (cachedIsAsTestCwd !== null) return cachedIsAsTestCwd;
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { name?: string };
    cachedIsAsTestCwd = pkg.name === "as-test";
  } catch {
    cachedIsAsTestCwd = false;
  }
  return cachedIsAsTestCwd;
}

function isAsTestInternal(source: Source): boolean {
  const p = source.normalizedPath;
  if (/(?:^|\/)as-test\/assembly\/(?!__tests__\/)/.test(p)) return true;
  if (isAsTestOwnCwd() && /^assembly\/(?!__tests__\/)/.test(p)) return true;
  return false;
}

function detectAsTestImportPath(sourceText: string): string | null {
  const text = sourceText
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const imports = text.matchAll(
    /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g,
  );
  for (const match of imports) {
    const specifiers = match[1] ?? "";
    const modulePath = (match[2] ?? "").trim();
    if (!modulePath.length) continue;
    if (modulePath === "as-test" || modulePath.endsWith("/as-test")) {
      return modulePath;
    }
    if (
      /\b(?:describe|test|it|expect|beforeAll|afterAll|beforeEach|afterEach|mockFn|unmockFn|mockImport|unmockImport|snapshotFn|log|run)\b/.test(
        specifiers,
      )
    ) {
      return modulePath;
    }
  }
  return null;
}

// djb2 — matches as-pect's hash so the wire format is comparable.
function djb2Hash(s: string): u32 {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
