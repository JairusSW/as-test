export var MessageType;
(function (MessageType) {
    MessageType[MessageType["OPEN"] = 0] = "OPEN";
    MessageType[MessageType["CLOSE"] = 1] = "CLOSE";
    MessageType[MessageType["CALL"] = 2] = "CALL";
    MessageType[MessageType["DATA"] = 3] = "DATA";
})(MessageType || (MessageType = {}));
export class Channel {
    constructor(input = process.stdin, output = process.stdout) {
        this.input = input;
        this.output = output;
        this.buffer = Buffer.alloc(0);
        this.input.on("data", (chunk) => this.onData(chunk));
    }
    send(type, payload) {
        const body = payload ?? Buffer.alloc(0);
        const header = Buffer.alloc(Channel.HEADER_SIZE);
        Channel.MAGIC.copy(header, 0);
        header.writeUInt8(type, 4);
        header.writeUInt32LE(body.length, 5);
        this.output.write(Buffer.concat([header, body]));
    }
    sendJSON(type, msg) {
        const json = Buffer.from(JSON.stringify(msg), "utf8");
        this.send(type, json);
    }
    onData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            if (this.buffer.length === 0)
                return;
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
            if (this.buffer.length < Channel.HEADER_SIZE)
                return;
            const type = this.buffer.readUInt8(4);
            const length = this.buffer.readUInt32LE(5);
            const frameSize = Channel.HEADER_SIZE + length;
            if (this.buffer.length < frameSize)
                return;
            const payload = this.buffer.subarray(Channel.HEADER_SIZE, frameSize);
            this.buffer = this.buffer.subarray(frameSize);
            this.handleFrame(type, payload);
        }
    }
    handleFrame(type, payload) {
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
    onPassthrough(_data) { }
    onOpen() { }
    onClose() { }
    onCall(_msg) { }
    onDataMessage(_data) { }
}
Channel.MAGIC = Buffer.from("WIPC");
Channel.HEADER_SIZE = 9;
