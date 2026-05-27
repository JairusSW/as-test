import { expect, it } from "..";
import { foo } from "./foo";

it("should trigger re-run on modified dependent file", () => {
  expect(foo()).toBe(true);
});
