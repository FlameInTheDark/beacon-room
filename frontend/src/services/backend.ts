import type { AppSettings, BaseStation, LayoutState, PowerResult, Room, StationPowerState } from "../types";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "../lib/layout";

const STORAGE_KEY = "beacon-room-layout-v1";

type NativeApp = {
  DiscoverBaseStations?: () => Promise<BaseStation[]>;
  LoadState?: () => Promise<LayoutState>;
  SaveRoom?: (room: Room) => Promise<void>;
  SaveLayout?: (layout: LayoutState) => Promise<void>;
  GetAppSettings?: () => Promise<AppSettings>;
  GetSerialPorts?: () => Promise<string[]>;
  SaveAppSettings?: (settings: AppSettings) => Promise<void>;
  GetApplicationVersion?: () => Promise<string>;
  RequestClose?: () => Promise<void>;
  SetStationPower?: (station: BaseStation, poweredOn: boolean) => Promise<PowerResult>;
  SetStationsPower?: (stations: BaseStation[], poweredOn: boolean) => Promise<PowerResult[]>;
  RefreshStationPowerStates?: (stations: BaseStation[]) => Promise<PowerResult[]>;
};

declare global {
  interface Window {
    go?: {
      main?: {
        App?: NativeApp;
      };
    };
  }
}

const pause = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function nativeApp(): NativeApp | undefined {
  return window.go?.main?.App;
}

let mockDiscoveryRound = 0;
const mockPowerStates = new Map<string, boolean>();

function mockPowerState(bluetoothID: string, fallback: boolean): boolean {
  if (!mockPowerStates.has(bluetoothID)) mockPowerStates.set(bluetoothID, fallback);
  return mockPowerStates.get(bluetoothID)!;
}

function mockPowerStatus(bluetoothID: string, fallback: boolean): StationPowerState {
  return mockPowerState(bluetoothID, fallback) ? "on" : "off";
}

function mockStations(): BaseStation[] {
  mockDiscoveryRound += 1;
  const stations: BaseStation[] = [
    {
      id: "bs-2e8f-a1",
      bluetoothName: "LHB-2E8FA1C4",
      bluetoothId: "D4:36:39:2E:8F:A1",
      name: "Base station A",
      poweredOn: mockPowerState("D4:36:39:2E:8F:A1", true),
      powerState: mockPowerStatus("D4:36:39:2E:8F:A1", true),
      icon: "tower",
      outlineColor: "#8b5cf6",
      coverageAngle: 160,
      coverageRotation: 0,
    },
    {
      id: "bs-904c-b7",
      bluetoothName: "LHB-904CB7D1",
      bluetoothId: "E8:31:CD:90:4C:B7",
      name: "Base station B",
      poweredOn: mockPowerState("E8:31:CD:90:4C:B7", true),
      powerState: mockPowerStatus("E8:31:CD:90:4C:B7", true),
      icon: "tower",
      outlineColor: "#22c55e",
      coverageAngle: 160,
      coverageRotation: 180,
    },
    {
      id: "bs-118a-e3",
      bluetoothName: "HTC BS 2.0-118A",
      bluetoothId: "CC:6A:10:11:8A:E3",
      name: "Base station C",
      poweredOn: mockPowerState("CC:6A:10:11:8A:E3", false),
      powerState: mockPowerStatus("CC:6A:10:11:8A:E3", false),
      icon: "radio",
      outlineColor: "#38bdf8",
      coverageAngle: 160,
      coverageRotation: 90,
    },
  ];

  if (mockDiscoveryRound > 1) {
    stations.push({
      id: "bs-7fa2-55",
      bluetoothName: "LHB-7FA25509",
      bluetoothId: "F0:92:1C:7F:A2:55",
      name: "Base station D",
      poweredOn: mockPowerState("F0:92:1C:7F:A2:55", true),
      powerState: mockPowerStatus("F0:92:1C:7F:A2:55", true),
      icon: "box",
      outlineColor: "#f59e0b",
      coverageAngle: 160,
      coverageRotation: 270,
    });
  }

  return stations;
}

export const backend = {
  async loadState(): Promise<LayoutState | null> {
    const native = nativeApp();
    if (native?.LoadState) return native.LoadState();

    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LayoutState) : null;
  },

  async saveRoom(room: Room): Promise<void> {
    const native = nativeApp();
    if (native?.SaveRoom) return native.SaveRoom(room);

    const current = await this.loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ room, stations: current?.stations ?? [], setupComplete: current?.setupComplete ?? false, snapStep: current?.snapStep ?? 0.1, settings: current?.settings ?? DEFAULT_APP_SETTINGS }));
  },

  async saveLayout(layout: LayoutState): Promise<void> {
    const native = nativeApp();
    if (native?.SaveLayout) return native.SaveLayout(layout);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  },

  async getAppSettings(): Promise<AppSettings> {
    const native = nativeApp();
    if (native?.GetAppSettings) return native.GetAppSettings();
    return normalizeAppSettings((await this.loadState())?.settings);
  },

  async getSerialPorts(): Promise<string[]> {
    const native = nativeApp();
    if (native?.GetSerialPorts) return native.GetSerialPorts();
    return [];
  },

  async saveAppSettings(settings: AppSettings): Promise<void> {
    const native = nativeApp();
    if (native?.SaveAppSettings) return native.SaveAppSettings(settings);
    const current = await this.loadState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...(current ?? {}), settings }));
  },

  async getApplicationVersion(): Promise<string> {
    const native = nativeApp();
    if (native?.GetApplicationVersion) return native.GetApplicationVersion();
    return "dev";
  },

  async requestClose(): Promise<void> {
    const native = nativeApp();
    if (native?.RequestClose) return native.RequestClose();
    window.close();
  },

  async discoverBaseStations(): Promise<BaseStation[]> {
    const native = nativeApp();
    if (native?.DiscoverBaseStations) return native.DiscoverBaseStations();
    await pause(1150);
    return mockStations();
  },

  async setStationPower(station: BaseStation, poweredOn: boolean): Promise<PowerResult> {
    const native = nativeApp();
    if (native?.SetStationPower) return native.SetStationPower(station, poweredOn);
    await pause(280);
    mockPowerStates.set(station.bluetoothId, poweredOn);
    return { bluetoothId: station.bluetoothId, powerState: poweredOn ? "on" : "off" };
  },

  async setStationsPower(stations: BaseStation[], poweredOn: boolean): Promise<PowerResult[]> {
    const native = nativeApp();
    if (native?.SetStationsPower) return native.SetStationsPower(stations, poweredOn);
    await pause(420);
    return stations.map((station) => {
      mockPowerStates.set(station.bluetoothId, poweredOn);
      return { bluetoothId: station.bluetoothId, powerState: poweredOn ? "on" : "off" };
    });
  },

  async refreshStationPowerStates(stations: BaseStation[]): Promise<PowerResult[]> {
    const native = nativeApp();
    if (native?.RefreshStationPowerStates) return native.RefreshStationPowerStates(stations);
    await pause(320);
    return stations.map((station) => ({ bluetoothId: station.bluetoothId, powerState: mockPowerState(station.bluetoothId, false) ? "on" : "off" }));
  },
};
