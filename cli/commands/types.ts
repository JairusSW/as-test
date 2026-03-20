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
  updateSnapshots: boolean;
  clean: boolean;
  showCoverage: boolean;
  verbose: boolean;
  coverage?: boolean;
  browser?: string;
};
