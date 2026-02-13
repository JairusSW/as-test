// @ts-ignore
@external("env", "process.stdout.write")
declare function process_stdout_write(data: ArrayBuffer): void;

// @ts-ignore
@external("env", "process.stdin.read")
declare function process_stdin_read(max: i32): ArrayBuffer;

const MAGIC_W: u8 = 0x57; // W
const MAGIC_I: u8 = 0x49; // I
const MAGIC_P: u8 = 0x50; // P
const MAGIC_C: u8 = 0x43; // C
const HEADER_SIZE: i32 = 9;

enum MessageType {
  OPEN = 0x00,
  CLOSE = 0x01,
  CALL = 0x02,
  DATA = 0x03,
}

export class SnapshotReply {
  public ok: bool = false;
  public expected: string = "";
}

export function sendAssertionFailure(
  key: string,
  instr: string,
  left: string,
  right: string,
  message: string,
): void {
  sendJson(
    MessageType.CALL,
    `{"kind":"event:assert-fail","key":${q(key)},"instr":${q(instr)},"left":${q(left)},"right":${q(right)},"message":${q(message)}}`,
  );
}

export function sendFileStart(file: string): void {
  sendJson(
    MessageType.CALL,
    `{"kind":"event:file-start","file":${q(file)}}`,
  );
}

export function sendFileEnd(file: string, verdict: string, time: string): void {
  sendJson(
    MessageType.CALL,
    `{"kind":"event:file-end","file":${q(file)},"verdict":${q(verdict)},"time":${q(time)}}`,
  );
}

export function sendSuiteStart(
  file: string,
  depth: i32,
  kind: string,
  description: string,
): void {
  sendJson(
    MessageType.CALL,
    `{"kind":"event:suite-start","file":${q(file)},"depth":${depth.toString()},"suiteKind":${q(kind)},"description":${q(description)}}`,
  );
}

export function sendSuiteEnd(
  file: string,
  depth: i32,
  kind: string,
  description: string,
  verdict: string,
): void {
  sendJson(
    MessageType.CALL,
    `{"kind":"event:suite-end","file":${q(file)},"depth":${depth.toString()},"suiteKind":${q(kind)},"description":${q(description)},"verdict":${q(verdict)}}`,
  );
}

export function snapshotAssert(key: string, actual: string): SnapshotReply {
  sendJson(
    MessageType.CALL,
    `{"kind":"snapshot:assert","key":${q(key)},"actual":${q(actual)}}`,
  );
  const response = readFrame();
  if (response == null || response.type != MessageType.CALL) {
    return new SnapshotReply();
  }
  const body = String.UTF8.decode(response.payload);
  if (!body.length) {
    return new SnapshotReply();
  }
  const sep = body.indexOf("\n");
  if (sep < 0) return new SnapshotReply();
  const reply = new SnapshotReply();
  reply.ok = body.slice(0, sep) == "1";
  reply.expected = body.slice(sep + 1);
  return reply;
}

export function sendReport(report: string): void {
  sendFrame(MessageType.DATA, String.UTF8.encode(report));
}

function sendJson(type: MessageType, body: string): void {
  sendFrame(type, String.UTF8.encode(body));
}

function sendFrame(type: MessageType, payload: ArrayBuffer): void {
  const payloadLen = payload.byteLength;
  const out = new ArrayBuffer(HEADER_SIZE + payloadLen);
  const ptr = changetype<usize>(out);

  store<u8>(ptr, MAGIC_W, 0);
  store<u8>(ptr, MAGIC_I, 1);
  store<u8>(ptr, MAGIC_P, 2);
  store<u8>(ptr, MAGIC_C, 3);
  store<u8>(ptr, <u8>type, 4);
  store<u32>(ptr, <u32>payloadLen, 5);

  if (payloadLen) {
    memory.copy(ptr + HEADER_SIZE, changetype<usize>(payload), payloadLen);
  }

  process_stdout_write(out);
}

class Frame {
  constructor(
    public type: MessageType,
    public payload: ArrayBuffer,
  ) {}
}

function readFrame(): Frame | null {
  const header = readExact(HEADER_SIZE);
  if (header.byteLength < HEADER_SIZE) return null;
  const head = changetype<usize>(header);
  if (
    load<u8>(head, 0) != MAGIC_W ||
    load<u8>(head, 1) != MAGIC_I ||
    load<u8>(head, 2) != MAGIC_P ||
    load<u8>(head, 3) != MAGIC_C
  ) {
    return null;
  }
  const type = <MessageType>load<u8>(head, 4);
  const length = load<u32>(head, 5);
  const payload = readExact(<i32>length);
  if (payload.byteLength < <i32>length) return null;
  return new Frame(type, payload);
}

function readExact(length: i32): ArrayBuffer {
  const out = new ArrayBuffer(length);
  let offset = 0;
  while (offset < length) {
    const chunk = process_stdin_read(length - offset);
    const size = chunk.byteLength;
    if (!size) break;
    memory.copy(
      changetype<usize>(out) + offset,
      changetype<usize>(chunk),
      size,
    );
    offset += size;
  }

  if (offset == length) return out;

  const partial = new ArrayBuffer(offset);
  if (offset) {
    memory.copy(changetype<usize>(partial), changetype<usize>(out), offset);
  }
  return partial;
}

function q(value: string): string {
  return '"' + escape(value) + '"';
}

function escape(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    if (ch == 34) {
      out += '\\"';
    } else if (ch == 92) {
      out += "\\\\";
    } else if (ch == 10) {
      out += "\\n";
    } else if (ch == 13) {
      out += "\\r";
    } else if (ch == 9) {
      out += "\\t";
    } else {
      out += String.fromCharCode(ch);
    }
  }
  return out;
}
