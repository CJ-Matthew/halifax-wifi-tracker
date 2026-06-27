import { useState } from 'react';

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const colour = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * colour).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex) {
  let r = parseInt(hex.slice(1, 3), 16) / 255;
  let g = parseInt(hex.slice(3, 5), 16) / 255;
  let b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function clampColour(hex) {
  let [h, s, l] = hexToHsl(hex);
  s = Math.max(40, s);
  l = Math.max(30, Math.min(70, l));
  return hslToHex(h, s, l);
}

function shade(hex, f) {
  const n = parseInt((hex || '#4D96FF').slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function PicoCatPreview({ colour, name }) {
  const D = shade(colour, 0.45);
  const L = shade(colour, 1.22);
  return (
    <div className="cat-preview-wrapper">
      <div className="cat-preview-nametag">{name || '???'}</div>
      <svg width="56" height="66" viewBox="0 0 44 52" shapeRendering="crispEdges">
        <rect x="7" y="8" width="9" height="11" fill={colour} stroke={D} strokeWidth="2" />
        <rect x="28" y="8" width="9" height="11" fill={colour} stroke={D} strokeWidth="2" />
        <rect x="9" y="10" width="3" height="4" fill={L} />
        <rect x="6" y="16" width="32" height="28" rx="3" fill={colour} stroke={D} strokeWidth="2.5" />
        <rect x="10" y="19" width="8" height="5" fill={L} opacity="0.8" />
        <rect x="13" y="25" width="7" height="8" fill="#15151f" />
        <rect x="24" y="25" width="7" height="8" fill="#15151f" />
        <rect x="14" y="26" width="2" height="2" fill="#fff" opacity="0.7" />
        <rect x="25" y="26" width="2" height="2" fill="#fff" opacity="0.7" />
        <rect x="20" y="36" width="4" height="4" fill="#fff" stroke={D} strokeWidth="0.5" />
        <rect x="11" y="44" width="9" height="7" rx="1" fill={colour} stroke={D} strokeWidth="2" />
        <rect x="24" y="44" width="9" height="7" rx="1" fill={colour} stroke={D} strokeWidth="2" />
      </svg>
    </div>
  );
}

function deviceLabel(device) {
  return device.mac_address;
}

export default function SettingsPage({
  availableDevices,
  connectedRegisteredDevices,
  registeredDevices,
  selectedMac,
  setSelectedMac,
  name,
  setName,
  colour,
  setColour,
  busy,
  handleRegister,
  handleUpdateColour,
  backendHealthy,
  lastRefreshedAt,
}) {
  const [editingMac, setEditingMac] = useState(null);
  const [editColour, setEditColour] = useState('#4D96FF');

  function handleColourInput(hex) {
    setColour(clampColour(hex));
  }

  function startEditColour(device) {
    setEditingMac(device.mac_address);
    setEditColour(device.colour || '#4D96FF');
  }

  function saveEditColour() {
    if (editingMac) {
      handleUpdateColour(editingMac, clampColour(editColour));
      setEditingMac(null);
    }
  }

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <h1>Manage Devices</h1>
        <p>Register new devices, see who's home, and check system status.</p>
      </div>

      <div className="settings-grid">
        <article className="panel">
          <h2>Register Device</h2>
          <form onSubmit={handleRegister} className="form">
            <label>
              Device (MAC address)
              <select
                id="device-select"
                value={selectedMac}
                onChange={(event) => setSelectedMac(event.target.value)}
              >
                {availableDevices.length === 0 ? (
                  <option value="">No connected devices to register</option>
                ) : (
                  availableDevices.map((device) => (
                    <option key={device.mac_address} value={device.mac_address}>
                      {deviceLabel(device)}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label>
              Person's name
              <input
                id="device-name-input"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Caleb"
              />
            </label>

            <label>
              Character colour
              <div className="colour-picker-row">
                <input
                  type="color"
                  value={colour}
                  onChange={(e) => handleColourInput(e.target.value)}
                  className="colour-input"
                />
                <span className="colour-hex">{colour}</span>
              </div>
            </label>

            <div className="cat-preview-section">
              <span className="preview-label">Preview</span>
              <PicoCatPreview colour={colour} name={name} />
            </div>

            <button type="submit" id="register-btn" disabled={busy || availableDevices.length === 0}>
              {busy ? 'Saving...' : 'Register Device'}
            </button>
          </form>
        </article>

        <article className="panel">
          <h2>Currently Home</h2>
          {connectedRegisteredDevices.length > 0 && (
            <span className="connected-count">
              {connectedRegisteredDevices.length} online
            </span>
          )}
          <ul className="device-list" style={{ marginTop: '12px' }}>
            {connectedRegisteredDevices.map((device) => (
              <li key={device.mac_address}>
                <div className="device-row">
                  <PicoCatPreview colour={device.colour || '#4D96FF'} name={device.name} />
                  <div className="device-info">
                    <strong>{device.name}</strong>
                    <span>{device.mac_address}</span>
                  </div>
                </div>
              </li>
            ))}
            {connectedRegisteredDevices.length === 0 && (
              <li><span className="empty">No registered devices are currently connected.</span></li>
            )}
          </ul>
        </article>

        <article className="panel">
          <h2>All Registered</h2>
          <ul className="device-list">
            {registeredDevices.map((device) => (
              <li key={device.mac_address}>
                <div className="device-row">
                  <PicoCatPreview colour={device.colour || '#4D96FF'} name={device.name} />
                  <div className="device-info">
                    <strong>{device.name}</strong>
                    <span>{device.mac_address}</span>
                  </div>
                  {editingMac === device.mac_address ? (
                    <div className="edit-colour-row">
                      <input
                        type="color"
                        value={editColour}
                        onChange={(e) => setEditColour(e.target.value)}
                        className="colour-input small"
                      />
                      <button type="button" className="btn-small" onClick={saveEditColour}>Save</button>
                      <button type="button" className="btn-small cancel" onClick={() => setEditingMac(null)}>X</button>
                    </div>
                  ) : (
                    <button type="button" className="btn-small" onClick={() => startEditColour(device)}>
                      Edit Colour
                    </button>
                  )}
                </div>
              </li>
            ))}
            {registeredDevices.length === 0 && (
              <li><span className="empty">No registered devices yet.</span></li>
            )}
          </ul>
        </article>

        <article className="panel">
          <h2>System Status</h2>
          <div className="status-panel">
            <div className="status-row">
              <span className={backendHealthy ? 'status-dot success' : 'status-dot error'} />
              <span style={{ fontWeight: 700 }}>
                {backendHealthy ? 'Backend is healthy' : 'Backend offline'}
              </span>
            </div>
            <div className="status-row">
              <span className="status-dot success" />
              <span style={{ fontWeight: 700 }}>Frontend is running</span>
            </div>
            <p className="status-meta">
              Auto-refresh every 20 seconds
              {lastRefreshedAt ? ` · Last refreshed at ${lastRefreshedAt.toLocaleTimeString()}` : ''}
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
