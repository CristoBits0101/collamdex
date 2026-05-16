import os from "node:os";

export interface HardwareProfile {
  readonly freeRamGb: number;
  readonly totalRamGb: number;
}

export function getHardwareProfile(): HardwareProfile {
  return {
    freeRamGb: bytesToGb(os.freemem()),
    totalRamGb: bytesToGb(os.totalmem())
  };
}

export function bytesToGb(bytes: number): number {
  return Math.round((bytes / 1024 ** 3) * 100) / 100;
}
