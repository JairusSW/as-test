export class CoverPoint {
  public file: string = "";
  public hash: string = "";
  public line: i32 = 0;
  public column: i32 = 0;
  public type: string = "";
  public executed: boolean = false;
}

export class Coverage {
  public all: CoverPoint[] = [];
  public allIndex: Map<string, i32> = new Map<string, i32>();
  public hashes: Map<string, CoverPoint> = new Map<string, CoverPoint>();
  public points: i32 = 0;
  static SN: Coverage = new Coverage();
}

export function __REGISTER(point: CoverPoint): void {
  if (Coverage.SN.allIndex.has(point.hash)) return;
  Coverage.SN.points++;
  Coverage.SN.allIndex.set(point.hash, Coverage.SN.all.length);
  Coverage.SN.all.push(point);
  Coverage.SN.hashes.set(point.hash, point);
}

export function __COVER(hash: string): void {
  if (Coverage.SN.allIndex.has(hash)) {
    const index = Coverage.SN.allIndex.get(hash);
    if (index < Coverage.SN.all.length) {
      unchecked(Coverage.SN.all[index]).executed = true;
    }
  }
  if (Coverage.SN.hashes.has(hash)) Coverage.SN.hashes.delete(hash);
}

export function __HASHES(): Map<string, CoverPoint> {
  return Coverage.SN.hashes;
}

export function __POINTS(): i32 {
  return Coverage.SN.points;
}

export function __UNCOVERED(): i32 {
  return Coverage.SN.hashes.size;
}

export function __ALL_POINTS(): CoverPoint[] {
  return Coverage.SN.all;
}
