import { rainbow } from "as-rainbow";

export class Result {
    public name: string;
    public arg1: i32;
    public arg2: i32;
    constructor(name: string, arg1: i32, arg2: i32) {
        this.name = name;
        this.arg1 = arg1;
        this.arg2 = arg2;
    }
    display(): string {
        let out = "";
        out += `${rainbow.boldMk(this.name)} `;
        if (this.arg1) {
            out += `${rainbow.boldMk(rainbow.red(this.arg1.toString() + " " + "failed"))}`;
        } else {
            out += `${rainbow.boldMk(rainbow.green("0 failed"))}`;
        }
        out += `, ${this.arg1 + this.arg2} total\n`;
        return out;
    }
}