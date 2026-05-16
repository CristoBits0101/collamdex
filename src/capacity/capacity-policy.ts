import type { CollamdexConfig } from "../config/extension-config.js";
import type { OllamaModel } from "../ollama/ollama-types.js";
import { getHardwareProfile } from "./hardware-profiler.js";
import { estimateModelCapacity, type ModelCapacityEstimate } from "./model-capacity-estimator.js";

export type CapacityStatus = "blocked" | "recommended" | "warning";

export interface CapacityDecision {
  readonly allowedGb: number;
  readonly estimate: ModelCapacityEstimate;
  readonly message: string;
  readonly status: CapacityStatus;
}

export class CapacityPolicy {
  public constructor(private readonly getConfig: () => CollamdexConfig) {}

  public evaluate(model: OllamaModel): CapacityDecision {
    const profile = getHardwareProfile();
    const config = this.getConfig();
    const estimate = estimateModelCapacity(model);
    const allowedGb = Math.round(profile.totalRamGb * config.maxSystemRamRatio * 100) / 100;

    if (estimate.estimatedFootprintGb > allowedGb) {
      return {
        allowedGb,
        estimate,
        message: `Bloqueado por defecto: estimado ${estimate.estimatedFootprintGb.toFixed(2)} GB, presupuesto ${allowedGb.toFixed(2)} GB.`,
        status: "blocked"
      };
    }

    if (estimate.estimatedFootprintGb > allowedGb * 0.8) {
      return {
        allowedGb,
        estimate,
        message: `Permitido con aviso: estimado ${estimate.estimatedFootprintGb.toFixed(2)} GB, presupuesto ${allowedGb.toFixed(2)} GB.`,
        status: "warning"
      };
    }

    return {
      allowedGb,
      estimate,
      message: `Recomendado: estimado ${estimate.estimatedFootprintGb.toFixed(2)} GB, presupuesto ${allowedGb.toFixed(2)} GB.`,
      status: "recommended"
    };
  }
}
