import { useEffect, useState } from "react";
import { Bell, Check, Clock3, EyeOff, Monitor, Moon, Server, Sun } from "lucide-react";
import type { AppSettings, AppTheme } from "../types";

type Props = {
  settings: AppSettings;
  version: string;
  saving: boolean;
  onSave: (settings: AppSettings) => void;
};

const themeOptions: { value: AppTheme; label: string; icon: typeof Moon }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

export function SettingsView({ settings, version, saving, onSave }: Props) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => setDraft(settings), [settings]);

  const apiURL = `http://127.0.0.1:${draft.api.port}/api/v1`;

  return (
    <main className="settings-view">
      <div className="settings-page-header">
        <div><div className="eyebrow">Application</div><h1>Settings</h1><p>Control how Beacon Room behaves in the background and how it connects with local tools.</p></div>
      </div>

      <div className="settings-grid">
        <section className="settings-section">
          <div className="settings-section-heading"><span><Monitor size={17} /></span><div><h2>Appearance</h2><p>Choose the colour mode for the application.</p></div></div>
          <div className="theme-options" role="radiogroup" aria-label="Application theme">
            {themeOptions.map((option) => {
              const Icon = option.icon;
              return <button key={option.value} className={draft.theme === option.value ? "active" : ""} role="radio" aria-checked={draft.theme === option.value} onClick={() => setDraft((current) => ({ ...current, theme: option.value }))}><Icon size={15} /> {option.label}</button>;
            })}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading"><span><EyeOff size={17} /></span><div><h2>Window behaviour</h2><p>Keep control available from the notification area.</p></div></div>
          <ToggleRow label="Hide to tray on close" description="Closing the window keeps Beacon Room running in the system tray." checked={draft.hideToTray} onChange={(hideToTray) => setDraft((current) => ({ ...current, hideToTray }))} />
        </section>

        <section className="settings-section wide">
          <div className="settings-section-heading"><span><Server size={17} /></span><div><h2>Local control API</h2><p>Expose local HTTP endpoints for station discovery, status, and power control.</p></div></div>
          <ToggleRow label="Enable local API server" description="The server is bound only to this computer (127.0.0.1)." checked={draft.api.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, api: { ...current.api, enabled } }))} />
          <div className="settings-inline-fields">
            <label className="field"><span>Port</span><input type="number" min="1" max="65535" value={draft.api.port} onChange={(event) => setDraft((current) => ({ ...current, api: { ...current.api, port: Number(event.target.value) } }))} /></label>
            <div className="api-endpoint"><span>Base URL</span><code>{apiURL}</code></div>
          </div>
          <div className="api-route-list">
            <code>GET /stations</code><code>POST /stations/discover</code><code>POST /stations/refresh</code><code>POST /stations/on · /off</code><code>POST /stations/:id/on · /off</code>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading"><span><Clock3 size={17} /></span><div><h2>Status refresh</h2><p>Check saved base stations while the app is open or hidden to tray.</p></div></div>
          <ToggleRow label="Refresh station states automatically" description="The Bluetooth adapter is used sequentially to keep commands reliable." checked={draft.statusRefresh.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, statusRefresh: { ...current.statusRefresh, enabled } }))} />
          <label className="field compact-number"><span>Interval (seconds)</span><input type="number" min="5" max="3600" value={draft.statusRefresh.intervalSeconds} disabled={!draft.statusRefresh.enabled} onChange={(event) => setDraft((current) => ({ ...current, statusRefresh: { ...current.statusRefresh, intervalSeconds: Number(event.target.value) } }))} /></label>
        </section>

        <section className="settings-section">
          <div className="settings-section-heading"><span><Bell size={17} /></span><div><h2>Notifications</h2><p>Choose which base-station events may use system notifications.</p></div></div>
          <ToggleRow label="Enable system notifications" description="Notifications are sent only when the platform makes them available." checked={draft.notifications.enabled} onChange={(enabled) => setDraft((current) => ({ ...current, notifications: { ...current.notifications, enabled } }))} />
          <div className="notification-options" aria-disabled={!draft.notifications.enabled}>
            <ToggleRow label="Station turns on or off" description="Notify when a confirmed state changes." checked={draft.notifications.stationStateChanges} disabled={!draft.notifications.enabled} onChange={(stationStateChanges) => setDraft((current) => ({ ...current, notifications: { ...current.notifications, stationStateChanges } }))} />
            <ToggleRow label="Base-station errors" description="Notify when a command or status read cannot be confirmed." checked={draft.notifications.stationErrors} disabled={!draft.notifications.enabled} onChange={(stationErrors) => setDraft((current) => ({ ...current, notifications: { ...current.notifications, stationErrors } }))} />
          </div>
        </section>
      </div>

      <div className="settings-page-footer"><span>Beacon Room <strong>v{version}</strong></span><button className="button button-primary" disabled={saving} onClick={() => onSave(draft)}>{saving ? <span className="spinner" /> : <Check size={16} />} {saving ? "Saving…" : "Save settings"}</button></div>
    </main>
  );
}

function ToggleRow({ label, description, checked, disabled = false, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`settings-toggle-row ${disabled ? "disabled" : ""}`}><span><strong>{label}</strong><small>{description}</small></span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}
