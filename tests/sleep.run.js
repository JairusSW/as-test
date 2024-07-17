import { readFileSync } from "fs";
import { instantiate } from "../build/sleep.spec.js";

const binary = readFileSync("./build/sleep.spec.wasm");
const module = new WebAssembly.Module(binary);

const exports = instantiate(module, {});
