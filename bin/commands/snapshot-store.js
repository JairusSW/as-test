import * as path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolveSnapshotPath } from "../util.js";
export class SnapshotStore {
  constructor(specFile, snapshotDir, inputPatterns) {
    this.dirty = false;
    this.created = 0;
    this.updated = 0;
    this.matched = 0;
    this.failed = 0;
    this.warnedMissing = new Set();
    this.specBasename = path.basename(specFile);
    this.filePath = resolveSnapshotPath(specFile, snapshotDir, inputPatterns);
    const sourcePath = existsSync(this.filePath) ? this.filePath : null;
    const loaded = sourcePath
      ? readSnapshotFile(sourcePath, specFile)
      : { data: {}, normalized: false, preamble: "" };
    this.data = loaded.data;
    this.preamble = loaded.preamble;
    this.existed = Boolean(sourcePath);
    this.dirty = Boolean(loaded.normalized);
  }
  assert(key, actual, allowSnapshot, createSnapshots, overwriteSnapshots) {
    key = canonicalizeSnapshotKey(key);
    key = normalizeSnapshotKeyPrefix(key, this.specBasename);
    if (!allowSnapshot)
      return { ok: true, expected: actual, warnMissing: false };
    if (!(key in this.data)) {
      if (!createSnapshots) {
        this.failed++;
        const warnMissing = !this.warnedMissing.has(key);
        if (warnMissing) this.warnedMissing.add(key);
        return {
          ok: false,
          expected: JSON.stringify("<missing snapshot>"),
          warnMissing,
        };
      }
      this.created++;
      this.dirty = true;
      this.data[key] = actual;
      return { ok: true, expected: actual, warnMissing: false };
    }
    const expected = this.data[key];
    if (expected === actual) {
      this.matched++;
      return { ok: true, expected, warnMissing: false };
    }
    if (!overwriteSnapshots) {
      this.failed++;
      return { ok: false, expected, warnMissing: false };
    }
    this.updated++;
    this.dirty = true;
    this.data[key] = actual;
    return { ok: true, expected: actual, warnMissing: false };
  }
  flush() {
    if (!this.dirty) return;
    const outDir = path.dirname(this.filePath);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(
      this.filePath,
      formatSnapshotFile(
        this.data,
        this.filePath,
        this.existed ? this.preamble : defaultSnapshotPreamble(),
      ),
    );
  }
}
function readSnapshotFile(filePath, specFile) {
  const raw = readFileSync(filePath, "utf8");
  if (filePath.endsWith(".json")) {
    let record;
    try {
      record = JSON.parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `snapshot file is not valid JSON: ${filePath}\n  ${reason}\n  ` +
          "Fix the file by hand, or delete it and re-run with --create-snapshots.",
      );
    }
    const normalized = normalizeSnapshotRecord(record);
    return { ...normalized, preamble: "" };
  }
  return parseSnapshotText(raw, specFile);
}
function parseSnapshotText(source, specFile) {
  const out = {};
  const lines = source.split(/\r?\n/);
  let i = 0;
  let normalized = false;
  const preambleLines = [];
  while (i < lines.length) {
    const header = lines[i] ?? "";
    if (isSnapshotOuterComment(header) || !header.length) {
      if (!Object.keys(out).length) preambleLines.push(header);
      i++;
      continue;
    }
    const match = header.match(/^=== (.+) ===$/);
    if (!match) {
      i++;
      continue;
    }
    const localKey = match[1];
    i++;
    let value = "";
    if ((lines[i] ?? "") == "<<<") {
      i++;
      const block = [];
      while (i < lines.length && (lines[i] ?? "") != ">>>") {
        block.push(lines[i] ?? "");
        i++;
      }
      value = block.join("\n");
      if ((lines[i] ?? "") == ">>>") i++;
    } else {
      value = lines[i] ?? "";
      i++;
    }
    while (i < lines.length && !(lines[i] ?? "").startsWith("=== ")) {
      if (!lines[i]?.length || isSnapshotOuterComment(lines[i] ?? "")) {
        i++;
        continue;
      }
      break;
    }
    while (i < lines.length && isSnapshotOuterComment(lines[i] ?? "")) {
      i++;
    }
    const qualified = qualifySnapshotKey(specFile, localKey);
    const canonical = canonicalizeSnapshotKey(qualified);
    if (canonical != qualified) normalized = true;
    out[canonical] = value;
  }
  return {
    data: out,
    normalized,
    preamble: trimSnapshotPreamble(preambleLines),
  };
}
function normalizeSnapshotRecord(data) {
  const out = {};
  let normalized = false;
  for (const [key, value] of Object.entries(data)) {
    const canonical = canonicalizeSnapshotKey(key);
    if (canonical != key) normalized = true;
    out[canonical] = value;
  }
  return { data: out, normalized };
}
function isSnapshotOuterComment(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("#") || trimmed.startsWith("//");
}
function formatSnapshotFile(data, filePath, preamble) {
  const specFile = resolveSnapshotSpecFile(filePath);
  const seen = new Set();
  const sections = [];
  for (const key of Object.keys(data)) {
    const localKey = canonicalizeSnapshotLocalKey(
      localizeSnapshotKey(specFile, key),
    );
    if (seen.has(localKey)) continue;
    seen.add(localKey);
    const value = data[key] ?? "";
    if (value.includes("\n")) {
      sections.push(`=== ${localKey} ===\n<<<\n${value}\n>>>`);
    } else {
      sections.push(`=== ${localKey} ===\n${value}`);
    }
  }
  if (!sections.length) return "";
  const prefix = preamble.length ? preamble + "\n\n" : "";
  return prefix + sections.join("\n\n") + "\n";
}
function defaultSnapshotPreamble() {
  return [
    "# as-test snapshot file",
    "#",
    "# IDs use this format:",
    "#   Suite > test",
    "#   Suite > test [name]",
    "#   Suite > test #2",
    "#",
    "# Examples:",
    '#   test("renders card", () => {',
    "#     expect(view()).toMatchSnapshot();",
    "#   })",
    "#   -> renders card",
    "#",
    '#   test("renders card", () => {',
    '#     expect(view()).toMatchSnapshot("mobile");',
    "#   })",
    "#   -> renders card [mobile]",
    "#",
    '#   test("renders card", () => {',
    "#     expect(header()).toMatchSnapshot();",
    "#     expect(body()).toMatchSnapshot();",
    "#   })",
    "#   -> renders card",
    "#   -> renders card #2",
    "#",
    '#   describe("Card", () => {',
    '#     test("renders", () => {',
    "#       expect(view()).toMatchSnapshot();",
    "#     })",
    "#   })",
    "#   -> Card > renders",
    "#",
    "# Single-line values are written directly below the ID.",
    "# Multi-line values use delimiters:",
    "#   <<<",
    "#   ...",
    "#   >>>",
  ].join("\n");
}
function trimSnapshotPreamble(lines) {
  let end = lines.length;
  while (end > 0 && !(lines[end - 1] ?? "").trim().length) end--;
  return lines.slice(0, end).join("\n");
}
// Only the basename of the returned path matters — callers feed this into
// `path.basename(...)` to localize snapshot keys (strip the "${basename}::"
// prefix). The full path is therefore synthetic but stable.
function resolveSnapshotSpecFile(filePath) {
  return path.basename(filePath).replace(/\.snap$/, ".ts");
}
function localizeSnapshotKey(specFile, key) {
  const prefix = `${path.basename(specFile)}::`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}
