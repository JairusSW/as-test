import { spawn } from "child_process";
import { fileURLToPath } from "url";
export class BuildWorkerPool {
    constructor(size) {
        this.pools = new Map();
        this.nextId = 1;
        this.closed = false;
        this.size = Math.max(1, size);
    }
    buildFileMode(args) {
        if (this.closed) {
            return Promise.reject(new Error("build worker pool is closed"));
        }
        const featureToggles = args.featureToggles ?? {};
        const overrides = args.overrides ?? {};
        const signature = buildSignature(args.modeName, featureToggles, overrides);
        const pool = this.getPool(signature);
        return new Promise((resolve, reject) => {
            pool.queue.push({
                id: this.nextId++,
                configPath: args.configPath,
                file: args.file,
                modeName: args.modeName,
                featureToggles,
                overrides,
                resolve,
                reject,
            });
            this.pump(pool);
        });
    }
    async close() {
        this.closed = true;
        const waits = [];
        for (const pool of this.pools.values()) {
            while (pool.queue.length) {
                const task = pool.queue.shift();
                task.reject(new Error("build worker pool closed"));
            }
            for (const worker of pool.workers) {
                waits.push(new Promise((resolve) => {
                    if (worker.child.exitCode != null || worker.child.killed) {
                        resolve();
                        return;
                    }
                    worker.child.once("exit", () => resolve());
                    worker.child.kill();
                }));
            }
        }
        await Promise.all(waits);
    }
    getPool(signature) {
        let pool = this.pools.get(signature);
        if (pool)
            return pool;
        pool = {
            workers: Array.from({ length: this.size }, () => this.spawnWorker(signature)),
            queue: [],
        };
        this.pools.set(signature, pool);
        return pool;
    }
    spawnWorker(signature) {
        const workerPath = fileURLToPath(new URL("./build-worker.js", import.meta.url));
        const child = spawn(process.execPath, [workerPath], {
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const worker = {
            child,
            busy: false,
            task: null,
        };
        child.on("message", (message) => {
            this.onMessage(signature, worker, message);
        });
        child.on("exit", () => {
            const pool = this.pools.get(signature);
            const failedTask = worker.task;
            worker.busy = false;
            worker.task = null;
            if (failedTask) {
                failedTask.reject(new Error("build worker exited unexpectedly"));
            }
            if (!pool || this.closed)
                return;
            const index = pool.workers.indexOf(worker);
            if (index >= 0) {
                pool.workers[index] = this.spawnWorker(signature);
            }
            this.pump(pool);
        });
        return worker;
    }
    onMessage(signature, worker, message) {
        const pool = this.pools.get(signature);
        const task = worker.task;
        if (!pool || !task || task.id !== message.id)
            return;
        worker.busy = false;
        worker.task = null;
        if (message.type == "done") {
            task.resolve();
        }
        else {
            task.reject(deserializeError(message.error));
        }
        this.pump(pool);
    }
    pump(pool) {
        for (const worker of pool.workers) {
            if (worker.busy)
                continue;
            const task = pool.queue.shift();
            if (!task)
                return;
            worker.busy = true;
            worker.task = task;
            worker.child.send({
                type: "build-file",
                id: task.id,
                configPath: task.configPath,
                file: task.file,
                modeName: task.modeName,
                featureToggles: task.featureToggles,
                overrides: task.overrides,
            });
        }
    }
}
function buildSignature(modeName, featureToggles, overrides) {
    return JSON.stringify({
        modeName: modeName ?? "default",
        featureToggles,
        overrides,
    });
}
function deserializeError(payload) {
    const error = new Error(typeof payload.message == "string" ? payload.message : "unknown error");
    error.name = typeof payload.name == "string" ? payload.name : "Error";
    if (typeof payload.stack == "string")
        error.stack = payload.stack;
    for (const [key, value] of Object.entries(payload)) {
        if (key == "name" || key == "message" || key == "stack")
            continue;
        error[key] = value;
    }
    return error;
}
