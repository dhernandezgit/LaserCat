/// <reference lib="webworker" />

/** Worker de optimización: mantiene la interfaz libre mientras coloca piezas. */

import type { Doc } from "../types";
import { nestDoc } from "./store";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<{ doc: Doc }>) => {
  try {
    const result = nestDoc(event.data.doc, (value) => {
      ctx.postMessage({ type: "progress", value });
    });
    ctx.postMessage({ type: "done", doc: result.doc, nest: result.nest });
  } catch (error) {
    ctx.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "Error al optimizar.",
    });
  }
};
