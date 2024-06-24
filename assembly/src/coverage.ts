export namespace __COVERTYPES {
    export const Function = "Function";
    export const Expression = "Expression";
    export const Block = "Block";
}

export class __COVERPOINT {
    public file: string = "";
    public hash: string = "";
    public line: i32 = 0;
    public column: i32 = 0;
    public type!: string;
    public executed: boolean = false;
}

export class __COVERAGE {
    public hashs: Map<string, __COVERPOINT> = new Map<string, __COVERPOINT>();
    public points: i32 = 0;
    static SN: __COVERAGE | null = null;
    static init(): __COVERAGE {
        if (!__COVERAGE.SN) {
            __COVERAGE.SN = new __COVERAGE();
        }
        return __COVERAGE.SN!;
    }
}

export function __COVERAGE_STATS(): __COVERAGE {
    return __COVERAGE.init();
}

export function __REGISTER(point: __COVERPOINT): void {
    __COVERAGE.init().points++;
    __COVERAGE.init().hashs.set(point.hash, point);
}

export function __COVER(hash: string): void {
    __COVERAGE.init().hashs.delete(hash);
}