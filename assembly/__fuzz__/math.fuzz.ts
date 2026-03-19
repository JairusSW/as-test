export function fuzz(data: Uint8Array): void {
  let sum: u32 = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }

  if (data.length >= 4) {
    const left = <u32>data[0] + <u32>data[1];
    const right = <u32>data[2] + <u32>data[3];
    if (left + right != sum && data.length == 4) {
      unreachable();
    }
  }
}
