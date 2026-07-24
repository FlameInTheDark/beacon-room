export type Point = {
  id: string;
  x: number;
  y: number;
};

export type InteriorShape = {
  id: string;
  name: string;
  points: Point[];
  isTall: boolean;
};

export type Room = {
  id: string;
  name: string;
  points: Point[];
  closed: boolean;
  shapes: InteriorShape[];
};

export type StationIcon = "tower" | "radio" | "box" | "triangle";
export type StationPowerState = "on" | "off" | "booting" | "unknown";

export type BaseStation = {
  id: string;
  bluetoothName: string;
  bluetoothId: string;
  name: string;
  position?: Point;
  poweredOn: boolean;
  powerState: StationPowerState;
  powerError?: string;
  icon: StationIcon;
  outlineColor: string;
  coverageAngle: number;
  coverageRotation: number;
};

export type AppTheme = "dark" | "light" | "system";

export type APISettings = {
  enabled: boolean;
  port: number;
};

export type NotificationSettings = {
  enabled: boolean;
  stationStateChanges: boolean;
  stationErrors: boolean;
};

export type StatusRefreshSettings = {
	enabled: boolean;
	intervalSeconds: number;
};

export type StationControlMode = "bluetooth" | "dongle";

export type StationControlSettings = {
	mode: StationControlMode;
	donglePort: string;
};

export type AppSettings = {
  hideToTray: boolean;
  api: APISettings;
  theme: AppTheme;
	notifications: NotificationSettings;
	statusRefresh: StatusRefreshSettings;
	stationControl: StationControlSettings;
};

export type LayoutState = {
  room: Room;
  stations: BaseStation[];
  setupComplete: boolean;
  snapStep: number;
  settings: AppSettings;
};

export type PowerResult = {
  bluetoothId: string;
  resolvedBluetoothId?: string;
  powerState: StationPowerState;
  error?: string;
};

export type EditorStage = "room" | "stations" | "overview";
