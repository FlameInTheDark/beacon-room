import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronRight, Cog, Download, Edit3, LayoutPanelTop, MapPin, Maximize2, Minus, MousePointer2, Plus, RadioTower, Ruler, Save, ScanSearch, Trash2, X } from "lucide-react";
import type { AppSettings, BaseStation, EditorStage, InteriorShape, LayoutState, PowerResult, Room, UpdateAvailability } from "./types";
import { DEFAULT_SNAP_STEP, normalizeAngle, normalizeSnapStep, roomCentroid } from "./lib/geometry";
import { DEFAULT_APP_SETTINGS, EMPTY_ROOM, normalizeAppSettings, normalizeLayout } from "./lib/layout";
import { applyPowerResults, powerResultFailed } from "./lib/power";
import { backend } from "./services/backend";
import { RoomCanvas } from "./components/RoomCanvas";
import { StationList } from "./components/StationList";
import { EditStationDialog } from "./components/EditStationDialog";
import { StationGrid } from "./components/StationGrid";
import { RenameStationDialog } from "./components/RenameStationDialog";
import { SettingsView } from "./components/SettingsView";
import { BrowserOpenURL, EventsOn, WindowMinimise, WindowToggleMaximise } from "../wailsjs/runtime/runtime";

type Toast = { message: string; kind: "success" | "error" };
type AppMode = "list" | "layout" | "settings";

const bootingRefreshLimit = 24;
const bootingRefreshInterval = 5_000;
const frontendOperationTimeout = 60_000;

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

function withTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), frontendOperationTimeout);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

function defaultStationRotation(station: BaseStation, room: Room): number {
  if (!station.position) return 0;
  const center = roomCentroid(room.points);
  return normalizeAngle(Math.atan2(center.y - station.position.y, center.x - station.position.x) * (180 / Math.PI));
}

