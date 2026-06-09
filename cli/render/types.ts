export type SnapshotSummary = {
  matched: number;
  created: number;
  updated: number;
  failed: number;
};

export type RealtimeFailureEvent = {
  key: string;
  instr: string;
  left: string;
  right: string;
  message: string;
};

export type ProgressEvent = {
  file: string;
  depth: number;
  suiteKind: string;
  description: string;
  verdict?: string;
  time?: string;
  // Set on a file-end event replayed from the incremental cache instead of an
  // actual run, so reporters can mark it (e.g. "(cached)").
  cached?: boolean;
};

export type SnapshotMissingEvent = {
  key: string;
};

export type WarningEvent = {
  message: string;
};

export type LogEvent = {
  file: string;
  depth: number;
  text: string;
};

// A spec file's captured logs, grouped by the describe/test path they were
// emitted under. `entries[].path` is the chain of suite descriptions; `lines`
// are the individual log lines emitted at that point.
export type LogGroup = {
  file: string;
  entries: { path: string[]; lines: string[] }[];
};

export type LogSummary = {
  count: number;
  file: string | null;
  groups: LogGroup[];
  // The rendered, cross-mode-deduplicated `latest.log` body. Present once the
  // aggregated log has been written; used by `--show-logs` to print it.
  text?: string;
};

export type RunStats = {
  passedFiles: number;
  failedFiles: number;
  skippedFiles: number;
  passedSuites: number;
  failedSuites: number;
  skippedSuites: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  time: number;
  failedEntries: unknown[];
};

export type CoverageSummary = {
  enabled: boolean;
  showPoints: boolean;
  total: number;
  covered: number;
  uncovered: number;
  percent: number;
  files: {
    file: string;
    total: number;
    covered: number;
    uncovered: number;
    percent: number;
    points: {
      hash: string;
      file: string;
      line: number;
      column: number;
      type: string;
      executed: boolean;
      parentHash?: string;
      scopeKind?: string;
      scopeName?: string;
      depth?: number;
    }[];
  }[];
};

export type RunStartEvent = {
  runtimeName: string;
  clean: boolean;
  verbose: boolean;
  showLogs?: boolean;
  snapshotEnabled: boolean;
  createSnapshots: boolean;
};

export type RunCompleteEvent = {
  clean: boolean;
  snapshotEnabled: boolean;
  showCoverage: boolean;
  showCoverageAll: boolean;
  verbose: boolean;
  showLogs?: boolean;
  logSummary?: LogSummary;
  buildTime: number;
  snapshotSummary: SnapshotSummary;
  coverageSummary: CoverageSummary;
  stats: RunStats;
  reports: unknown[];
  fuzzSummary?: {
    failed: number;
    skipped: number;
    total: number;
  };
  modeSummary?: {
    failed: number;
    skipped: number;
    total: number;
  };
};

export type FuzzerRunResult = {
  name: string;
  selector?: string;
  runs: number;
  passed: number;
  failed: number;
  crashed: number;
  skipped: number;
  time: {
    start: number;
    end: number;
  };
  failure?: {
    instr: string;
    left: string;
    right: string;
    message: string;
  };
  failures?: {
    run: number;
    seed: number;
    input: unknown[] | null;
  }[];
  crashFile?: string;
};

export type FuzzResult = {
  file: string;
  target: string;
  modeName: string;
  runs: number;
  crashes: number;
  crashFiles: string[];
  seed: number;
  time: number;
  buildTime: number;
  buildStartedAt: number;
  buildFinishedAt: number;
  fuzzers: FuzzerRunResult[];
};

export type FuzzCompleteEvent = {
  results: FuzzResult[];
  time: number;
  buildTime: number;
  fuzzingSummary: {
    failed: number;
    skipped: number;
    total: number;
  };
  suiteSummary: {
    failed: number;
    skipped: number;
    total: number;
  };
  modeSummary: {
    failed: number;
    skipped: number;
    total: number;
  };
};

export type FuzzFileCompleteEvent = {
  file: string;
  results: FuzzResult[];
};

export type RenderContext = {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
};
