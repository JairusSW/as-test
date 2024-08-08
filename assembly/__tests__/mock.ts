
@external("mock", "foo")
export declare function foo(): string;

export function getFoo(): string {
  return foo();
}
