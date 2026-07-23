import type { BaseStation, PowerResult } from "../types";

export function applyPowerResults(stations: BaseStation[], results: PowerResult[]): BaseStation[] {
  const byBluetoothID = new Map(results.map((result) => [result.bluetoothId, result]));
  return stations.map((station) => {
    const result = byBluetoothID.get(station.bluetoothId);
    if (!result) return station;
    if (result.error || result.powerState === "unknown") return { ...station, powerState: "unknown", powerError: result.error };
    return {
      ...station,
      bluetoothId: result.resolvedBluetoothId ?? station.bluetoothId,
      poweredOn: result.powerState === "on",
      powerState: result.powerState,
      powerError: undefined,
    };
  });
}

export function powerResultFailed(result: PowerResult): boolean {
  return Boolean(result.error) || result.powerState === "unknown";
}
