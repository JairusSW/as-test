import { readFileSync } from "fs";
import { instantiate } from "../build/sleep.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./build/sleep.spec.wasm");
const module = new WebAssembly.Module(binary);

instantiate(module, withNodeIo({}));
