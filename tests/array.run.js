import { readFileSync } from "fs";
import { instantiate } from "../build/array.spec.js";

const binary = readFileSync("./build/array.spec.wasm");
const module = new WebAssembly.Module(binary);

const exports = instantiate(module, {});
