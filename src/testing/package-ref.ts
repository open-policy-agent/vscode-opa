"use strict";

export function packageRef(path: string[]): string {
  return path.reduce(
    (ref, part) => ref + (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? `.${part}` : `[${JSON.stringify(part)}]`),
    "data",
  );
}
