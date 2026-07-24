import { Bluetooth, Check, MapPin, Power, RefreshCw, Search, Save, Trash2 } from "lucide-react";
import type { BaseStation } from "../types";

type Props = {
  stations: BaseStation[];
  discovering: boolean;
  saving: boolean;
  placingStationId: string | null;
  onDiscover: () => void;
  onPlace: (stationId: string) => void;
  onRemove: (stationId: string) => void;
  onFinish: () => void;
};

export function StationList({ stations, discovering, saving, placingStationId, onDiscover, onPlace, onRemove, onFinish }: Props) {
  const placed = stations.filter((station) => station.position).length;

  return (
    <aside className="side-panel station-panel">
      <div className="panel-header">
        <div><div className="eyebrow">Station discovery</div><h2>Base stations</h2></div>
        <span className="count-badge">{stations.length}</span>
      </div>

      <button className="discover-button" onClick={onDiscover} disabled={discovering || saving}>
        <span className="discover-icon">{discovering ? <span className="spinner" /> : stations.length ? <RefreshCw size={18} /> : <Search size={18} />}</span>
        <span><strong>{discovering ? "Scanning nearby devices…" : stations.length ? "Discover again" : "Discover base stations"}</strong><small>{discovering ? "Scan is in progress" : "Search with the selected controller"}</small></span>
      </button>

      <div className="station-summary"><div><span>Discovered</span><strong>{stations.length}</strong></div><div><span>Placed</span><strong>{placed}</strong></div><div><span>Powered on</span><strong>{stations.filter((item) => item.powerState === "on").length}</strong></div></div>
      <div className="section-label">Nearby devices</div>

      <div className="station-list">
        {stations.length === 0 ? <div className="empty-state"><div><Bluetooth size={24} /></div><strong>No devices discovered</strong><p>Run discovery to find nearby SteamVR base stations.</p></div> : stations.map((station) => {
          const isPlacing = placingStationId === station.id;
          const statusLabel = station.powerState === "unknown" ? "Unknown" : station.powerState === "booting" ? "Starting" : station.powerState === "on" ? "On" : "Off";
          return <article className={`station-card ${isPlacing ? "placing" : ""}`} key={station.id}><div className="station-card-top"><span className={`station-status-dot ${station.powerState}`} /><div className="station-title"><strong>{station.name}</strong><span>{station.bluetoothName}</span></div><span className={`power-label ${station.powerState}`} title={station.powerError}><Power size={13} /> {statusLabel}</span></div><div className="device-id"><Bluetooth size={13} /> {station.bluetoothId}</div><div className="station-card-actions"><button className={`button station-place-button ${isPlacing ? "button-primary" : "button-ghost"}`} onClick={() => onPlace(station.id)} disabled={saving}><MapPin size={15} />{isPlacing ? "Click room to place" : station.position ? "Reposition" : "Place in room"}</button><button className="icon-button danger" onClick={() => onRemove(station.id)} disabled={saving} title="Forget this base station" aria-label={`Forget ${station.name}`}><Trash2 size={15} /></button></div></article>;
        })}
      </div>

      <div className="panel-spacer" />
      <button className="button button-primary button-large" onClick={onFinish} disabled={saving || !placed}><Save size={17} /> {saving ? "Saving…" : "Finish & save"}</button>
      {!placed && <small className="panel-action-note"><Check size={13} /> Place at least one discovered station to finish setup.</small>}
    </aside>
  );
}
