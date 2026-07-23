import { useEffect, useState } from "react";
import { Bluetooth, Check, X } from "lucide-react";
import type { BaseStation } from "../types";

type Props = {
  station: BaseStation | null;
  onClose: () => void;
  onSave: (stationID: string, name: string) => void;
};

export function RenameStationDialog({ station, onClose, onSave }: Props) {
  const [name, setName] = useState(station?.name ?? "");

  useEffect(() => setName(station?.name ?? ""), [station]);
  if (!station) return null;

  function saveName() {
    if (!station) return;
    const nextName = name.trim();
    if (!nextName) return;
    onSave(station.id, nextName);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <form className="dialog rename-station-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-station-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); saveName(); }}>
        <div className="dialog-header">
          <div><div className="eyebrow">Base station</div><h2 id="rename-station-title">Rename station</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="device-banner">
          <span><Bluetooth size={18} /></span>
          <div><strong>{station.bluetoothName}</strong><small>{station.bluetoothId}</small></div>
        </div>
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>
        <div className="dialog-actions">
          <button className="button button-ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="button button-primary" type="submit" disabled={!name.trim()}><Check size={16} /> Save name</button>
        </div>
      </form>
    </div>
  );
}
