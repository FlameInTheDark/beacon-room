import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Bluetooth, Box, Check, Radio, RadioTower, RotateCcw, Triangle, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BaseStation, StationIcon } from "../types";
import { DEFAULT_COVERAGE_ANGLE, normalizeAngle } from "../lib/geometry";

const ICONS: { id: StationIcon; label: string; icon: LucideIcon }[] = [
  { id: "tower", label: "Tower", icon: RadioTower },
  { id: "radio", label: "Radio", icon: Radio },
  { id: "box", label: "Box", icon: Box },
  { id: "triangle", label: "Triangle", icon: Triangle },
];

const COLORS = ["#8b5cf6", "#22c55e", "#38bdf8", "#f59e0b", "#f43f5e", "#e5e7eb"];

type Props = {
  station: BaseStation | null;
  defaultRotation: number;
  onClose: () => void;
  onSave: (station: BaseStation) => void;
};

function boundedNumber(raw: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function EditStationDialog({ station, defaultRotation, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<BaseStation | null>(station);

  useEffect(() => setDraft(station), [station]);
  if (!station || !draft) return null;

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-station-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <div className="eyebrow">Device & coverage</div>
            <h2 id="edit-station-title">Edit base station</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="device-banner">
          <span><Bluetooth size={18} /></span>
          <div><strong>{station.bluetoothName}</strong><small>{station.bluetoothId}</small></div>
        </div>

        <label className="field">
          <span>Display name</span>
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} autoFocus />
        </label>

        <fieldset className="choice-field">
          <legend>Map icon</legend>
          <div className="icon-choices">
            {ICONS.map((choice) => {
              const Icon = choice.icon;
              return (
                <button type="button" key={choice.id} className={draft.icon === choice.id ? "selected" : ""} onClick={() => setDraft({ ...draft, icon: choice.id })}>
                  <Icon size={21} />
                  <span>{choice.label}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="choice-field coverage-fields">
          <legend>Coverage cone</legend>
          <div className="coverage-note">SteamVR 2.0 reference: 160° horizontal × 115° vertical, 7 m range.</div>
          <div className="coverage-inputs">
            <label className="field"><span>Aperture (°)</span><input type="number" min="1" max="360" value={draft.coverageAngle} onChange={(event) => setDraft({ ...draft, coverageAngle: boundedNumber(event.target.value, draft.coverageAngle, 1, 360) })} /></label>
            <label className="field"><span>Rotation (°)</span><input type="number" min="0" max="359.9" step="1" value={draft.coverageRotation} onChange={(event) => setDraft({ ...draft, coverageRotation: normalizeAngle(boundedNumber(event.target.value, draft.coverageRotation, 0, 359.9)) })} /></label>
          </div>
          <button className="button button-ghost coverage-reset" type="button" onClick={() => setDraft({ ...draft, coverageAngle: DEFAULT_COVERAGE_ANGLE, coverageRotation: defaultRotation })}>
            <RotateCcw size={15} /> Reset to 160°
          </button>
        </fieldset>

        <fieldset className="choice-field">
          <legend>Outline color</legend>
          <div className="color-choices">
            {COLORS.map((color) => (
              <button type="button" aria-label={`Use ${color}`} key={color} className={draft.outlineColor === color ? "selected" : ""} style={{ "--choice-color": color } as CSSProperties} onClick={() => setDraft({ ...draft, outlineColor: color })}>
                {draft.outlineColor === color && <Check size={13} />}
              </button>
            ))}
            <label className="custom-color" title="Custom color">
              <input type="color" value={draft.outlineColor} onChange={(event) => setDraft({ ...draft, outlineColor: event.target.value })} />
              <span>+</span>
            </label>
          </div>
        </fieldset>

        <div className="dialog-actions">
          <button className="button button-ghost" onClick={onClose}>Cancel</button>
          <button className="button button-primary" onClick={() => onSave({ ...draft, coverageRotation: normalizeAngle(draft.coverageRotation) })} disabled={!draft.name.trim()}>
            <Check size={16} /> Save changes
          </button>
        </div>
      </section>
    </div>
  );
}
