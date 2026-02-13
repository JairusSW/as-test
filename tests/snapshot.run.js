import { readFileSync } from "fs";
import { instantiate } from "../build/snapshot.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./build/snapshot.spec.wasm");
const module = new WebAssembly.Module(binary);

instantiate(module, withNodeIo({}));
