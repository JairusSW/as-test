import { existsSync, readFileSync } from "fs";
import { Config } from "./types.js";
import chalk from "chalk";
import { delimiter, join } from "path";
export function formatTime(ms) {
  if (ms < 0) {
    throw new Error("Time should be a non-negative number.");
  }
  // Convert milliseconds to microseconds
  const us = ms * 1000;
  const units = [
    { name: "μs", divisor: 1 },
    { name: "ms", divisor: 1000 },
    { name: "s", divisor: 1000 * 1000 },
    { name: "m", divisor: 60 * 1000 * 1000 },
    { name: "h", divisor: 60 * 60 * 1000 * 1000 },
    { name: "d", divisor: 24 * 60 * 60 * 1000 * 1000 },
  ];
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i];
    if (us >= unit.divisor) {
      const value = Math.round((us / unit.divisor) * 1000) / 1000;
      return `${value}${unit.name}`;
    }
  }
  return `${us}us`;
}
export function loadConfig(CONFIG_PATH, warn = false) {
  if (!existsSync(CONFIG_PATH)) {
    if (warn)
      console.log(
        `${chalk.bgMagentaBright(" WARN ")}${chalk.dim(":")} Could not locate config file in the current directory! Continuing with default config.`,
      );
    return new Config();
  } else {
    return Object.assign(
      new Config(),
      JSON.parse(readFileSync(CONFIG_PATH).toString()),
    );
  }
}
export function getExec(exec) {
  const PATH = process.env.PATH.split(delimiter);
  for (const pathDir of PATH) {
    const fullPath = join(
      pathDir,
      exec + (process.platform === "win32" ? ".exe" : ""),
    );
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }
  return null;
}
