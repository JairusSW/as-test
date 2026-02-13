import chalk from "chalk";
import { spawn } from "child_process";
import { glob } from "glob";
import { getExec, loadConfig } from "./util.js";
import * as path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, } from "fs";
import { LiveProgressReporter, Reporter, renderFailedSuites, renderSnapshotSummary, renderTotals, } from "./reporter.js";
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "./as-test.config.json");
var MessageType;
(function (MessageType) {
    MessageType[MessageType["OPEN"] = 0] = "OPEN";
    MessageType[MessageType["CLOSE"] = 1] = "CLOSE";
    MessageType[MessageType["CALL"] = 2] = "CALL";
    MessageType[MessageType["DATA"] = 3] = "DATA";
})(MessageType || (MessageType = {}));
class Channel {
    constructor(input, output) {
        this.input = input;
        this.output = output;
        this.buffer = Buffer.alloc(0);
        this.input.on("data", (chunk) => this.onData(chunk));
    }
    send(type, payload) {
        const body = payload ?? Buffer.alloc(0);
        const header = Buffer.alloc(Channel.HEADER_SIZE);
        Channel.MAGIC.copy(header, 0);
        header.writeUInt8(type, 4);
        header.writeUInt32LE(body.length, 5);
        this.output.write(Buffer.concat([header, body]));
    }
    sendJSON(type, msg) {
        this.send(type, Buffer.from(JSON.stringify(msg), "utf8"));
    }
    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            if (this.buffer.length === 0)
                return;
            const idx = this.buffer.indexOf(Channel.MAGIC);
            if (idx === -1) {
                this.onPassthrough(this.buffer);
                this.buffer = Buffer.alloc(0);
                return;
            }
            if (idx > 0) {
                this.onPassthrough(this.buffer.subarray(0, idx));
                this.buffer = this.buffer.subarray(idx);
            }
            if (this.buffer.length < Channel.HEADER_SIZE)
                return;
            const type = this.buffer.readUInt8(4);
            const length = this.buffer.readUInt32LE(5);
            const frameSize = Channel.HEADER_SIZE + length;
            if (this.buffer.length < frameSize)
                return;
            const payload = this.buffer.subarray(Channel.HEADER_SIZE, frameSize);
            this.buffer = this.buffer.subarray(frameSize);
            this.handleFrame(type, payload);
        }
    }
    handleFrame(type, payload) {
        switch (type) {
            case MessageType.OPEN:
                this.onOpen();
                break;
            case MessageType.CLOSE:
                this.onClose();
                break;
            case MessageType.CALL:
                this.onCall(JSON.parse(payload.toString("utf8")));
                break;
            case MessageType.DATA:
                this.onDataMessage(payload);
                break;
            default:
                this.onPassthrough(payload);
        }
    }
    onPassthrough(_data) { }
    onOpen() { }
    onClose() { }
    onCall(_msg) { }
    onDataMessage(_data) { }
}
Channel.MAGIC = Buffer.from("WIPC");
Channel.HEADER_SIZE = 9;
class SnapshotStore {
    constructor(specFile) {
        this.dirty = false;
        this.created = 0;
        this.updated = 0;
        this.matched = 0;
        this.failed = 0;
        this.warnedMissing = new Set();
        const base = path.basename(specFile, ".ts");
        const dir = path.join(process.cwd(), "__snapshots__");
        if (!existsSync(dir))
            mkdirSync(dir, { recursive: true });
        this.filePath = path.join(dir, `${base}.snap.json`);
        this.data = existsSync(this.filePath)
            ? JSON.parse(readFileSync(this.filePath, "utf8"))
            : {};
    }
    assert(key, actual, allowSnapshot, updateSnapshots) {
        if (!allowSnapshot)
            return { ok: true, expected: actual };
        if (!(key in this.data)) {
            if (!updateSnapshots) {
                this.failed++;
                if (!this.warnedMissing.has(key)) {
                    this.warnedMissing.add(key);
                    console.log(`${chalk.bgYellow.black(" WARN ")} missing snapshot for ${chalk.dim(key)}. Re-run with ${chalk.bold("--update-snapshots")} to create it.`);
                }
                return { ok: false, expected: JSON.stringify("<missing snapshot>") };
            }
            this.created++;
            this.dirty = true;
            this.data[key] = actual;
            return { ok: true, expected: actual };
        }
        const expected = this.data[key];
        if (expected === actual) {
            this.matched++;
            return { ok: true, expected };
        }
        if (!updateSnapshots) {
            this.failed++;
            return { ok: false, expected };
        }
        this.updated++;
        this.dirty = true;
        this.data[key] = actual;
        return { ok: true, expected: actual };
    }
    flush() {
        if (!this.dirty)
            return;
        writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    }
}
export async function run(flags = {}, configPath = DEFAULT_CONFIG_PATH) {
    const reports = [];
    const config = loadConfig(configPath);
    const inputFiles = await glob(config.input);
    const snapshotEnabled = flags.snapshot !== false;
    const updateSnapshots = Boolean(flags.updateSnapshots);
    const cleanOutput = Boolean(flags.clean);
    if (!cleanOutput) {
        console.log(chalk.dim("Running tests using " + config.runOptions.runtime.name + ""));
        if (snapshotEnabled) {
            console.log(chalk.bgBlue(" SNAPSHOT ") +
                ` ${chalk.dim(updateSnapshots ? "update mode enabled" : "read-only mode")}\n`);
        }
    }
    const command = config.runOptions.runtime.run.split(" ")[0];
    const execPath = getExec(command);
    if (!execPath) {
        console.log(`${chalk.bgRed(" ERROR ")}${chalk.dim(":")} could not locate ${command} in PATH variable!`);
        process.exit(1);
    }
    if (!cleanOutput) {
        for (const plugin of Object.keys(config.plugins)) {
            if (!config.plugins[plugin])
                continue;
            console.log(chalk.bgBlueBright(" PLUGIN ") +
                " " +
                chalk.dim("Using " + plugin.slice(0, 1).toUpperCase() + plugin.slice(1)) +
                "\n");
        }
    }
    const snapshotSummary = {
        matched: 0,
        created: 0,
        updated: 0,
        failed: 0,
    };
    for (let i = 0; i < inputFiles.length; i++) {
        const file = inputFiles[i];
        const outFile = path.join(config.outDir, file.slice(file.lastIndexOf("/") + 1).replace(".ts", ".wasm"));
        let cmd = config.runOptions.runtime.run.replace(command, execPath);
        if (config.buildOptions.target == "bindings") {
            if (cmd.includes("<name>")) {
                cmd = cmd.replace("<name>", file
                    .slice(file.lastIndexOf("/") + 1)
                    .replace(".ts", "")
                    .replace(".spec", ""));
            }
            else {
                cmd = cmd.replace("<file>", outFile
                    .replace("build", "tests")
                    .replace(".spec", "")
                    .replace(".wasm", ".run.js"));
            }
        }
        else {
            cmd = cmd.replace("<file>", outFile);
        }
        const snapshotStore = new SnapshotStore(file);
        const report = await runProcess(cmd, snapshotStore, snapshotEnabled, updateSnapshots, cleanOutput);
        snapshotStore.flush();
        snapshotSummary.matched += snapshotStore.matched;
        snapshotSummary.created += snapshotStore.created;
        snapshotSummary.updated += snapshotStore.updated;
        snapshotSummary.failed += snapshotStore.failed;
        reports.push(report);
    }
    if (config.logs && config.logs != "none") {
        if (!existsSync(path.join(process.cwd(), config.logs))) {
            mkdirSync(path.join(process.cwd(), config.logs), { recursive: true });
        }
        writeFileSync(path.join(process.cwd(), config.logs, "test.log.json"), JSON.stringify(reports, null, 2));
    }
    const reporter = new Reporter(reports);
    if (!cleanOutput)
        renderFailedSuites(reporter);
    if (snapshotEnabled) {
        renderSnapshotSummary(snapshotSummary);
    }
    renderTotals(reporter);
    if (reporter.failedFiles || snapshotSummary.failed)
        process.exit(1);
    process.exit(0);
}
async function runProcess(cmd, snapshots, snapshotEnabled, updateSnapshots, cleanOutput) {
    const child = spawn(cmd, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
    });
    let report = null;
    let parseError = null;
    const live = cleanOutput ? null : new LiveProgressReporter();
    child.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
    });
    class TestChannel extends Channel {
        onPassthrough(data) {
            process.stdout.write(data);
        }
        onCall(msg) {
            const event = msg;
            const kind = String(event.kind ?? "");
            if (kind === "event:assert-fail") {
                // Keep live progress clean; detailed assertion failures are rendered
                // after the run from the final report payload.
                return;
            }
            if (kind === "event:file-start") {
                live?.fileStart({
                    file: String(event.file ?? "unknown"),
                    depth: 0,
                    suiteKind: "file",
                    description: String(event.file ?? "unknown"),
                });
                return;
            }
            if (kind === "event:file-end") {
                live?.fileEnd({
                    file: String(event.file ?? "unknown"),
                    depth: 0,
                    suiteKind: "file",
                    description: String(event.file ?? "unknown"),
                    verdict: String(event.verdict ?? "none"),
                    time: String(event.time ?? ""),
                });
                return;
            }
            if (kind === "event:suite-start") {
                live?.suiteStart({
                    file: String(event.file ?? "unknown"),
                    depth: Number(event.depth ?? 0),
                    suiteKind: String(event.suiteKind ?? ""),
                    description: String(event.description ?? ""),
                });
                return;
            }
            if (kind === "event:suite-end") {
                live?.suiteEnd({
                    file: String(event.file ?? "unknown"),
                    depth: Number(event.depth ?? 0),
                    suiteKind: String(event.suiteKind ?? ""),
                    description: String(event.description ?? ""),
                    verdict: String(event.verdict ?? "none"),
                });
                return;
            }
            if (kind === "snapshot:assert") {
                const key = String(event.key ?? "");
                const actual = String(event.actual ?? "");
                const result = snapshots.assert(key, actual, snapshotEnabled, updateSnapshots);
                this.send(MessageType.CALL, Buffer.from(`${result.ok ? "1" : "0"}\n${result.expected}`, "utf8"));
                return;
            }
            this.sendJSON(MessageType.CALL, { ok: true, expected: "" });
        }
        onDataMessage(data) {
            try {
                report = JSON.parse(data.toString("utf8"));
            }
            catch (error) {
                parseError = String(error);
            }
        }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _channel = new TestChannel(child.stdout, child.stdin);
    const code = await new Promise((resolve) => {
        child.on("close", (exitCode) => resolve(exitCode ?? 1));
    });
    if (parseError) {
        throw new Error(`could not parse report payload: ${parseError}`);
    }
    if (!report) {
        throw new Error("missing report payload from test runtime");
    }
    if (code !== 0) {
        // Let report determine failure counts, but keep non-zero child exits visible.
        process.stderr.write(chalk.dim(`child process exited with code ${code}\n`));
    }
    return report;
}
