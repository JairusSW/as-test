import { readFileSync } from "fs";
import { instantiate } from "../build/mock.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./build/mock.spec.wasm");
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
