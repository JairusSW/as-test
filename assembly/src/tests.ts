import { quote, rawOrNull } from "../util/json";

export class Tests {
  public order: i32 = 0;
  public type: string = "";
  public verdict: string = "none";
  public left: string = "null";
  public right: string = "null";
  public instr: string = "";
  public message: string = "";
  public location: string = "";

  serialize(): string {
    return (
      '{"order":' +
      this.order.toString() +
      ',"type":' +
      quote(this.type) +
      ',"verdict":' +
      quote(this.verdict) +
      ',"left":' +
      rawOrNull(this.left) +
      ',"right":' +
      rawOrNull(this.right) +
      ',"instr":' +
      quote(this.instr) +
      ',"message":' +
      quote(this.message) +
      ',"location":' +
      quote(this.location) +
      "}"
    );
  }
}
