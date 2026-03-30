export type CliFeatureToggles = {
  coverage?: boolean;
  tryAs?: boolean;
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
  verbose: boolean;
  jobs: number;
  buildJobs: number;
  runJobs: number;
  coverage?: boolean;
  browser?: string;
  reporterPath?: string;
};
