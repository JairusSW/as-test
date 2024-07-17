import { readFileSync } from "fs";
import { instantiate } from "../build/math.spec.js";

const binary = readFileSync("./build/math.spec.wasm");
const module = new WebAssembly.Module(binary);

const exports = instantiate(module, {});
