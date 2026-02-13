import { readFileSync } from "fs";
import { instantiate } from "../build/expectation.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./build/expectation.spec.wasm");
const module = new WebAssembly.Module(binary);

instantiate(module, withNodeIo({}));
