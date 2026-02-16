import fs from "fs";

let patched = false;

function readExact(length) {
  const out = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    let read = 0;
    try {
      read = fs.readSync(0, out, offset, length - offset, null);
    } catch (error) {
      if (error && error.code === "EAGAIN") {
        continue;
      }
      throw error;
    }
    if (!read) break;
    offset += read;
  }
  const view = out.subarray(0, offset);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function writeRaw(data) {
  const view = Buffer.from(data);
  fs.writeSync(1, view);
}

function patchNodeIo() {
  if (patched) return;
  patched = true;

  const originalWrite = process.stdout.write.bind(process.stdout);
   
  process.stdout.write = (chunk, ...args) => {
    if (chunk instanceof ArrayBuffer) {
      writeRaw(chunk);
      return true;
    }
    return originalWrite(chunk, ...args);
  };

   
  process.stdin.read = (size) => readExact(Number(size ?? 0));
}

export function withNodeIo(imports = {}) {
  patchNodeIo();
  return imports;
}
