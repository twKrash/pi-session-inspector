/**
 * The canvas the browser tests run against: a deterministic 2D context whose
 * drawing calls are no-ops and whose `measureText` returns a fixed width, plus
 * the two observers a chart library binds to. Tests assert chart *state* — the
 * labels, ticks, points, and tooltips the shipped bundle computed — rather than
 * pixels, and the same stub keeps those assertions stable across runs.
 */

export type StubContext2d = {
  canvas: unknown;
  measureText(text: unknown): { width: number };
  [key: string]: unknown;
};

/** One 2D context, remembered per canvas so repeated reads are the same object. */
const contexts = new WeakMap<object, StubContext2d>();

export function context2d(canvas: object): StubContext2d {
  const remembered = contexts.get(canvas);
  if (remembered !== undefined) return remembered;
  const gradient = { addColorStop() {} };
  const base: Record<string, unknown> = {
    canvas,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
    createLinearGradient: () => gradient,
    createPattern: () => null,
    createRadialGradient: () => gradient,
    getImageData: () => ({ data: [] }),
    getLineDash: () => [],
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
    measureText: (text: unknown) => ({
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      width: String(text).length * 6,
    }),
    putImageData: () => {},
    setLineDash: () => {},
  };
  const context = new Proxy(base, {
    get: (target, property: string | symbol) =>
      property in target
        ? (target as Record<string | symbol, unknown>)[property]
        : () => {},
    set: (target, property: string | symbol, value) => {
      (target as Record<string | symbol, unknown>)[property] = value;
      return true;
    },
  }) as StubContext2d;
  contexts.set(canvas, context);
  return context;
}

/** `getComputedStyle`: nothing is styled, so every property reads empty. */
export function computedStyle(): Record<string, unknown> {
  const style: Record<string, unknown> = { getPropertyValue: () => "" };
  return new Proxy(style, {
    get: (target, property: string | symbol) =>
      property in target
        ? (target as Record<string | symbol, unknown>)[property]
        : "",
    set: (target, property: string | symbol, value) => {
      (target as Record<string | symbol, unknown>)[property] = value;
      return true;
    },
  });
}

/** Responsive binding constructs one; it never needs to fire in a test. */
export class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Detach binding constructs one; it never needs to fire in a test. */
export class StubMutationObserver {
  observe(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}
