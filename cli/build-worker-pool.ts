import { ChildProcess, spawn } from "child_process";
import { fileURLToPath } from "url";
import type {
  BuildConfigOverrides,
  BuildFeatureToggles,
} from "./commands/build-core.js";

type BuildTask = {
  id: number;
  configPath?: string;
  file: string;
  modeName?: string;
  featureToggles: BuildFeatureToggles;
  overrides: BuildConfigOverrides;
  resolve: () => void;
  reject: (error: Error) => void;
};

type WorkerProcess = {
  child: ChildProcess;
  busy: boolean;
  task: BuildTask | null;
};

type SignaturePool = {
  workers: WorkerProcess[];
  queue: BuildTask[];
};

type WorkerMessage =
  | {
      type: "done";
      id: number;
    }
  | {
      type: "error";
      id: number;
      error: {
        name?: unknown;
        message?: unknown;
        stack?: unknown;
        [key: string]: unknown;
      };
    };

export class BuildWorkerPool {
  private readonly size: number;
  private readonly pools = new Map<string, SignaturePool>();
  private nextId = 1;
  private closed = false;

  constructor(size: number) {
    this.size = Math.max(1, size);
  }

  buildFileMode(args: {
    configPath?: string;
    file: string;
    modeName?: string;
    featureToggles?: BuildFeatureToggles;
    overrides?: BuildConfigOverrides;
  }): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("build worker pool is closed"));
    }
    const featureToggles = args.featureToggles ?? {};
    const overrides = args.overrides ?? {};
    const signature = buildSignature(args.modeName, featureToggles, overrides);
    const pool = this.getPool(signature);
    return new Promise<void>((resolve, reject) => {
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

  async close(): Promise<void> {
    this.closed = true;
    const waits: Promise<void>[] = [];
    for (const pool of this.pools.values()) {
      while (pool.queue.length) {
        const task = pool.queue.shift()!;
        task.reject(new Error("build worker pool closed"));
      }
      for (const worker of pool.workers) {
        waits.push(
          new Promise<void>((resolve) => {
            if (worker.child.exitCode != null || worker.child.killed) {
              resolve();
              return;
            }
            worker.child.once("exit", () => resolve());
            worker.child.kill();
          }),
        );
      }
    }
    await Promise.all(waits);
  }

  private getPool(signature: string): SignaturePool {
    let pool = this.pools.get(signature);
    if (pool) return pool;
    pool = {
      workers: Array.from({ length: this.size }, () =>
        this.spawnWorker(signature),
      ),
      queue: [],
    };
    this.pools.set(signature, pool);
    return pool;
  }

  private spawnWorker(signature: string): WorkerProcess {
    const workerPath = fileURLToPath(
      new URL("./build-worker.js", import.meta.url),
    );
    const child = spawn(process.execPath, [workerPath], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    const worker: WorkerProcess = {
      child,
      busy: false,
      task: null,
    };
    child.on("message", (message: WorkerMessage) => {
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
      if (!pool || this.closed) return;
      const index = pool.workers.indexOf(worker);
      if (index >= 0) {
        pool.workers[index] = this.spawnWorker(signature);
      }
      this.pump(pool);
    });
    return worker;
  }

  private onMessage(
    signature: string,
    worker: WorkerProcess,
    message: WorkerMessage,
  ): void {
    const pool = this.pools.get(signature);
    const task = worker.task;
    if (!pool || !task || task.id !== message.id) return;
    worker.busy = false;
    worker.task = null;
    if (message.type == "done") {
      task.resolve();
    } else {
      task.reject(deserializeError(message.error));
    }
    this.pump(pool);
  }

  private pump(pool: SignaturePool): void {
    for (const worker of pool.workers) {
      if (worker.busy) continue;
      const task = pool.queue.shift();
      if (!task) return;
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

function buildSignature(
  modeName: string | undefined,
  featureToggles: BuildFeatureToggles,
  overrides: BuildConfigOverrides,
): string {
  return JSON.stringify({
    modeName: modeName ?? "default",
    featureToggles,
    overrides,
  });
}

function deserializeError(
  payload: Extract<WorkerMessage, { type: "error" }>["error"],
): Error {
  const error = new Error(
    typeof payload.message == "string" ? payload.message : "unknown error",
  ) as Error & Record<string, unknown>;
  error.name = typeof payload.name == "string" ? payload.name : "Error";
  if (typeof payload.stack == "string") error.stack = payload.stack;
  for (const [key, value] of Object.entries(payload)) {
    if (key == "name" || key == "message" || key == "stack") continue;
    error[key] = value;
  }
  return error;
}
