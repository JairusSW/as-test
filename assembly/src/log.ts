import { quote } from "../util/json";

export class Log {
  public order: i32 = 0;
  public depth: i32 = 0;
  public text: string;
  constructor(text: string) {
    this.text = text;
  }
  display(): void {}

  serialize(): string {
    return (
      '{"order":' +
      this.order.toString() +
      ',"depth":' +
      this.depth.toString() +
      ',"text":' +
      quote(this.text) +
      "}"
    );
  }
}