function normalizeSnapshotKeyPrefix(key, specBasename) {
  const sep = key.indexOf("::");
  if (sep < 0) return key;
  return `${specBasename}::${key.slice(sep + 2)}`;
}
function qualifySnapshotKey(specFile, key) {
  return `${path.basename(specFile)}::${key}`;
}
function canonicalizeSnapshotKey(key) {
  const sep = key.indexOf("::");
  if (sep < 0) return canonicalizeSnapshotLocalKey(key);
  const prefix = key.slice(0, sep + 2);
  const local = key.slice(sep + 2);
  return prefix + canonicalizeSnapshotLocalKey(local);
}
function canonicalizeSnapshotLocalKey(localKey) {
  const named = localKey.match(/^(.*)::\d+::(.+)$/);
  if (named) {
    return `${named[1]} [${named[2]}]`;
  }
  const simpleNamed = localKey.match(/^(.*)::([^:]+)$/);
  if (simpleNamed && !/^\d+$/.test(simpleNamed[2])) {
    return `${simpleNamed[1]} [${simpleNamed[2]}]`;
  }
  const unnamed = localKey.match(/^(.*)::(\d+)$/);
  if (unnamed) {
    const index = Number(unnamed[2]);
    if (!Number.isFinite(index) || index < 0) return localKey;
    return index === 0 ? unnamed[1] : `${unnamed[1]} #${index + 1}`;
  }
  return localKey;
}
