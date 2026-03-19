import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
export function persistCrashRecord(rootDir, record) {
    const entry = crashEntryKey(record.file);
    const dir = path.resolve(process.cwd(), rootDir, entry);
    mkdirSync(dir, { recursive: true });
    const stamp = utcStamp();
    const jsonName = `${stamp}.json`;
    const logName = `${stamp}.log`;
    const jsonPath = path.join(dir, jsonName);
    const logPath = path.join(dir, logName);
    const latestJsonPath = path.join(dir, "latest.json");
    const latestLogPath = path.join(dir, "latest.log");
    const payload = {
        timestamp: new Date().toISOString(),
        ...record,
    };
    const log = buildCrashLog(payload);
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    writeFileSync(logPath, log);
    writeFileSync(latestJsonPath, JSON.stringify(payload, null, 2));
    writeFileSync(latestLogPath, log);
    return { jsonPath, logPath };
}
function crashEntryKey(file) {
    return path.basename(file).replace(/\.ts$/, "");
}
function utcStamp() {
    return new Date().toISOString().replace(/:/g, "-");
}
function buildCrashLog(payload) {
    const lines = [
        `timestamp: ${payload.timestamp}`,
        `kind: ${payload.kind}`,
        `file: ${payload.file}`,
    ];
    if (payload.mode)
        lines.push(`mode: ${payload.mode}`);
    if (typeof payload.seed == "number")
        lines.push(`seed: ${payload.seed}`);
    lines.push("");
    lines.push("[error]");
    lines.push(payload.error);
    if (payload.failure) {
        lines.push("");
        lines.push("[failure]");
        if (payload.failure.instr)
            lines.push(`instr: ${payload.failure.instr}`);
        if (payload.failure.left)
            lines.push(`left: ${payload.failure.left}`);
        if (payload.failure.right)
            lines.push(`right: ${payload.failure.right}`);
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
