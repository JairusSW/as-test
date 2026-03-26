import { quote } from "../util/json";

import { sendLog } from "../util/wipc";

export class Log {
  public order: i32 = 0;
  public depth: i32 = 0;
  public file: string = "unknown";
  public text: string;
  constructor(text: string) {
    this.text = text;
  }
  display(): void {
    sendLog(this.file, this.depth, this.text);
  }

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
