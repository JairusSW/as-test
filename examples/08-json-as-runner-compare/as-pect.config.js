export default {
  entries: ["assembly/__tests__/as-pect/**/*.spec.ts"],
  include: ["assembly/__tests__/**/*.include.ts"],
  disclude: [/node_modules/],
  async instantiate(memory, createImports, instantiate, binary) {
    const myImports = { env: { memory } };
    return instantiate(binary, createImports(myImports));
  },
  outputBinary: false,
};
