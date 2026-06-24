export type CliFeatureToggles = {
  coverage?: boolean;
  featureOverrides: Record<string, boolean>;
};

export type CliListFlags = {
  list: boolean;
  listModes: boolean;
};

export type RunFlags = {
  snapshot: boolean;
  createSnapshots: boolean;
  overwriteSnapshots: boolean;
  clean: boolean;
  showCoverage: boolean;
  showCoverageAll: boolean;
  verbose: boolean;
  showLogs?: boolean;
  jobs: number;
  buildJobs: number;
  runJobs: number;
  coverage?: boolean;
  tryAs?: boolean;
  browser?: string;
  watch?: boolean;
  cache?: boolean;
  noCache?: boolean;
  changed?: boolean;
};
