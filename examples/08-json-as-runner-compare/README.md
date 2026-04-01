# 08-json-as-runner-compare

Compares `as-test` and `as-pect` on the `json-as` test suite across `naive`, `swar`, and `simd` modes.

This example pins `json-as` to `1.3.1` and uses the package transform from `node_modules/json-as/transform`.

## Install

```bash
npm install
```

## Run The Comparison

```bash
npm test
```

## Run Individual Commands

```bash
npm run test:as-test
npm run test:aspect:naive
npm run test:aspect:swar
npm run test:aspect:simd
npm run compare
```
