export enum MessageType {
  OPEN = 0x00,
  CLOSE = 0x01,
  CALL = 0x02,
  DATA = 0x03,
}

export class Channel {
  private static readonly MAGIC = Buffer.from("WIPC");
  private static readonly HEADER_SIZE = 9;

  private buffer = Buffer.alloc(0);

  constructor(
    private readonly input: NodeJS.ReadableStream = process.stdin,
    private readonly output: NodeJS.WritableStream = process.stdout,
  ) {
    this.input.on("data", (chunk) => this.onData(chunk as Buffer));
  }

  send(type: MessageType, payload?: Buffer): void {
    const body = payload ?? Buffer.alloc(0);

    const header = Buffer.alloc(Channel.HEADER_SIZE);
    Channel.MAGIC.copy(header, 0);
    header.writeUInt8(type, 4);
    header.writeUInt32LE(body.length, 5);

    this.output.write(Buffer.concat([header, body]));
  }

  sendJSON(type: MessageType, msg: unknown): void {
    const json = Buffer.from(JSON.stringify(msg), "utf8");
    this.send(type, json);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (true) {
      if (this.buffer.length === 0) return;

      const idx = this.buffer.indexOf(Channel.MAGIC);

      if (idx === -1) {
        this.onPassthrough(this.buffer);
        this.buffer = Buffer.alloc(0);
        return;
      }

      if (idx > 0) {
        this.onPassthrough(this.buffer.subarray(0, idx));
        this.buffer = this.buffer.subarray(idx);
      }

      if (this.buffer.length < Channel.HEADER_SIZE) return;

      const type = this.buffer.readUInt8(4);
      const length = this.buffer.readUInt32LE(5);

      const frameSize = Channel.HEADER_SIZE + length;
      if (this.buffer.length < frameSize) return;

      const payload = this.buffer.subarray(Channel.HEADER_SIZE, frameSize);
      this.buffer = this.buffer.subarray(frameSize);

      this.handleFrame(type, payload);
    }
  }

  private handleFrame(type: MessageType, payload: Buffer): void {
    switch (type) {
      case MessageType.OPEN:
        this.onOpen();
        break;
      case MessageType.CLOSE:
        this.onClose();
        break;
      case MessageType.CALL:
        this.onCall(JSON.parse(payload.toString("utf8")));
        break;
      case MessageType.DATA:
        this.onDataMessage(payload);
        break;
      default:
        throw new Error(`Unknown frame type: ${type}`);
    }
  }

  protected onPassthrough(_data: Buffer): void {}
  protected onOpen(): void {}
  protected onClose(): void {}
  protected onCall(_msg: unknown): void {}
  protected onDataMessage(_data: Buffer): void {}
}
