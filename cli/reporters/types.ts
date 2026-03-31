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
    }[];
  }[];
};

export type RunStartEvent = {
  runtimeName: string;
  clean: boolean;
  verbose: boolean;
  snapshotEnabled: boolean;
  createSnapshots: boolean;
};

export type RunCompleteEvent = {
  clean: boolean;
  snapshotEnabled: boolean;
  showCoverage: boolean;
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

export type ReporterContext = {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
};

export interface TestReporter {
  onRunStart?(event: RunStartEvent): void;
  onFileStart?(event: ProgressEvent): void;
  onFileEnd?(event: ProgressEvent): void;
  onSuiteStart?(event: ProgressEvent): void;
  onSuiteEnd?(event: ProgressEvent): void;
  onAssertionFail?(event: RealtimeFailureEvent): void;
  onSnapshotMissing?(event: SnapshotMissingEvent): void;
  onWarning?(event: WarningEvent): void;
  onLog?(event: LogEvent): void;
  onRunComplete?(event: RunCompleteEvent): void;
  onFuzzFileComplete?(event: FuzzFileCompleteEvent): void;
  onFuzzComplete?(event: FuzzCompleteEvent): void;
  flush?(): void;
}

export type ReporterFactory = (context: ReporterContext) => TestReporter;
