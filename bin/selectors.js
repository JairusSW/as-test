import { glob } from "glob";
import chalk from "chalk";
import * as path from "path";
// Selector resolution runs in several places per command (the orchestrator,
// then build/run cores per file); dedupe by text so a warning prints once per
// process regardless of how many resolvers see the same selector.
const reportedSelectorWarnings = new Set();
export function emitSelectorWarnings(warnings) {
  for (const warning of warnings) {
    if (reportedSelectorWarnings.has(warning)) continue;
    reportedSelectorWarnings.add(warning);
    process.stderr.write(`${chalk.yellow.bold("WARN")} ${warning}\n`);
  }
}
const GLOB_MAGIC = /[*?[\]{}]/;
function hasGlobMagic(selector) {
  return GLOB_MAGIC.test(selector);
}
function endsWithSlash(selector) {
  return /[\\/]$/.test(selector);
}
function stripTrailingSlash(selector) {
  return selector.replace(/[\\/]+$/, "");
}
function stripSuiteSuffix(selector) {
  return selector.replace(/\.spec\.ts$/, "").replace(/\.ts$/, "");
}
function isCwdRelative(selector) {
  return (
    selector.startsWith("./") ||
    selector.startsWith("../") ||
    selector.startsWith(".\\") ||
    selector.startsWith("..\\") ||
    selector.startsWith("/") ||
    selector.startsWith("~") ||
    path.isAbsolute(selector)
  );
}
// A selector with a path separator that is not merely a single trailing slash
// (e.g. `assembly/__tests__/foo.spec.ts`, passed verbatim by the orchestrator)
// is treated as a direct cwd-relative path rather than a test-folder alias.
function hasInternalSlash(selector) {
  return /[\\/]/.test(stripTrailingSlash(selector));
}
// The longest leading run of path segments containing no glob magic — the
// static "test folder" of an input pattern (`assembly/__tests__/**/*.spec.ts`
// -> `assembly/__tests__`).
function globBase(pattern) {
  const segments = pattern.split("/");
  const base = [];
  for (const segment of segments) {
    if (hasGlobMagic(segment)) break;
    base.push(segment);
  }
  return base.join("/") || ".";
}
function uniqueInputRoots(configuredInputs) {
  const roots = new Set();
  for (const pattern of configuredInputs) {
    if (pattern.startsWith("!")) continue;
    roots.add(globBase(pattern));
  }
  return [...roots];
}
// Turn a cwd-relative selector into the spec glob(s) it stands for.
function cwdPatterns(selector) {
  if (endsWithSlash(selector)) {
    return [`${stripTrailingSlash(selector)}/**/*.spec.ts`];
  }
  if (/\.ts$/.test(selector)) return [selector];
  return [`${stripSuiteSuffix(selector)}.spec.ts`];
}
// Turn a bare selector into the spec glob(s) it stands for, anchored to a
// configured input root and searched recursively beneath it. A selector that
// already carries glob magic (`rfc/*.spec.ts`, `*.spec.ts`) is appended
// verbatim so the user's pattern controls the match; a plain folder/name has
// the spec suffix supplied.
function barePatterns(root, selector) {
  if (hasGlobMagic(selector)) {
    return [`${root}/**/${selector}`];
  }
  if (endsWithSlash(selector)) {
    return [`${root}/**/${stripTrailingSlash(selector)}/**/*.spec.ts`];
  }
  return [`${root}/**/${stripSuiteSuffix(selector)}.spec.ts`];
}
// Split comma-joined bare selectors (`a,b,c`) while leaving paths and globs
// (which can legitimately contain commas, e.g. `{a,b}`) intact.
function expandSelectors(selectors) {
  const expanded = [];
  for (const selector of selectors) {
    if (!selector) continue;
    if (
      selector.includes(",") &&
      !hasInternalSlash(selector) &&
      !endsWithSlash(selector) &&
      !hasGlobMagic(selector)
    ) {
      for (const token of selector.split(",")) {
        const trimmed = token.trim();
        if (trimmed.length) expanded.push(trimmed);
      }
      continue;
    }
    expanded.push(selector);
  }
  return expanded;
}
async function globFiles(patterns) {
  return glob(patterns);
}
async function resolveSelector(selector, inputRoots) {
  const warnings = [];
  const isGlob = hasGlobMagic(selector);
  // Explicit cwd-relative selector (`./`, `../`, absolute, `~`) — resolve from
  // the cwd only. A glob is matched verbatim; a plain path gets the spec suffix.
  if (isCwdRelative(selector)) {
    const files = await globFiles(isGlob ? [selector] : cwdPatterns(selector));
    if (!files.length) {
      const bare = selector.replace(/^\.[\\/]/, "");
      let suggestion = null;
      for (const root of inputRoots) {
        const inRoot = await globFiles(barePatterns(root, bare));
        if (inRoot.length) {
          suggestion = bare;
          break;
        }
      }
      warnings.push(
        suggestion
          ? `"${selector}" not found relative to the current directory — did you mean "${suggestion}" (searches the configured test folder)?`
          : `"${selector}" not found relative to the current directory`,
      );
    }
    return { files, warnings };
  }
  // A plain path with an internal separator (e.g. the orchestrator's own
  // `assembly/__tests__/foo.spec.ts`) resolves from the cwd verbatim. Globs
  // skip this and fall through to test-folder anchoring below.
  if (!isGlob && hasInternalSlash(selector)) {
    const direct = await globFiles(cwdPatterns(selector));
    if (direct.length) return { files: direct, warnings };
    // Fall through to test-folder resolution for user shorthands like
    // `nested/array` that aren't a real cwd path.
  }
  // Bare name/folder or relative glob — configured input root(s) first.
  const perRoot = [];
  for (const root of inputRoots) {
    const files = await globFiles(barePatterns(root, selector));
    if (files.length) perRoot.push({ root, files });
  }
  if (perRoot.length) {
    if (perRoot.length > 1) {
      warnings.push(
        `selector "${selector}" matched specs under ${perRoot.length} input roots (${perRoot
          .map((entry) => entry.root)
          .join(", ")}) — running all of them`,
      );
    }
    return { files: perRoot.flatMap((entry) => entry.files), warnings };
  }
  // Fall back to the cwd before giving up.
  const cwdFiles = await globFiles(
    isGlob ? [selector] : cwdPatterns(`./${selector}`),
  );
  if (cwdFiles.length) {
    return { files: cwdFiles, warnings };
  }
  warnings.push(
    inputRoots.length
      ? `no spec files matched "${selector}" in ${inputRoots.join(", ")} or the current directory`
      : `no spec files matched "${selector}"`,
  );
  return { files: [], warnings };
}
// Resolve configured input patterns + positional selectors into the concrete
// set of spec files to act on, along with any human-readable warnings. With no
// selectors this is just the configured globs (honoring `!`-negations); with
// selectors the per-selector rules above apply and config negations are
// intentionally bypassed so an explicit pick always wins.
export async function resolveSpecFiles(configured, selectors) {
  const configuredInputs = Array.isArray(configured)
    ? configured
    : [configured];
  if (!selectors.length) {
    const include = configuredInputs.filter((p) => !p.startsWith("!"));
    const ignore = configuredInputs
      .filter((p) => p.startsWith("!"))
      .map((p) => p.slice(1));
    const files = (await glob(include, { ignore })).sort((a, b) =>
      a.localeCompare(b),
    );
    return { files, warnings: [] };
  }
  const inputRoots = uniqueInputRoots(configuredInputs);
  const files = new Set();
  const warnings = [];
  for (const selector of expandSelectors(selectors)) {
    if (!selector) continue;
    const resolved = await resolveSelector(selector, inputRoots);
    for (const file of resolved.files) files.add(file);
    warnings.push(...resolved.warnings);
  }
  return {
    files: [...files].sort((a, b) => a.localeCompare(b)),
    warnings,
  };
}
