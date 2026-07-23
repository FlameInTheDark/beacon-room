import { useEffect, useState } from "react";
import { Box, Cpu, Pencil, Power, Radio, RadioTower, RefreshCw, ScanSearch, Triangle } from "lucide-react";
import type { BaseStation } from "../types";

type Props = {
  stations: BaseStation[];
  discovering: boolean;
  refreshingStates: boolean;
  poweringAll: boolean;
  busyStationIDs: string[];
  onDiscover: () => void;
  onRefreshStates: () => void;
  onPowerAll: (poweredOn: boolean) => void;
  onToggleStation: (station: BaseStation) => void;
  onRenameStation: (station: BaseStation) => void;
};

type ContextMenuState = {
  station: BaseStation;
  x: number;
  y: number;
};

function StationIcon({ icon }: Pick<BaseStation, "icon">) {
  const props = { size: 25, strokeWidth: 1.7 };
  switch (icon) {
    case "radio": return <Radio {...props} />;
    case "box": return <Box {...props} />;
    case "triangle": return <Triangle {...props} />;
    default: return <RadioTower {...props} />;
  }
}

function powerStateLabel(station: BaseStation): string {
  if (station.powerState === "on") return "On";
  if (station.powerState === "off") return "Off";
  if (station.powerState === "booting") return "Starting";
  return "Unknown";
}

export function StationGrid({ stations, discovering, refreshingStates, poweringAll, busyStationIDs, onDiscover, onRefreshStates, onPowerAll, onToggleStation, onRenameStation }: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("pointerdown", closeMenu);
    return () => window.removeEventListener("pointerdown", closeMenu);
  }, [contextMenu]);

  function renameFromMenu() {
    if (!contextMenu) return;
    const { station } = contextMenu;
    setContextMenu(null);
    onRenameStation(station);
  }

  return (
    <section className="station-grid-view">
      <div className="station-grid-header">
        <div>
          <h1>Base stations</h1>
        </div>
        <div className="station-grid-actions">
          <button className="button button-ghost" onClick={onRefreshStates} disabled={discovering || refreshingStates || poweringAll || stations.length === 0}>
            <RefreshCw size={16} className={refreshingStates ? "spin-icon" : undefined} />
            {refreshingStates ? "Updating…" : "Update states"}
          </button>
          <div className="bulk-power-actions"><button className="button button-primary" onClick={() => onPowerAll(true)} disabled={discovering || refreshingStates || poweringAll || stations.length === 0}><Power size={16} /> On all</button><button className="button button-ghost" onClick={() => onPowerAll(false)} disabled={discovering || refreshingStates || poweringAll || stations.length === 0}><Power size={16} /> Off all</button></div>
          <button className="button button-ghost" onClick={onDiscover} disabled={discovering || refreshingStates || poweringAll}>
            {discovering ? <span className="spinner" /> : <ScanSearch size={16} />}
            {discovering ? "Scanning…" : "Rescan base stations"}
          </button>
        </div>
      </div>

      {stations.length === 0 ? (
        <div className="station-grid-empty">
          <div><Cpu size={28} /></div>
          <strong>No base stations yet</strong>
          <p>Scan nearby SteamVR Lighthouse base stations to control them here.</p>
          <button className="button button-primary" onClick={onDiscover} disabled={discovering}>
            {discovering ? <span className="spinner" /> : <ScanSearch size={16} />}
            {discovering ? "Scanning nearby devices…" : "Scan base stations"}
          </button>
        </div>
      ) : (
        <div className="station-grid">
          {stations.map((station) => {
            const busy = busyStationIDs.includes(station.id);
            const toggleDisabled = busy || refreshingStates || station.powerState === "booting";
            return (
              <article
                className={`station-grid-card ${station.powerState}`}
                key={station.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ station, x: event.clientX, y: event.clientY });
                }}
              >
                <div className="station-grid-card-head">
                  <div className="station-grid-icon" style={{ color: station.outlineColor }}><StationIcon icon={station.icon} /></div>
                  <span className={`station-grid-state ${station.powerState}`} title={station.powerError}>
                    <span /> {powerStateLabel(station)}
                  </span>
                </div>
                <div className="station-grid-card-copy">
                  <strong>{station.name}</strong>
                  <span>{station.bluetoothName}</span>
                </div>
                <button className="station-grid-power" onClick={() => onToggleStation(station)} disabled={toggleDisabled}>
                  {busy ? <span className="spinner" /> : <Power size={16} />}
                  {station.poweredOn ? "Turn off" : "Turn on"}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {contextMenu && (
        <div className="station-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onPointerDown={(event) => event.stopPropagation()}>
          <button role="menuitem" onClick={renameFromMenu}><Pencil size={14} /> Rename station</button>
        </div>
      )}
    </section>
  );
}
