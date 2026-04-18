export {};

declare module "as-test" {
  export interface IntellisenseIntegerOptions {
    min?: number;
    max?: number;
    exclude?: number[];
  }

  export interface IntellisenseFloatOptions {
    min?: number;
    max?: number;
    exclude?: number[];
  }

  export interface IntellisenseBytesOptions {
    min?: number;
    max?: number;
    include?: number[];
    exclude?: number[];
  }

  export interface IntellisenseStringOptions {
    charset?:
      | "ascii"
      | "alpha"
      | "alnum"
      | "digit"
      | "hex"
      | "base64"
      | "identifier"
      | "whitespace"
      | "custom";
    min?: number;
    max?: number;
    include?: number[];
    exclude?: number[];
    prefix?: string;
    suffix?: string;
  }

  export interface IntellisenseArrayOptions {
    min?: number;
    max?: number;
  }

  export interface FuzzSeed {
    i32(options?: IntellisenseIntegerOptions): number;
    u32(options?: IntellisenseIntegerOptions): number;
    f32(options?: IntellisenseFloatOptions): number;
    f64(options?: IntellisenseFloatOptions): number;
    bytes(options?: IntellisenseBytesOptions): Uint8Array;
    buffer(options?: IntellisenseBytesOptions): ArrayBuffer;
    string(options?: IntellisenseStringOptions): string;
    array<T>(
      item: (seed: FuzzSeed) => T,
      options?: IntellisenseArrayOptions,
    ): Array<T>;
  }
}
