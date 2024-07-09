declare namespace __AdaptedExports {
  /** Exported memory */
  export const memory: WebAssembly.Memory;
}
/** Instantiates the compiled WebAssembly module with the given imports. */
export declare function instantiate(module: WebAssembly.Module, imports: {
  env: unknown,
}): Promise<typeof __AdaptedExports>;