export default function App() {
  const [mode, setMode] = useState<AppMode>("list");
  const [stage, setStage] = useState<EditorStage>("room");
  const [room, setRoom] = useState<Room>(EMPTY_ROOM);
  const [stations, setStations] = useState<BaseStation[]>([]);
  const [setupComplete, setSetupComplete] = useState(false);
  const [snapStep, setSnapStep] = useState(DEFAULT_SNAP_STEP);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [serialPorts, setSerialPorts] = useState<string[]>([]);
  const [serialPortsLoading, setSerialPortsLoading] = useState(false);
  const [appVersion, setAppVersion] = useState("dev");
  const [availableUpdate, setAvailableUpdate] = useState<UpdateAvailability | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [drawingShape, setDrawingShape] = useState(false);
  const [placingStationId, setPlacingStationId] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyStationIds, setBusyStationIds] = useState<string[]>([]);
  const [poweringAll, setPoweringAll] = useState(false);
  const [refreshingStates, setRefreshingStates] = useState(false);
  const [editingStation, setEditingStation] = useState<BaseStation | null>(null);
  const [renamingStation, setRenamingStation] = useState<BaseStation | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [loaded, setLoaded] = useState(false);
  const bootingRefreshAttempts = useRef(new Map<string, number>());

  const selectedPoint = useMemo(() => room.points.find((point) => point.id === selectedPointId), [room.points, selectedPointId]);
  const selectedShape = useMemo(() => room.shapes.find((shape) => shape.id === selectedShapeId), [room.shapes, selectedShapeId]);
  const placedStations = useMemo(() => stations.filter((station) => station.position), [stations]);

  const showToast = useCallback((message: string, kind: Toast["kind"] = "success") => {
    setToast({ message, kind });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const refreshSerialPorts = useCallback(async () => {
    setSerialPortsLoading(true);
    try {
      setSerialPorts(await backend.getSerialPorts());
    } catch (error) {
      console.error(error);
      showToast(errorMessage(error, "Could not list serial ports"), "error");
    } finally {
      setSerialPortsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    const preventNativeContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", preventNativeContextMenu);
    return () => window.removeEventListener("contextmenu", preventNativeContextMenu);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const saved = normalizeLayout(await backend.loadState());
        setRoom(saved.room);
        setStations(saved.stations);
        setSetupComplete(saved.setupComplete);
        setSnapStep(saved.snapStep);
        setSettings(saved.settings);
        if (saved.setupComplete) setStage("overview");
        else if (saved.room.closed) setStage("stations");
      } catch (error) {
        console.error("Unable to load saved layout", error);
        showToast("Could not load the saved layout", "error");
      } finally {
        setLoaded(true);
      }
    })();
  }, [showToast]);

  useEffect(() => {
    void backend.getApplicationVersion().then(setAppVersion, () => setAppVersion("dev"));
  }, []);

  useEffect(() => {
    void backend.getUpdateAvailability().then((update) => {
      if (update.available) setAvailableUpdate(update);
    });
    if (!("runtime" in window)) return undefined;
    return EventsOn("update-available", (update: UpdateAvailability) => setAvailableUpdate(update));
  }, []);

  useEffect(() => {
    if (mode !== "settings") return;
    void refreshSerialPorts();
  }, [mode, refreshSerialPorts]);

  useEffect(() => {
    if (!("runtime" in window)) return undefined;
    return EventsOn("station-power-results", (results: PowerResult[]) => {
      setStations((current) => applyPowerResults(current, results));
    });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = settings.theme === "system" ? media.matches ? "light" : "dark" : settings.theme;
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [settings.theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT") return;
      if ((event.key === "Delete" || event.key === "Backspace") && stage === "room" && selectedPointId) {
        event.preventDefault();
        deleteSelectedPoint();
      }
      if (event.key === "Escape") {
        setPlacingStationId(null);
        setSelectedPointId(null);
        setSelectedShapeId(null);
        setDrawingShape(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function layoutWith(nextStations = stations, complete = setupComplete, nextSnapStep = snapStep): LayoutState {
    return { room, stations: nextStations, setupComplete: complete, snapStep: nextSnapStep, settings };
  }

  async function saveAppSettings(nextSettings: AppSettings) {
    const normalizedSettings = normalizeAppSettings(nextSettings);
    setSettingsSaving(true);
    try {
      await backend.saveAppSettings(normalizedSettings);
      setSettings(normalizedSettings);
      showToast("Application settings saved.");
    } catch (error) {
      console.error(error);
      showToast(errorMessage(error, "Could not save application settings"), "error");
    } finally {
      setSettingsSaving(false);
    }
  }

  function changeSnapStep(nextStep: number) {
    const normalized = normalizeSnapStep(nextStep);
    if (normalized === snapStep) return;
    const previous = snapStep;
    setSnapStep(normalized);
    void backend.saveLayout(layoutWith(stations, setupComplete, normalized)).catch((error) => {
      console.error(error);
      setSnapStep(previous);
      showToast("Could not save the snap setting", "error");
    });
  }

  function deleteSelectedPoint() {
    if (!selectedPointId) return;
    const points = room.points.filter((point) => point.id !== selectedPointId);
    setRoom({ ...room, points, closed: room.closed && points.length >= 3 });
    setSelectedPointId(null);
  }

  function clearRoom() {
    setRoom({ ...room, points: [], shapes: [], closed: false });
    setStations((current) => current.map((station) => ({ ...station, position: undefined })));
    setSetupComplete(false);
    setSelectedPointId(null);
    setSelectedShapeId(null);
    setDrawingShape(false);
    setPlacingStationId(null);
  }

  async function saveRoomAndContinue() {
    if (!room.closed || room.points.length < 3) return;
    setSaving(true);
    try {
      await backend.saveRoom(room);
      setStage("stations");
      showToast("Room saved. Discover your base stations next.");
    } catch (error) {
      console.error(error);
      showToast("Unable to save the room", "error");
    } finally {
      setSaving(false);
    }
  }

  async function finishSetup() {
    if (!room.closed || placedStations.length === 0) return;
    setSaving(true);
    try {
      await backend.saveLayout(layoutWith(stations, true));
      setSetupComplete(true);
      setStage("overview");
      setDrawingShape(false);
      setPlacingStationId(null);
      showToast("Room setup complete.");
    } catch (error) {
      console.error(error);
      showToast("Unable to save the room layout", "error");
    } finally {
      setSaving(false);
    }
  }

  async function discoverStations() {
    setDiscovering(true);
    try {
      const discovered = await withTimeout(backend.discoverBaseStations(), "Base-station scan timed out. Check the selected controller and try again.");
      setStations((current) => {
        const currentById = new Map(current.map((station) => [station.id, station]));
        const currentByBluetoothName = new Map(current.map((station) => [station.bluetoothName, station]));
        const merged = discovered.map((station) => {
          const existing = currentById.get(station.id) ?? currentByBluetoothName.get(station.bluetoothName);
          if (!existing) return station;
          return {
            ...station,
            id: existing.id,
            name: existing.name,
            position: existing.position,
            poweredOn: station.powerState === "unknown" ? existing.poweredOn : station.poweredOn,
            icon: existing.icon,
            outlineColor: existing.outlineColor,
            coverageAngle: existing.coverageAngle,
            coverageRotation: existing.coverageRotation,
          };
        });
        const discoveredIds = new Set(merged.map((station) => station.id));
        return [...merged, ...current.filter((station) => !discoveredIds.has(station.id))];
      });
      showToast(`${discovered.length} nearby base stations found.`);
    } catch (error) {
      console.error(error);
      showToast(errorMessage(error, "Base-station discovery failed"), "error");
    } finally {
      setDiscovering(false);
    }
  }

  async function removeStation(stationID: string) {
    const station = stations.find((item) => item.id === stationID);
    if (!station || saving) return;

    const nextStations = stations.filter((item) => item.id !== stationID);
    setSaving(true);
    setStations(nextStations);
    setPlacingStationId((current) => current === stationID ? null : current);
    try {
      await backend.saveLayout(layoutWith(nextStations));
      showToast(`${station.name} removed from this layout.`);
    } catch (error) {
      console.error(error);
      setStations(stations);
      showToast(`Could not remove ${station.name}`, "error");
    } finally {
      setSaving(false);
    }
  }

  function updateEditedStation(updated: BaseStation) {
    const nextStations = stations.map((station) => station.id === updated.id ? updated : station);
    setStations(nextStations);
    setEditingStation(null);
    void backend.saveLayout(layoutWith(nextStations)).catch((error) => {
      console.error(error);
      showToast("Base-station changes could not be saved", "error");
    });
    showToast("Base-station appearance and coverage updated.");
  }

  function renameStation(stationID: string, name: string) {
    const nextName = name.trim();
    if (!nextName) return;
    const nextStations = stations.map((station) => station.id === stationID ? { ...station, name: nextName } : station);
    setStations(nextStations);
    setRenamingStation(null);
    void backend.saveLayout(layoutWith(nextStations)).then(
      () => showToast(`${nextName} renamed.`),
      (error) => {
        console.error(error);
        setStations(stations);
        showToast("Could not save the base-station name", "error");
      },
    );
  }

  function openStage(next: EditorStage) {
    if (next === "stations" && !room.closed) return;
    setStage(next);
    setSelectedPointId(null);
    setSelectedShapeId(null);
    setDrawingShape(false);
    setPlacingStationId(null);
  }

  function updateSelectedShape(updater: (shape: InteriorShape) => InteriorShape) {
    if (!selectedShapeId) return;
    setRoom((current) => ({ ...current, shapes: current.shapes.map((shape) => shape.id === selectedShapeId ? updater(shape) : shape) }));
  }

  function deleteSelectedShape() {
    if (!selectedShapeId) return;
    setRoom((current) => ({ ...current, shapes: current.shapes.filter((shape) => shape.id !== selectedShapeId) }));
    setSelectedShapeId(null);
  }

  async function persistPower(nextStations: BaseStation[]) {
    try {
      await backend.saveLayout(layoutWith(nextStations));
    } catch (error) {
      console.error(error);
      showToast("Power changed, but the updated layout could not be saved", "error");
    }
  }

  async function toggleStation(station: BaseStation) {
    if (busyStationIds.includes(station.id) || poweringAll || refreshingStates) return;
    if (station.powerState === "booting") {
      showToast(`${station.name} is still starting.`, "error");
      return;
    }
    setBusyStationIds((current) => [...current, station.id]);
    try {
      const result = await withTimeout(backend.setStationPower(station, !station.poweredOn), `Power request for ${station.name} timed out. Restart the app before trying again.`);
      if (result.error || result.powerState === "unknown") {
        const nextStations = applyPowerResults(stations, [result]);
        setStations(nextStations);
        await persistPower(nextStations);
        showToast(result.error || `Could not confirm ${station.name}'s power state`, "error");
        return;
      }
      const nextStations = applyPowerResults(stations, [result]);
      setStations(nextStations);
      await persistPower(nextStations);
      if (result.powerState === "booting") {
        bootingRefreshAttempts.current.set(station.id, 0);
        showToast(`${station.name} is starting.`, "success");
      }
    } catch (error) {
      console.error(error);
      showToast(errorMessage(error, `Could not change ${station.name}'s power`), "error");
    } finally {
      setBusyStationIds((current) => current.filter((id) => id !== station.id));
    }
  }

  async function powerAll(poweredOn: boolean) {
    if (poweringAll || refreshingStates || stations.length === 0) return;
    setPoweringAll(true);
    try {
      const results = await withTimeout(backend.setStationsPower(stations, poweredOn), "Base-station power request timed out. Restart the app before trying again.");
      const nextStations = applyPowerResults(stations, results);
      const failed = results.filter(powerResultFailed).length;
      const booting = results.filter((result) => result.powerState === "booting").length;
      setStations(nextStations);
      await persistPower(nextStations);
      for (const station of nextStations) {
        if (station.powerState === "booting") bootingRefreshAttempts.current.set(station.id, 0);
      }
      const message = failed
        ? `${results.length - failed} stations updated; ${failed} could not be confirmed.`
        : poweredOn && booting
          ? `${booting} ${booting === 1 ? "station is" : "stations are"} starting.`
          : `All stations turned ${poweredOn ? "on" : "off"}.`;
      showToast(message, failed ? "error" : "success");
    } catch (error) {
      console.error(error);
      showToast(errorMessage(error, "Could not update all base stations"), "error");
    } finally {
      setPoweringAll(false);
    }
  }

  async function refreshStationStates(showFeedback = true) {
    if (refreshingStates || poweringAll || stations.length === 0) return;
    setRefreshingStates(true);
    try {
      const results = await withTimeout(backend.refreshStationPowerStates(stations), "State update timed out. Restart the app before trying again.");
      const nextStations = applyPowerResults(stations, results);
      const failed = results.filter(powerResultFailed).length;
      setStations(nextStations);
      await persistPower(nextStations);
      if (showFeedback) {
        showToast(failed ? `${results.length - failed} states refreshed; ${failed} could not be confirmed.` : "All base-station states refreshed.", failed ? "error" : "success");
      }
    } catch (error) {
      console.error(error);
      if (showFeedback) showToast(errorMessage(error, "Could not refresh base-station states"), "error");
    } finally {
      setRefreshingStates(false);
    }
  }

  useEffect(() => {
    const bootingStations = stations.filter((station) => station.powerState === "booting");
    const bootingIDs = new Set(bootingStations.map((station) => station.id));
    for (const stationID of bootingRefreshAttempts.current.keys()) {
      if (!bootingIDs.has(stationID)) bootingRefreshAttempts.current.delete(stationID);
    }
    const stationsToRefresh = bootingStations.filter((station) => (bootingRefreshAttempts.current.get(station.id) ?? 0) < bootingRefreshLimit);
    if (!loaded || stationsToRefresh.length === 0 || poweringAll || refreshingStates) return undefined;

    const refreshTimer = window.setTimeout(() => {
      for (const station of stationsToRefresh) {
        bootingRefreshAttempts.current.set(station.id, (bootingRefreshAttempts.current.get(station.id) ?? 0) + 1);
      }
      void refreshStationStates(false);
    }, bootingRefreshInterval);
    return () => window.clearTimeout(refreshTimer);
  }, [loaded, poweringAll, refreshingStates, stations]);

  if (!loaded) return <div className="loading-screen"><div className="app-mark"><RadioTower size={24} /></div><span className="spinner large" /><strong>Loading room layout</strong></div>;

  const needsInitialSetup = stations.length === 0 && !room.closed;
  const layoutActions = stage === "overview"
    ? <><button className="button button-ghost" onClick={() => openStage("room")}><Edit3 size={16} /> Edit room</button><button className="button button-primary" onClick={() => openStage("stations")}><MapPin size={16} /> Edit base stations</button></>
    : stage === "stations"
      ? <button className="button button-ghost" onClick={finishSetup} disabled={saving || !placedStations.length}><Save size={17} /> {saving ? "Saving…" : "Finish & save"}</button>
      : null;

  return (
    <div className={`app-shell app-mode-${mode} ${mode === "layout" && stage === "overview" ? "overview-shell" : ""}`}>
      <header className="custom-titlebar">
        {mode === "settings" ? <nav className="mode-switcher" aria-label="Settings navigation"><button className="settings-back-button" onClick={() => setMode("list")}><ArrowLeft size={15} /> Back</button></nav> : <nav className="mode-switcher" aria-label="Application view">
          <button className={mode === "list" ? "active" : ""} onClick={() => setMode("list")}><RadioTower size={15} /> List</button>
          <button className={mode === "layout" ? "active" : ""} onClick={() => { setMode("layout"); if (stage === "overview" && !setupComplete) openStage(room.closed ? "stations" : "room"); }}><LayoutPanelTop size={15} /> Layout</button>
        </nav>}
        <div className="titlebar-caption" onDoubleClick={WindowToggleMaximise}>Beacon Room</div>
        <div className="window-controls" aria-label="Window controls">
          {availableUpdate?.available && <button className="update-available-button" onClick={() => BrowserOpenURL(availableUpdate.url)} title={`Open Beacon Room ${availableUpdate.version} release`}><Download size={14} /> New version available</button>}
          <button className={mode === "settings" ? "active" : ""} onClick={() => setMode("settings")} title="Settings" aria-label="Settings"><Cog size={16} /></button>
          <button onClick={WindowMinimise} title="Hide" aria-label="Hide"><Minus size={16} /></button>
          <button onClick={WindowToggleMaximise} title="Maximise or restore" aria-label="Maximise or restore"><Maximize2 size={14} /></button>
          <button className="window-close" onClick={() => void backend.requestClose()} title="Close" aria-label="Close"><X size={16} /></button>
        </div>
      </header>

      {mode === "settings" && <SettingsView settings={settings} version={appVersion} saving={settingsSaving} serialPorts={serialPorts} serialPortsLoading={serialPortsLoading} onRefreshSerialPorts={refreshSerialPorts} onSave={saveAppSettings} />}

      {mode === "list" && (needsInitialSetup ? (
        <main className="initial-setup-view">
          <div className="initial-setup-card">
            <div className="eyebrow">SteamVR room planner</div>
            <h1>Start your setup</h1>
            <p>Scan your nearby base stations, build a room layout, or do both in any order.</p>
            <div className="initial-setup-actions">
              <button className="button button-primary button-large" onClick={() => void discoverStations()} disabled={discovering}>
                {discovering ? <span className="spinner" /> : <ScanSearch size={17} />}
                {discovering ? "Scanning…" : "Scan base stations"}
              </button>
              <button className="button button-ghost button-large" onClick={() => { setMode("layout"); openStage("room"); }}>
                <LayoutPanelTop size={17} /> Create room layout
              </button>
            </div>
          </div>
        </main>
      ) : (
        <main className="list-workspace">
          <StationGrid
            stations={stations}
            discovering={discovering}
            refreshingStates={refreshingStates}
            poweringAll={poweringAll}
            busyStationIDs={busyStationIds}
            onDiscover={discoverStations}
            onRefreshStates={refreshStationStates}
            onPowerAll={powerAll}
            onToggleStation={toggleStation}
            onRenameStation={setRenamingStation}
          />
        </main>
      ))}

      {mode === "layout" && <>
        <div className="layout-subbar">
          {stage !== "overview" && <nav className="stage-switcher" aria-label="Layout setup stages">
            <button className={stage === "room" ? "active" : ""} onClick={() => openStage("room")}><span>1</span> Room setup</button>
            <ChevronRight size={15} />
            <button className={stage === "stations" ? "active" : ""} onClick={() => openStage("stations")} disabled={!room.closed}><span>2</span> Base stations</button>
          </nav>}
          <div className="header-actions">{layoutActions}</div>
        </div>
        <div className="workspace">
          <main className="canvas-column">
            <RoomCanvas
              stage={stage}
              room={room}
              stations={stations}
              snapStep={snapStep}
              placingStationId={placingStationId}
              selectedPointId={selectedPointId}
              selectedShapeId={selectedShapeId}
              drawingShape={drawingShape}
              busyStationIds={busyStationIds}
              poweringAll={poweringAll}
              refreshingStates={refreshingStates}
              onRoomChange={setRoom}
              onStationsChange={setStations}
              onSelectPoint={setSelectedPointId}
              onSelectShape={setSelectedShapeId}
              onShapeDrawingChange={setDrawingShape}
              onPlacementComplete={() => setPlacingStationId(null)}
              onEditStation={setEditingStation}
              onToggleStation={toggleStation}
              onPowerAll={powerAll}
              onRefreshStates={refreshStationStates}
              onSnapStepChange={changeSnapStep}
            />
          </main>

          {stage === "room" ? <aside className="side-panel room-panel">
            <div className="panel-header">
              <div><div className="eyebrow">Room layout</div><h2>Create your room</h2></div>
              <span className={`completion-ring ${room.closed ? "complete" : ""}`}>{room.closed ? <Check size={16} /> : room.points.length}</span>
            </div>
            <label className="field room-name-field"><span>Room name</span><input value={room.name} onChange={(event) => setRoom({ ...room, name: event.target.value })} placeholder="My VR room" /></label>
            <div className="setup-checklist">
              <div className={room.points.length > 0 ? "done" : ""}><span><MousePointer2 size={17} /></span><div><strong>Add wall points</strong><small>Click anywhere on the grid.</small></div>{room.points.length > 0 && <Check size={16} />}</div>
              <div className={room.points.length >= 3 ? "done" : ""}><span><Ruler size={17} /></span><div><strong>Define the boundary</strong><small>At least three points are required.</small></div>{room.points.length >= 3 && <Check size={16} />}</div>
              <div className={room.closed ? "done" : ""}><span><Check size={17} /></span><div><strong>Close the room</strong><small>Click the first point to fill the polygon.</small></div>{room.closed && <Check size={16} />}</div>
            </div>
            <div className="room-metrics"><div><span>Wall points</span><strong>{room.points.length}</strong></div><div><span>Interior objects</span><strong>{room.shapes.length}</strong></div></div>
            {selectedPoint && <div className="selection-card"><div><span>Selected corner</span><strong>{selectedPoint.x.toFixed(2)} × {selectedPoint.y.toFixed(2)} m</strong></div><button className="icon-button danger" onClick={deleteSelectedPoint} title="Delete selected point"><Trash2 size={17} /></button></div>}
            {room.closed && <section className="shape-editor">
              <div className="section-heading"><div><span className="eyebrow">Room interior</span><strong>Objects & occlusion</strong></div><button className={`button ${drawingShape ? "button-primary" : "button-ghost"}`} onClick={() => { setDrawingShape((current) => !current); setSelectedShapeId(null); }}><Plus size={15} /> {drawingShape ? "Cancel drawing" : "Add object"}</button></div>
              {selectedShape ? <div className="shape-selection-card">
                <label className="field"><span>Object name</span><input value={selectedShape.name} onChange={(event) => updateSelectedShape((shape) => ({ ...shape, name: event.target.value }))} /></label>
                <label className="tall-switch"><input type="checkbox" checked={selectedShape.isTall} onChange={(event) => updateSelectedShape((shape) => ({ ...shape, isTall: event.target.checked }))} /><span><strong>Tall object</strong><small>Cast a coverage shadow from this item.</small></span></label>
                <button className="button button-ghost danger-text" onClick={deleteSelectedShape}><Trash2 size={15} /> Delete object</button>
              </div> : <p className="shape-empty-copy">{drawingShape ? "Click inside the room, away from walls · Click its first corner to finish" : "Add furniture and obstacles. Mark tall items to visualise coverage shadows."}</p>}
            </section>}
            <div className="panel-spacer" />
            <div className="panel-actions-stack">
              <button className="button button-ghost" onClick={clearRoom} disabled={room.points.length === 0}><Trash2 size={16} /> Clear room</button>
              <button className="button button-primary button-large" disabled={!room.closed || saving} onClick={saveRoomAndContinue}><Save size={17} /> {saving ? "Saving…" : "Save room & continue"}</button>
              {!room.closed && <small>Finish and close the polygon before continuing.</small>}
            </div>
          </aside> : stage === "stations" ? <StationList stations={stations} discovering={discovering} saving={saving} placingStationId={placingStationId} onDiscover={discoverStations} onPlace={(stationId) => setPlacingStationId((current) => current === stationId ? null : stationId)} onRemove={removeStation} onFinish={finishSetup} /> : null}
        </div>
        {stage !== "overview" && <footer className="status-bar"><div><span className="status-indicator" /> Ready</div><div>{room.name} · {room.points.length} corners · {placedStations.length}/{stations.length} stations placed</div><div>Esc cancels placement or drawing</div></footer>}
      </>}

      <EditStationDialog station={editingStation} defaultRotation={editingStation ? defaultStationRotation(editingStation, room) : 0} onClose={() => setEditingStation(null)} onSave={updateEditedStation} />
      <RenameStationDialog station={renamingStation} onClose={() => setRenamingStation(null)} onSave={renameStation} />
      {toast && <div className={`toast ${toast.kind}`}><Check size={16} /> {toast.message}</div>}
    </div>
  );
}
