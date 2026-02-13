import { readFileSync } from "fs";
import { instantiate } from "../build/array.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./build/array.spec.wasm");
const module = new WebAssembly.Module(binary);

instantiate(module, withNodeIo({}));
