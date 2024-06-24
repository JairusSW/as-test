export class CoverPoint {
    public file: string = "";
    public hash: string = "";
    public line: i32 = 0;
    public column: i32 = 0;
    public type!: string;
    public executed: boolean = false;
}

export class Coverage {
    public hashes: Map<string, CoverPoint> = new Map<string, CoverPoint>();
    public points: i32 = 0;
    static SN: Coverage = new Coverage();
}

export function __REGISTER(point: CoverPoint): void {
    Coverage.SN.points++;
    Coverage.SN.hashes.set(point.hash, point);
}

export function __COVER(hash: string): void {
    if (Coverage.SN.hashes.has(hash)) Coverage.SN.hashes.delete(hash);
}

export function __HASHES(): Map<string, CoverPoint> {
    return Coverage.SN.hashes;
}

export function __POINTS(): i32 {
    return Coverage.SN.points;
}