export class TermLine {
    public start: i32 = 0;
    public end: i32 = 0;
    constructor(start: i32 = 0, end: i32 = 0) {
        this.start = start;
        this.end = end;
    }
    edit(data: string): TermLine {
        let end = this.end;
        while (--end >= this.start) {
            term.clearLn(end);
        }
        process.stdout.write(data);
        term.resetCursor();
        return new TermLine(this.end);
    }
    clear(): void {
        term.clearLn(this.start);
    }
}

export namespace term {
    export let lines: i32 = 0;
    export function write(data: string): TermLine {
        const start = term.lines;
        for (let i = 0; i < data.length; i++) {
            const code = data.charCodeAt(i);
            if (code === 10) term.lines++;
        }
        process.stdout.write(data);
        return new TermLine(start, term.lines);
    }
    export function clearLn(line: i32): void {
        process.stdout.write(`\u001B[${term.lines - line}A`);
        process.stdout.write("\x1B[2K");
        process.stdout.write("\x1B[0G");
    }
    export function resetCursor(): void {
        process.stdout.write("\x1B[999B");
        process.stdout.write("\x1B[0G");
    }
}