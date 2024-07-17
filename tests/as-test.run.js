
import { readFileSync } from "fs";
const file_name = "sleep.spec.js"
const { instantiate } = await import(`../build/${file_name}`);

const binary = readFileSync(`./build/${file_name}`);
const module = new WebAssembly.Module(binary);

const exports = instantiate(module, {});