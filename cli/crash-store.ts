import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";

export type CrashRecord = {
  kind: "test" | "fuzz";
  stage?: "build" | "run";
  file: string;
  mode?: string;
  seed?: number;
  cwd?: string;
  buildCommand?: string;
  runCommand?: string;
  reproCommand?: string;
  error: string;
  stdout?: string;
  stderr?: string;
  failure?: {
    instr?: string;
    left?: string;
    right?: string;
    message?: string;
  };
};

export function persistCrashRecord(
  rootDir: string,
  record: CrashRecord,
): {
  jsonPath: string;
  logPath: string;
} {
  const entry = crashEntryKey(record.file);
  const dir = path.resolve(process.cwd(), rootDir);
  mkdirSync(dir, { recursive: true });

  const jsonPath = path.join(dir, `${entry}.json`);
  const logPath = path.join(dir, `${entry}.log`);

  const payload = {
    timestamp: new Date().toISOString(),
    ...record,
  };
  const log = buildCrashLog(payload);

  writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  writeFileSync(logPath, log);

  return { jsonPath, logPath };
}

function crashEntryKey(file: string): string {
  return path.basename(file).replace(/\.ts$/, "");
}

function buildCrashLog(payload: CrashRecord & { timestamp: string }): string {
  const lines = [
    `timestamp: ${payload.timestamp}`,
    `kind: ${payload.kind}`,
    `stage: ${payload.stage ?? "run"}`,
    `file: ${payload.file}`,
  ];
  if (payload.mode) lines.push(`mode: ${payload.mode}`);
  if (typeof payload.seed == "number") lines.push(`seed: ${payload.seed}`);
  if (payload.cwd) lines.push(`cwd: ${payload.cwd}`);
  if (payload.buildCommand) lines.push(`build: ${payload.buildCommand}`);
  if (payload.runCommand) lines.push(`run: ${payload.runCommand}`);
  if (payload.reproCommand) lines.push(`repro: ${payload.reproCommand}`);
  lines.push("");
  lines.push("[error]");
  lines.push(payload.error);
  if (payload.failure) {
    lines.push("");
    lines.push("[failure]");
    if (payload.failure.instr) lines.push(`instr: ${payload.failure.instr}`);
    if (payload.failure.left) lines.push(`left: ${payload.failure.left}`);
    if (payload.failure.right) lines.push(`right: ${payload.failure.right}`);
    if (payload.failure.message) {
      lines.push(`message: ${payload.failure.message}`);
    }
  }
  lines.push("");
  lines.push("[stdout]");
  lines.push(payload.stdout ?? "");
  lines.push("");
  lines.push("[stderr]");
  lines.push(payload.stderr ?? "");
  lines.push("");
  return lines.join("\n");
}
