export enum MessageType {
  OPEN = 0x00,
  CLOSE = 0x01,
  CALL = 0x02,
  DATA = 0x03,
}

export class Channel {
  private static readonly MAGIC = Buffer.from("WIPC");
  private static readonly HEADER_SIZE = 9;
  private static readonly MAGIC_PREFIX_MAX = Channel.MAGIC.length - 1;
  // Upper bound on a single frame's declared payload length. Real frames are
  // small JSON events or report chunks (<= 64 KiB); anything larger means the
  // 4 magic bytes appeared by coincidence inside passthrough output. Without
  // this bound a forged length would make us buffer (and swallow real frames)
  // indefinitely. The margin over 64 KiB future-proofs larger report chunks.
  private static readonly MAX_FRAME_SIZE = 16 * 1024 * 1024;

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
        const keep = Math.min(this.buffer.length, Channel.MAGIC_PREFIX_MAX);
        const flushLength = this.buffer.length - keep;
        if (flushLength > 0) {
          this.onPassthrough(this.buffer.subarray(0, flushLength));
          this.buffer = this.buffer.subarray(flushLength);
        }
        return;
      }

      if (idx > 0) {
        this.onPassthrough(this.buffer.subarray(0, idx));
        this.buffer = this.buffer.subarray(idx);
      }

      if (this.buffer.length < Channel.HEADER_SIZE) return;

      const type = this.buffer.readUInt8(4);
      const length = this.buffer.readUInt32LE(5);

      // The magic can occur by chance inside ordinary stdout output (e.g. a
      // test printing binary data or the literal string "WIPC"). A genuine
      // frame always carries a known type and a bounded length; if either
      // check fails the match is coincidental, so surface the magic bytes as
      // passthrough and resume scanning past them rather than crash or stall.
      if (!Channel.isKnownType(type) || length > Channel.MAX_FRAME_SIZE) {
        this.resyncPastMagic();
        continue;
      }

      const frameSize = Channel.HEADER_SIZE + length;
      if (this.buffer.length < frameSize) return;

      const payload = this.buffer.subarray(Channel.HEADER_SIZE, frameSize);

      if (type === MessageType.CALL) {
        // CALL payloads are always JSON. If the bytes do not parse the magic
        // was coincidental — do NOT consume the frame; treat the magic as
        // output and resync so the rest flushes as passthrough.
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload.toString("utf8"));
        } catch {
          this.resyncPastMagic();
          continue;
        }
        this.buffer = this.buffer.subarray(frameSize);
        this.onCall(parsed);
        continue;
      }

      this.buffer = this.buffer.subarray(frameSize);
      this.dispatchFrame(type, payload);
    }
  }

  private static isKnownType(type: number): boolean {
    return (
      type === MessageType.OPEN ||
      type === MessageType.CLOSE ||
      type === MessageType.CALL ||
      type === MessageType.DATA
    );
  }

  // A coincidental magic match: emit the magic bytes as ordinary output and
  // advance past them so scanning can continue from the next byte.
  private resyncPastMagic(): void {
    this.onPassthrough(this.buffer.subarray(0, Channel.MAGIC.length));
    this.buffer = this.buffer.subarray(Channel.MAGIC.length);
  }

  private dispatchFrame(type: MessageType, payload: Buffer): void {
    switch (type) {
      case MessageType.OPEN:
        this.onOpen();
        break;
      case MessageType.CLOSE:
        this.onClose();
        break;
      case MessageType.DATA:
        this.onDataMessage(payload);
        break;
    }
  }

  protected onPassthrough(_data: Buffer): void {}
  protected onOpen(): void {}
  protected onClose(): void {}
  protected onCall(_msg: unknown): void {}
  protected onDataMessage(_data: Buffer): void {}
}
