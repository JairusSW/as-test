import { readFileSync } from "fs";
import { instantiate } from "../build/mock.spec.js";

const binary = readFileSync("./build/mock.spec.wasm");
const module = new WebAssembly.Module(binary);

const exports = instantiate(module, {
  "mock.spec": {},
  mock: {
    foo: () => {
      return "buz";
    },
  },
});
