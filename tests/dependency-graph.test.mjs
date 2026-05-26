import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { pathToFileURL } from "url";

const repoRoot = process.cwd();

async function loadGraph() {
  const mod = await import(
    pathToFileURL(path.join(repoRoot, "bin/dependency-graph.js")).href
  );
  return mod.DependencyGraph;
}

function abs(rel) {
  return path.resolve(repoRoot, rel);
}

test("recordBuild stores dependencies and indexes them in reverse", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const spec = abs("assembly/__tests__/foo.spec.ts");
  const helper = abs("assembly/helper.ts");
  g.recordBuild(spec, undefined, [helper]);

  assert.equal(g.hasSpec(spec), true);
  const affected = g.specsAffectedBy(helper);
  assert.equal(affected.size, 1);
  assert.equal(affected.has(spec), true);

  // The spec itself is recorded as a dependency of itself, so editing the
  // spec file invalidates that spec.
  const selfAffected = g.specsAffectedBy(spec);
  assert.equal(selfAffected.has(spec), true);
});

test("recordBuild replaces the prior set so dropped imports are forgotten", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const spec = abs("assembly/__tests__/foo.spec.ts");
  const helperA = abs("assembly/helperA.ts");
  const helperB = abs("assembly/helperB.ts");

  g.recordBuild(spec, undefined, [helperA, helperB]);
  assert.equal(g.specsAffectedBy(helperA).has(spec), true);
  assert.equal(g.specsAffectedBy(helperB).has(spec), true);

  // Rebuild with only helperA — helperB should no longer reverse-link to spec.
  g.recordBuild(spec, undefined, [helperA]);
  assert.equal(g.specsAffectedBy(helperA).has(spec), true);
  assert.equal(g.specsAffectedBy(helperB).size, 0);
});

test("modes are scoped independently", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const specA = abs("assembly/__tests__/a.spec.ts");
  const specB = abs("assembly/__tests__/b.spec.ts");
  const shared = abs("assembly/shared.ts");

  g.recordBuild(specA, "wasi", [shared]);
  g.recordBuild(specB, "web", [shared]);

  // Both specs depend on shared (across modes).
  const affected = g.specsAffectedBy(shared);
  assert.equal(affected.size, 2);
  assert.equal(affected.has(specA), true);
  assert.equal(affected.has(specB), true);

  // knownSpecs is mode-scoped.
  const wasiSpecs = g.knownSpecs("wasi");
  assert.equal(wasiSpecs.size, 1);
  assert.equal(wasiSpecs.has(specA), true);
  assert.equal(wasiSpecs.has(specB), false);

  const webSpecs = g.knownSpecs("web");
  assert.equal(webSpecs.has(specB), true);
  assert.equal(webSpecs.has(specA), false);
});

test("filters out assemblyscript stdlib reads", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const spec = abs("assembly/__tests__/foo.spec.ts");
  const stdlibFile = abs("node_modules/assemblyscript/std/assembly/array.ts");
  const projectFile = abs("assembly/helper.ts");

  g.recordBuild(spec, undefined, [stdlibFile, projectFile]);
  // stdlib reads should be dropped at record time
  assert.equal(g.specsAffectedBy(stdlibFile).size, 0);
  assert.equal(g.specsAffectedBy(projectFile).has(spec), true);
});

test("forget removes a single spec from both indices", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const specA = abs("assembly/__tests__/a.spec.ts");
  const specB = abs("assembly/__tests__/b.spec.ts");
  const shared = abs("assembly/shared.ts");

  g.recordBuild(specA, undefined, [shared]);
  g.recordBuild(specB, undefined, [shared]);
  assert.equal(g.specsAffectedBy(shared).size, 2);

  g.forget(specA);
  const after = g.specsAffectedBy(shared);
  assert.equal(after.size, 1);
  assert.equal(after.has(specB), true);
  assert.equal(g.hasSpec(specA), false);
});

test("clear wipes everything", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const spec = abs("assembly/__tests__/foo.spec.ts");
  g.recordBuild(spec, undefined, [abs("assembly/helper.ts")]);
  g.clear();
  assert.equal(g.specsAffectedBy(abs("assembly/helper.ts")).size, 0);
  assert.equal(g.hasSpec(spec), false);
  assert.equal(g.knownSpecs().size, 0);
});

test("paths are normalized so equivalent relative/absolute forms collapse", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const spec = "assembly/__tests__/foo.spec.ts";
  const helper = "assembly/helper.ts";
  const absSpec = path.resolve(repoRoot, spec);
  const absHelper = path.resolve(repoRoot, helper);

  // Record using mixed forms.
  g.recordBuild(spec, undefined, [absHelper]);
  // Query using the other form.
  assert.equal(g.specsAffectedBy(helper).has(absSpec), true);
  assert.equal(g.hasSpec(absSpec), true);
});

test("allRecordedFiles aggregates across modes and specs", async () => {
  const DependencyGraph = await loadGraph();
  const g = new DependencyGraph();

  const specA = abs("assembly/__tests__/a.spec.ts");
  const specB = abs("assembly/__tests__/b.spec.ts");
  g.recordBuild(specA, undefined, [abs("assembly/x.ts")]);
  g.recordBuild(specB, "alt", [abs("assembly/y.ts")]);

  const all = g.allRecordedFiles();
  assert.equal(all.has(specA), true);
  assert.equal(all.has(specB), true);
  assert.equal(all.has(abs("assembly/x.ts")), true);
  assert.equal(all.has(abs("assembly/y.ts")), true);
});
