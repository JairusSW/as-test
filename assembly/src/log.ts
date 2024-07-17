import { rainbow } from "as-rainbow";
import { term } from "../util/term";

@json
export class Log {
    public order: i32 = 0;
    public depth: i32 = 0;
    public text: string;
    constructor(text: string) {
        this.text = text;
    }
    display(): void {
        term.write("  ".repeat(this.depth + 1) + `${rainbow.bgBlackBright(" LOG ")}${rainbow.dimMk(":")} ${this.text}\n`);
    }
}