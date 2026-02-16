import { readFileSync } from "fs";
import { instantiate } from "../.as-test/build/log.spec.js";
import { withNodeIo } from "./runtime.js";

const binary = readFileSync("./.as-test/build/log.spec.wasm");
const module = new WebAssembly.Module(binary);

instantiate(module, withNodeIo({}));
