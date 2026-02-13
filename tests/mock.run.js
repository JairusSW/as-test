import { readFileSync } from "fs";
import { instantiate } from "../.as-test/build/mock.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./.as-test/build/mock.spec.wasm");
const module = new WebAssembly.Module(binary);

instantiate(
  module,
  withNodeIo({
    "mock.spec": {},
    mock: {
      foo: () => {
        return "buz";
      },
    },
  }),
);
