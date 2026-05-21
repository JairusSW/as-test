export class CoverPoint {
  public file: string = "";
  public hash: string = "";
  public line: i32 = 0;
  public column: i32 = 0;
  public type: string = "";
  public parentHash: string = "";
  public scopeKind: string = "";
  public scopeName: string = "";
  public depth: i32 = 0;
  public executed: boolean = false;
}

export class Coverage {
  public all: CoverPoint[] = [];
  public byHash: Map<string, CoverPoint> = new Map<string, CoverPoint>();
  public uncovered: i32 = 0;
  static SN: Coverage = new Coverage();
}

export function __REGISTER(point: CoverPoint): void {
  const cov = Coverage.SN;
  if (cov.byHash.has(point.hash)) return;
  cov.byHash.set(point.hash, point);
  cov.all.push(point);
  cov.uncovered++;
}

export function __REGISTER_RAW(
  file: string,
  hash: string,
  line: i32,
  column: i32,
  type: string,
  parentHash: string = "",
  scopeKind: string = "",
  scopeName: string = "",
  depth: i32 = 0,
): void {
  const cov = Coverage.SN;
  if (cov.byHash.has(hash)) return;
  const point = new CoverPoint();
  point.file = file;
  point.hash = hash;
  point.line = line;
  point.column = column;
  point.type = type;
  point.parentHash = parentHash;
  point.scopeKind = scopeKind;
  point.scopeName = scopeName;
  point.depth = depth;
  cov.byHash.set(hash, point);
  cov.all.push(point);
  cov.uncovered++;
}

// Hot path: invoked at every instrumented point. After first hit, subsequent
// hits short-circuit on `executed` before any writes.
export function __COVER(hash: string): void {
  const cov = Coverage.SN;
  if (!cov.byHash.has(hash)) return;
  const point = cov.byHash.get(hash);
  if (point.executed) return;
  point.executed = true;
  cov.uncovered--;
}

export function __POINTS(): i32 {
  return Coverage.SN.all.length;
}

export function __UNCOVERED(): i32 {
  return Coverage.SN.uncovered;
}

export function __ALL_POINTS(): CoverPoint[] {
  return Coverage.SN.all;
}
