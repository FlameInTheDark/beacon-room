import type { AppSettings, BaseStation, LayoutState, Point, Room, StationPowerState } from "../types";
import { DEFAULT_COVERAGE_ANGLE, DEFAULT_SNAP_STEP, normalizeAngle, normalizeSnapStep, roomCentroid } from "./geometry";

export const EMPTY_ROOM: Room = {
  id: "room-default",
  name: "My VR room",
  points: [],
  closed: false,
  shapes: [],
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  hideToTray: false,
  api: { enabled: false, port: 7575 },
  theme: "dark",
  notifications: { enabled: false, stationStateChanges: true, stationErrors: true },
  statusRefresh: { enabled: false, intervalSeconds: 60 },
};

type PersistedLayout = {
  room?: Partial<Room>;
  stations?: Array<Partial<BaseStation>>;
  setupComplete?: boolean;
  snapStep?: number;
  settings?: Partial<AppSettings>;
};

export function createEmptyLayout(): LayoutState {
  return { room: EMPTY_ROOM, stations: [], setupComplete: false, snapStep: DEFAULT_SNAP_STEP, settings: DEFAULT_APP_SETTINGS };
}

export function normalizeAppSettings(settings: Partial<AppSettings> | undefined): AppSettings {
  const theme = settings?.theme === "light" || settings?.theme === "system" || settings?.theme === "dark" ? settings.theme : DEFAULT_APP_SETTINGS.theme;
  const port = Number(settings?.api?.port);
  const intervalSeconds = Number(settings?.statusRefresh?.intervalSeconds);
  return {
    hideToTray: Boolean(settings?.hideToTray),
    api: { enabled: Boolean(settings?.api?.enabled), port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_APP_SETTINGS.api.port },
    theme,
    notifications: {
      enabled: Boolean(settings?.notifications?.enabled),
      stationStateChanges: settings?.notifications?.stationStateChanges ?? DEFAULT_APP_SETTINGS.notifications.stationStateChanges,
      stationErrors: settings?.notifications?.stationErrors ?? DEFAULT_APP_SETTINGS.notifications.stationErrors,
    },
    statusRefresh: {
      enabled: Boolean(settings?.statusRefresh?.enabled),
      intervalSeconds: Number.isInteger(intervalSeconds) && intervalSeconds >= 5 && intervalSeconds <= 3600 ? intervalSeconds : DEFAULT_APP_SETTINGS.statusRefresh.intervalSeconds,
    },
  };
}

function defaultRotation(position: Point | undefined, room: Room): number {
  if (!position || room.points.length < 3) return 0;
  const center = roomCentroid(room.points);
  return normalizeAngle(Math.atan2(center.y - position.y, center.x - position.x) * (180 / Math.PI));
}

export function normalizeStation(station: Partial<BaseStation>, room: Room): BaseStation {
  const legacyIcon = station.icon as string | undefined;
  const icon = legacyIcon === "lighthouse"
    ? "tower"
    : legacyIcon === "beacon"
      ? "radio"
      : legacyIcon === "radio" || legacyIcon === "box" || legacyIcon === "triangle" || legacyIcon === "tower"
        ? legacyIcon
        : "tower";
  const storedPowerState = station.powerState as StationPowerState | undefined;
  const powerState = storedPowerState === "on" || storedPowerState === "off" || storedPowerState === "booting" || storedPowerState === "unknown"
    ? storedPowerState
    : station.poweredOn ? "on" : "off";

  return {
    id: station.id ?? crypto.randomUUID(),
    bluetoothName: station.bluetoothName ?? "Unknown base station",
    bluetoothId: station.bluetoothId ?? "",
    name: station.name ?? station.bluetoothName ?? "Base station",
    position: station.position,
    poweredOn: Boolean(station.poweredOn),
    powerState,
    powerError: station.powerError,
    icon,
    outlineColor: station.outlineColor ?? "#8b5cf6",
    coverageAngle: Math.min(360, Math.max(1, station.coverageAngle ?? DEFAULT_COVERAGE_ANGLE)),
    coverageRotation: normalizeAngle(station.coverageRotation ?? defaultRotation(station.position, room)),
  };
}

export function normalizeLayout(state: PersistedLayout | null | undefined): LayoutState {
  const room: Room = {
    ...EMPTY_ROOM,
    ...state?.room,
    points: state?.room?.points ?? [],
    shapes: state?.room?.shapes ?? [],
  };
  return {
    room,
    stations: (state?.stations ?? []).map((station) => normalizeStation(station, room)),
    setupComplete: Boolean(state?.setupComplete),
    snapStep: normalizeSnapStep(state?.snapStep),
    settings: normalizeAppSettings(state?.settings),
  };
}
