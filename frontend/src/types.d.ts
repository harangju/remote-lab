declare module "bun:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect<T = unknown>(value: T): any;
}

declare module "mammoth/mammoth.browser" {
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: Array<{ message: string }> }>;
  };
  export = mammoth;
}
