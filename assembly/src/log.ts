
@json
export class Log {
  public order: i32 = 0;
  public depth: i32 = 0;
  public text: string;
  constructor(text: string) {
    this.text = text;
  }
  display(): void {}
}
