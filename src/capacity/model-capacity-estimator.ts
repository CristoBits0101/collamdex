import type { OllamaModel } from "../ollama/ollama-types.js";
import { bytesToGb } from "./hardware-profiler.js";

export interface ModelCapacityEstimate {
  readonly contextReserveGb: number;
  readonly diskSizeGb: number;
  readonly estimatedFootprintGb: number;
  readonly parameterSizeB: number | null;
}

export function estimateModelCapacity(model: OllamaModel): ModelCapacityEstimate {
  const parameterSizeB = parseParameterSizeB(model.details?.parameter_size);
  const diskSizeGb = bytesToGb(model.size);
  const contextReserveGb = getContextReserveGb(parameterSizeB);

  return {
    contextReserveGb,
    diskSizeGb,
    estimatedFootprintGb: roundGb(diskSizeGb * 1.35 + contextReserveGb),
    parameterSizeB
  };
}

export function formatBytes(bytes: number): string {
  const gb = bytesToGb(bytes);
  return `${gb.toFixed(2)} GB`;
}

function parseParameterSizeB(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const match = /^(\d+(?:\.\d+)?)\s*b$/.exec(normalized);

  if (!match?.[1]) {
    return null;
  }

  return Number(match[1]);
}

function getContextReserveGb(parameterSizeB: number | null): number {
  if (parameterSizeB === null || parameterSizeB <= 8) {
    return 1;
  }

  if (parameterSizeB <= 14) {
    return 2;
  }

  if (parameterSizeB <= 34) {
    return 4;
  }

  return 8;
}

function roundGb(value: number): number {
  return Math.round(value * 100) / 100;
}
