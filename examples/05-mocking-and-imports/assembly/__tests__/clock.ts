@external("env", "now")
export declare function now(): i32;

export function clockLabel(prefix: string = "t="): string {
  return prefix + now().toString();
}
