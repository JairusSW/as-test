export class Log {
    private line: i32 = 0;
    constructor(line: i32 = 0) {
        this.line = line;
    }
    edit(data: string): Log {
        term.clearLn(this.line);
        process.stdout.write(data);
        process.stdout.write("\x1B[999B");
        process.stdout.write("\x1B[0G");
        return new Log(this.line);
    }
}

export namespace term {
    export let lines: i32 = 0;
    export function write(data: string): Log {
        process.stdout.write(data);
        return new Log(term.lines++);
    }
    export function writeLn(data: string): void {
        for (let i = 0; i < data.length; i++) {
            const code = data.charCodeAt(i);
            if (code === 10) term.lines++;
        }
        term.lines++;
        process.stdout.write(data + "\n");
    }
    export function clearLn(line: i32): void {
        process.stdout.write(`\u001B[${term.lines - line}A`);
        process.stdout.write("\x1B[2K");
        process.stdout.write("\x1B[0G");
    }
    export function editLn(data: string, ln: i32): void {
        process.stdout.write(`\u001B[${ln}A`);
        process.stdout.write("\x1B[2K");
        process.stdout.write("\x1B[0G");
        term.writeLn(data);
    }
}