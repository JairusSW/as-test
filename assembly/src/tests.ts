import { JSON } from "json-as/assembly";

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
      JSON.stringify<string>(this.type) +
      ',"verdict":' +
      JSON.stringify<string>(this.verdict) +
      ',"left":' +
      (this.left.length ? this.left : "null") +
      ',"right":' +
      (this.right.length ? this.right : "null") +
      ',"instr":' +
      JSON.stringify<string>(this.instr) +
      ',"message":' +
      JSON.stringify<string>(this.message) +
      ',"location":' +
      JSON.stringify<string>(this.location) +
      "}"
    );
  }
}
