import { escape, stringify } from "./stringify";

export class Tests {
  public order: i32 = 0;
  public type: string = "";
  public verdict: string = "none";
  public left: string = "null";
  public right: string = "null";
  public instr: string = "";
  public message: string = "";
  public location: string = "";

  toJSON(): string {
    return (
      '{"order":' +
      this.order.toString() +
      ',"type":' +
      escape(this.type) +
      ',"verdict":' +
      escape(this.verdict) +
      ',"left":' +
      (this.left.length ? this.left : "null") +
      ',"right":' +
      (this.right.length ? this.right : "null") +
      ',"instr":' +
      escape(this.instr) +
      ',"message":' +
      escape(this.message) +
      ',"location":' +
      escape(this.location) +
      "}"
    );
  }
}
