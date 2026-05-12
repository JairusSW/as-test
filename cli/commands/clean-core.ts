import chalk from "chalk";
import { existsSync, rmSync } from "fs";
import * as path from "path";
import { applyMode, loadConfig } from "../util.js";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");

export async function clean(
  configPath: string = DEFAULT_CONFIG_PATH,
  modes: (string | undefined)[] = [undefined],
): Promise<void> {
  const loadedConfig = loadConfig(configPath, true);
  const targets = new Map<string, string[]>();
  const ownership = buildOwnershipMap(loadedConfig);

  for (const modeName of modes) {
    const active = applyMode(loadedConfig, modeName).config;
    collectTarget(targets, active.outDir, modeName, "build");
    collectTarget(targets, active.fuzz.crashDir, modeName, "crashes");
    collectTarget(targets, active.logs, modeName, "logs");
  }

  let removed = 0;
  let skipped = 0;
  for (const [targetPath, owners] of [...targets.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const allOwners = ownership.get(targetPath) ?? owners;
    const unselectedOwners = allOwners.filter((owner) => !owners.includes(owner));
    if (unselectedOwners.length) {
      skipped++;
      process.stdout.write(
        `${chalk.dim("skip")} ${toRelativePath(targetPath)} ${chalk.dim(`(shared with ${unselectedOwners.join(", ")})`)}\n`,
      );
      continue;
    }
    if (!existsSync(targetPath)) {
      skipped++;
      process.stdout.write(
        `${chalk.dim("skip")} ${toRelativePath(targetPath)} ${chalk.dim(`(${owners.join(", ")})`)}\n`,
      );
      continue;
    }
    rmSync(targetPath, { recursive: true, force: true });
    removed++;
    process.stdout.write(
      `${chalk.bgGreenBright.black(" CLEAN ")} ${toRelativePath(targetPath)} ${chalk.dim(`(${owners.join(", ")})`)}\n`,
    );
  }

  process.stdout.write(
    `${chalk.bold("Summary:")} removed ${removed} path(s), skipped ${skipped} missing path(s)\n`,
  );
}

function buildOwnershipMap(
  loadedConfig: ReturnType<typeof loadConfig>,
): Map<string, string[]> {
  const ownership = new Map<string, string[]>();
  const modeNames: (string | undefined)[] = [
    undefined,
    ...Object.keys(loadedConfig.modes),
  ];
  for (const modeName of modeNames) {
    const active = applyMode(loadedConfig, modeName).config;
    collectOwnership(ownership, active.outDir, modeName, "build");
    collectOwnership(ownership, active.fuzz.crashDir, modeName, "crashes");
    collectOwnership(ownership, active.logs, modeName, "logs");
  }
  return ownership;
}

function collectOwnership(
  ownership: Map<string, string[]>,
  rawPath: string,
  modeName: string | undefined,
  kind: "build" | "crashes" | "logs",
): void {
  if (!rawPath || rawPath == "none") return;
  const resolved = path.resolve(process.cwd(), rawPath);
  ensureSafeCleanPath(resolved, rawPath, kind);
  const owner = `${modeName ?? "default"}:${kind}`;
  const existing = ownership.get(resolved);
  if (existing) {
    if (!existing.includes(owner)) existing.push(owner);
    return;
  }
  ownership.set(resolved, [owner]);
}

function collectTarget(
  targets: Map<string, string[]>,
  rawPath: string,
  modeName: string | undefined,
  kind: "build" | "crashes" | "logs",
): void {
  if (!rawPath || rawPath == "none") return;
  const resolved = path.resolve(process.cwd(), rawPath);
  ensureSafeCleanPath(resolved, rawPath, kind);
  const owner = `${modeName ?? "default"}:${kind}`;
  const existing = targets.get(resolved);
  if (existing) {
    if (!existing.includes(owner)) existing.push(owner);
    return;
  }
  targets.set(resolved, [owner]);
}

function ensureSafeCleanPath(
  resolvedPath: string,
  rawPath: string,
  kind: "build" | "crashes" | "logs",
): void {
  const cwd = path.resolve(process.cwd());
  const relative = path.relative(cwd, resolvedPath);
  if (
    !relative.length ||
    relative == ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.parse(resolvedPath).root == resolvedPath
  ) {
    throw new Error(
      `refusing to clean unsafe ${kind} path "${rawPath}" (${resolvedPath})`,
    );
  }
}

function toRelativePath(targetPath: string): string {
  const relative = path.relative(process.cwd(), targetPath);
  return relative.length ? relative : ".";
}
