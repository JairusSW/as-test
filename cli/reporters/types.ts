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
  updateSnapshots: boolean;
};

export type RunCompleteEvent = {
  clean: boolean;
  snapshotEnabled: boolean;
  showCoverage: boolean;
  snapshotSummary: SnapshotSummary;
  coverageSummary: CoverageSummary;
  stats: RunStats;
  reports: unknown[];
  modeSummary?: {
    failed: number;
    skipped: number;
    total: number;
  };
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
  onRunComplete?(event: RunCompleteEvent): void;
}

export type ReporterFactory = (context: ReporterContext) => TestReporter;
