/**
 * The environment the chart adapter is executed in for tests: the same canvas
 * stub the browser harness uses, installed as globals so Chart.js sees a DOM in
 * the test realm. The chart is laid out at one fixed size, so assertions are
 * about the values the adapter derived, not about pixels.
 */
import type { ChartCanvasTarget } from "../../scripts/web/chart.ts";
import {
  computedStyle,
  context2d,
  StubMutationObserver,
  StubResizeObserver,
} from "./canvas-stub.ts";

export type ChartCanvas = ChartCanvasTarget & {
  /** The stub carries whatever a chart reads; only the members below are typed. */
  [member: string]: unknown;
  attributes: Record<string, string>;
  getAttribute(name: string): string | null;
  height: number;
  width: number;
};

/** One canvas with a parent that reports a size, as a laid-out page would. */
export function createChartCanvas(width = 800, height = 180): ChartCanvas {
  const canvas: ChartCanvas = {
    attributes: {} as Record<string, string>,
    clientHeight: height,
    clientWidth: width,
    height: 0,
    width: 0,
    isConnected: true,
    listeners: {} as Record<string, unknown[]>,
    style: {} as Record<string, string>,
    tagName: "CANVAS",
    addEventListener() {},
    dispatchEvent: () => true,
    getAttribute(name: string) {
      return (canvas.attributes as Record<string, string>)[name] ?? null;
    },
    getBoundingClientRect: () => rect(width, height),
    getContext: (type: string) => (type === "2d" ? context2d(canvas) : null),
    getRootNode: () => ({ nodeType: 9 }),
    removeAttribute(name: string) {
      delete (canvas.attributes as Record<string, string>)[name];
    },
    removeEventListener() {},
    setAttribute(name: string, value: unknown) {
      (canvas.attributes as Record<string, string>)[name] = String(value);
    },
  };
  const parent = {
    clientHeight: height,
    clientWidth: width,
    getBoundingClientRect: () => rect(width, height),
    isConnected: true,
    style: {},
  };
  canvas.parentNode = parent;
  // Chart.js reads computed styles through the element's own document view.
  const owner = (globalThis as { document?: unknown }).document;
  canvas.ownerDocument = owner;
  (parent as { ownerDocument?: unknown }).ownerDocument = owner;
  return canvas;
}

function rect(width: number, height: number): Record<string, number> {
  return {
    bottom: height,
    height,
    left: 0,
    right: width,
    top: 0,
    width,
    x: 0,
    y: 0,
  };
}

export type ChartEnvironment = {
  window: Record<string, unknown>;
  document: Record<string, unknown>;
};

/** Installs the DOM globals Chart.js checks for; returns them for reuse. */
export function installChartEnvironment(): ChartEnvironment {
  const windowStub: Record<string, unknown> = {
    addEventListener() {},
    cancelAnimationFrame() {},
    devicePixelRatio: 1,
    getComputedStyle: () => computedStyle(),
    removeEventListener() {},
  };
  const documentStub: Record<string, unknown> = {
    body: { style: {} },
    createElement: (tag: string) =>
      String(tag).toLowerCase() === "canvas"
        ? createChartCanvas()
        : { appendChild() {}, style: {} },
    documentElement: { style: {} },
    getElementById: () => null,
    querySelector: () => null,
  };
  documentStub.defaultView = windowStub;
  (globalThis as Record<string, unknown>).document = documentStub;
  (globalThis as Record<string, unknown>).window = windowStub;
  (globalThis as Record<string, unknown>).getComputedStyle = () =>
    computedStyle();
  (globalThis as Record<string, unknown>).ResizeObserver ??= StubResizeObserver;
  (globalThis as Record<string, unknown>).MutationObserver ??=
    StubMutationObserver;
  return { document: documentStub, window: windowStub };
}
