import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { gunzipSync, gzipSync } from "zlib";
import * as path from "path";
import { AsyncLocalStorage } from "async_hooks";
// Persisted incremental cache for `ast test`. Two tiers:
//   Tier 1 (build): skip the asc compile when a spec + every file it imported is
//     byte-for-byte unchanged and the build signature still matches.
//   Tier 2 (replay): skip running and replay the stored per-file report when the
//     spec is build-fresh AND the runtime command + snapshot file are unchanged.
// Both read the run-scoped context in `cacheStorage` (set once by the test
// orchestrator), mirroring how `buildRecorderStorage` threads the watch
// recorder down without plumbing a param through every call site.
const CACHE_FORMAT_VERSION = 1;
const MODE_KEY_DEFAULT = "__default__";
// Manifest and reports are gzipped (repetitive JSON, large coverage payloads).
const MANIFEST_FILE = "manifest.json.gz";
// Mirror dependency-graph.ts specKey: NUL cannot appear in a mode name or path,
// so the (mode, path) key can never collide.
function specKey(mode, spec) {
  return `${mode ?? MODE_KEY_DEFAULT}\u0000${path.resolve(spec)}`;
}
// asc reads its own bundled stdlib/toolchain on every build; those never change
// between runs and would balloon every entry's dep set, so drop them — same
// filter dependency-graph.ts applies for watch.
function isUninterestingDep(absPath) {
  const normalized = absPath.replace(/\\/g, "/");
  if (normalized.includes("/node_modules/assemblyscript/")) return true;
  if (normalized.includes("/node_modules/binaryen/")) return true;
  return false;
}
// `.as-test/cache` — sibling of build/logs/coverage, derived from the build root
// so a custom outDir keeps everything together. Always the un-mode-qualified
// base dir: the manifest is mode-scoped internally via its keys.
export function resolveCacheDir(baseOutDir) {
  return path.join(path.dirname(baseOutDir), "cache");
}
export function sha256OfFile(absPath) {
  try {
    return createHash("sha256").update(readFileSync(absPath)).digest("hex");
  } catch {
    return null;
  }
}
export class BuildCache {
  constructor(
    cacheDir,
    asTestVersion,
    manifest,
    // Entry expiry window in ms (null = none) and the run's reference time.
    maxTimeMs,
    now,
  ) {
    this.cacheDir = cacheDir;
    this.asTestVersion = asTestVersion;
    this.manifest = manifest;
    this.maxTimeMs = maxTimeMs;
    this.now = now;
    this.dirty = false;
  }
  // Loads the manifest, self-healing to an empty cache on a missing/corrupt
  // file or a format/version mismatch (a new as-test may emit different
  // transform output, so the whole cache is invalidated on version bump).
  static load(cacheDir, asTestVersion, opts = {}) {
    const maxTimeMs = opts.maxTimeMs ?? null;
    const now = opts.now ?? Date.now();
    const empty = {
      version: CACHE_FORMAT_VERSION,
      asTestVersion,
      entries: {},
    };
    const manifestPath = path.join(cacheDir, MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
      return new BuildCache(cacheDir, asTestVersion, empty, maxTimeMs, now);
    }
    try {
      const parsed = JSON.parse(
        gunzipSync(readFileSync(manifestPath)).toString("utf8"),
      );
      if (
        parsed.version !== CACHE_FORMAT_VERSION ||
        parsed.asTestVersion !== asTestVersion ||
        typeof parsed.entries !== "object" ||
        parsed.entries === null
      ) {
        return new BuildCache(cacheDir, asTestVersion, empty, maxTimeMs, now);
      }
      return new BuildCache(cacheDir, asTestVersion, parsed, maxTimeMs, now);
    } catch {
      return new BuildCache(cacheDir, asTestVersion, empty, maxTimeMs, now);
    }
  }
  isBuildFresh(mode, spec, ctx) {
    const entry = this.manifest.entries[specKey(mode, spec)];
    if (!entry) return false;
    if (entry.buildSignature !== ctx.signature) return false;
    if (entry.coverageEnabled !== ctx.coverageEnabled) return false;
    // Time-based expiry: an entry built longer ago than maxTime is stale.
    // Entries from before this field existed (builtAt undefined) count as 0,
    // so they expire on the first run with maxTime set.
    if (
      this.maxTimeMs != null &&
      this.now - (entry.builtAt ?? 0) > this.maxTimeMs
    ) {
      return false;
    }
    if (!existsSync(entry.outFile)) return false;
    for (const [dep, fp] of Object.entries(entry.deps)) {
      if (!this.depUnchanged(dep, fp)) return false;
    }
    return true;
  }
  // Tier 2: can we replay the stored report instead of running? A non-null
  // reportPath means the build was fresh this session (recordBuild clears it on
  // any rebuild), so the build signature + deps were already validated by
  // build() before run() — we only re-check the run-specific inputs here
  // (runtime command + snapshot file).
  canReplay(mode, spec, ctx) {
    const entry = this.manifest.entries[specKey(mode, spec)];
    if (!entry?.reportPath) return false;
    if ((entry.runtimeCmd ?? null) !== (ctx.runtimeCmd ?? null)) return false;
    if ((entry.snapshotSha ?? null) !== (ctx.snapshotSha ?? null)) return false;
    if (!existsSync(entry.outFile)) return false;
    return existsSync(path.join(this.cacheDir, entry.reportPath));
  }
  recordBuild(mode, spec, args) {
    const absSpec = path.resolve(spec);
    const deps = {};
    const record = (file) => {
      const abs = path.resolve(file);
      if (isUninterestingDep(abs)) return;
      if (deps[abs]) return;
      const fp = this.fingerprint(abs);
      if (fp) deps[abs] = fp;
    };
    record(absSpec); // a spec is always its own dependency
    for (const file of args.deps) record(file);
    const key = specKey(mode, spec);
    const prior = this.manifest.entries[key];
    // A rebuild means any stored report is stale: drop it so isReplayFresh
    // fails until the fresh run records a new one.
    this.removeReportFile(prior?.reportPath ?? null);
    this.manifest.entries[key] = {
      spec: absSpec,
      mode: mode ?? null,
      buildSignature: args.signature,
      outFile: path.resolve(args.outFile),
      coverageEnabled: args.coverageEnabled,
      deps,
      builtAt: this.now,
      runtimeCmd: null,
      snapshotSha: null,
      reportPath: null,
    };
    this.dirty = true;
  }
  recordReport(mode, spec, args) {
    const key = specKey(mode, spec);
    const entry = this.manifest.entries[key];
    if (!entry) return; // recordBuild must have run first
    const relPath = path.join("reports", `${sha1(key)}.json.gz`);
    const absPath = path.join(this.cacheDir, relPath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    // Reports are large (coverage points) and highly compressible repetitive
    // JSON — gzip keeps .as-test/cache small (~15x on coverage-heavy specs).
    writeFileSync(absPath, gzipSync(Buffer.from(JSON.stringify(args.report))));
    entry.reportPath = relPath;
    entry.snapshotSha = args.snapshotSha;
    entry.runtimeCmd = args.runtimeCmd;
    this.dirty = true;
  }
  getReport(mode, spec) {
    const entry = this.manifest.entries[specKey(mode, spec)];
    if (!entry?.reportPath) return undefined;
    try {
      return JSON.parse(
        gunzipSync(
          readFileSync(path.join(this.cacheDir, entry.reportPath)),
        ).toString("utf8"),
      );
    } catch {
      return undefined;
    }
  }
  // Drop entries whose spec is no longer produced by the current input glob
  // (deleted/renamed specs), along with their stored report files. liveKeys are
  // specKey() strings for every (mode, spec) in this run.
  prune(liveKeys) {
    for (const [key, entry] of Object.entries(this.manifest.entries)) {
      if (liveKeys.has(key)) continue;
      this.removeReportFile(entry.reportPath ?? null);
      delete this.manifest.entries[key];
      this.dirty = true;
    }
  }
  keyFor(mode, spec) {
    return specKey(mode, spec);
  }
  save() {
    if (!this.dirty) return;
    mkdirSync(this.cacheDir, { recursive: true });
    const manifestPath = path.join(this.cacheDir, MANIFEST_FILE);
    const tmp = `${manifestPath}.tmp`;
    writeFileSync(tmp, gzipSync(Buffer.from(JSON.stringify(this.manifest))));
    renameSync(tmp, manifestPath);
    this.dirty = false;
  }
  fingerprint(absPath) {
    try {
      const st = statSync(absPath);
      const sha = sha256OfFile(absPath);
      if (sha === null) return null;
      return { sha, mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      return null;
    }
  }
  // Fast-path: trust mtime+size when both match (cheap stat, no read). Only when
  // they differ do we hash — and if the hash still matches (e.g. git checkout
  // rewrote mtime), refresh the stored stat so we don't re-hash next run.
  depUnchanged(absPath, fp) {
    let st;
    try {
      st = statSync(absPath);
    } catch {
      return false; // dep deleted
    }
    if (st.mtimeMs === fp.mtimeMs && st.size === fp.size) return true;
    const sha = sha256OfFile(absPath);
    if (sha === null) return false;
    if (sha === fp.sha) {
      fp.mtimeMs = st.mtimeMs;
      fp.size = st.size;
      this.dirty = true;
      return true;
    }
    return false;
  }
  removeReportFile(relPath) {
    if (!relPath) return;
    try {
      rmSync(path.join(this.cacheDir, relPath), { force: true });
    } catch {
      // best effort
    }
  }
}
function sha1(value) {
  return createHash("sha1").update(value).digest("hex");
}
// True if any suite or test in a file report carries a "fail" verdict. We only
// replay passing reports — a failing spec is cheap to re-run and gives fresh
// failure output rather than a confusing replay.
export function reportHasFailure(report) {
  const suites = report?.suites;
  if (!Array.isArray(suites)) return false;
  return suites.some(suiteHasFailure);
}
function suiteHasFailure(suite) {
  const s = suite;
  if (s?.verdict === "fail") return true;
  if (Array.isArray(s?.tests) && s.tests.some((t) => t?.verdict === "fail")) {
    return true;
  }
  if (Array.isArray(s?.suites) && s.suites.some(suiteHasFailure)) return true;
  return false;
}
// Run-scoped cache context, set once by the test orchestrator. `replay` gates
// Tier 2 (off under snapshot-write flags, on for `cache: "full"`).
export const cacheStorage = new AsyncLocalStorage();
