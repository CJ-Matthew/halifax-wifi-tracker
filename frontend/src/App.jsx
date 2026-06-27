import { useEffect, useMemo, useState } from 'react';
import { getConnectedDevices, getLogs, getPresenceHistory, getRegisteredDevices, registerDevice, updateDevice } from './api';
import HomePage from './pages/HomePage';
import PresencePage from './pages/PresencePage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [registeredDevices, setRegisteredDevices] = useState([]);
  const [selectedMac, setSelectedMac] = useState('');
  const [name, setName] = useState('');
  const [colour, setColour] = useState('#4D96FF');
  const [status, setStatus] = useState('Loading devices...');
  const [busy, setBusy] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);
  const [backendHealthy, setBackendHealthy] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState(null);

  const colourByMac = useMemo(
    () => new Map(registeredDevices.map((device) => [device.mac_address, device.colour || '#4D96FF'])),
    [registeredDevices],
  );

  const registeredMacSet = useMemo(() => new Set(registeredDevices.map((device) => device.mac_address)), [registeredDevices]);
  const registeredDeviceMap = useMemo(
    () => new Map(registeredDevices.map((device) => [device.mac_address, device])),
    [registeredDevices],
  );
  const availableDevices = useMemo(
    () => connectedDevices.filter((device) => !registeredMacSet.has(device.mac_address)),
    [connectedDevices, registeredMacSet],
  );
  const connectedRegisteredDevices = useMemo(
    () =>
      connectedDevices
        .filter((device) => registeredMacSet.has(device.mac_address))
        .map((device) => {
          const reg = registeredDeviceMap.get(device.mac_address);
          return {
            mac_address: device.mac_address,
            name: reg?.name || 'Unknown device',
            colour: reg?.colour || '#4D96FF',
          };
        }),
    [connectedDevices, registeredMacSet, registeredDeviceMap],
  );

  async function loadData() {
    setStatus('Loading devices...');
    try {
      const [devicesPayload, registeredPayload] = await Promise.all([
        getConnectedDevices(),
        getRegisteredDevices(),
      ]);

      setConnectedDevices(devicesPayload);
      setRegisteredDevices(registeredPayload);

      const nextAvailable = devicesPayload.filter(
        (device) => !registeredPayload.some((registered) => registered.mac_address === device.mac_address),
      );

      setSelectedMac((currentValue) => {
        if (currentValue && nextAvailable.some((device) => device.mac_address === currentValue)) {
          return currentValue;
        }
        return nextAvailable[0]?.mac_address || '';
      });

      setStatus(`Loaded ${devicesPayload.length} connected devices and ${registeredPayload.length} registered devices.`);
      setLastRefreshedAt(new Date());
      setBackendHealthy(true);
    } catch (error) {
      setStatus(error.message);
      setBackendHealthy(false);
    }
  }

  // Kept separate so a logs failure never blocks the device lists.
  async function loadLogs() {
    try {
      setLogs(await getLogs());
    } catch {
      /* feed stays as-is on transient errors */
    }
  }

  // Presence history changes only when events fire, so a slower poll is fine;
  // the live status that colours the Presence cards rides the 20s loadData loop.
  async function loadHistory() {
    try {
      setHistory(await getPresenceHistory(24));
    } catch {
      /* keep the last good history on transient errors */
    }
  }

  useEffect(() => {
    loadData();
    loadLogs();
    loadHistory();

    const refreshInterval = setInterval(loadData, 20000);
    // Poll the event feed more often so enter/leave events show up quickly.
    const logsInterval = setInterval(loadLogs, 5000);
    const historyInterval = setInterval(loadHistory, 60000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(logsInterval);
      clearInterval(historyInterval);
    };
  }, []);

  async function handleRegister(event) {
    event.preventDefault();
    if (!selectedMac || !name.trim()) {
      setStatus('Select a device and enter a name.');
      return;
    }

    setBusy(true);
    setStatus('Registering device...');
    try {
      await registerDevice(selectedMac, name.trim(), colour);

      setName('');
      setColour('#4D96FF');
      await loadData();
      setStatus('Device registered successfully.');
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateColour(macAddress, newColour) {
    try {
      await updateDevice(macAddress, { colour: newColour });
      await loadData();
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          🏠{'\n'}Halifax{'\n'}Home
        </div>
        <nav className="tabs" aria-label="Primary navigation">
          <button
            type="button"
            id="tab-home"
            className={activeTab === 'home' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('home')}
          >
            🏡 Home
          </button>
          <button
            type="button"
            id="tab-presence"
            className={activeTab === 'presence' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('presence')}
          >
            📋 Presence
          </button>
          <button
            type="button"
            id="tab-settings"
            className={activeTab === 'settings' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('settings')}
          >
            ⚙️ Settings
          </button>
        </nav>
      </aside>

      <section className="content">
        <header className="page-header">
          <p className="page-title">
            {activeTab === 'home' ? '🏠 Home' : activeTab === 'presence' ? '📋 Presence' : '⚙️ Settings'}
          </p>
        </header>

        {activeTab === 'home' ? (
          <HomePage
            connectedRegisteredDevices={connectedRegisteredDevices}
            logs={logs}
            colourByMac={colourByMac}
          />
        ) : activeTab === 'presence' ? (
          <PresencePage
            registeredDevices={registeredDevices}
            connectedRegisteredDevices={connectedRegisteredDevices}
            history={history}
          />
        ) : (
          <SettingsPage
            availableDevices={availableDevices}
            connectedRegisteredDevices={connectedRegisteredDevices}
            registeredDevices={registeredDevices}
            selectedMac={selectedMac}
            setSelectedMac={setSelectedMac}
            name={name}
            setName={setName}
            colour={colour}
            setColour={setColour}
            busy={busy}
            handleRegister={handleRegister}
            handleUpdateColour={handleUpdateColour}
            backendHealthy={backendHealthy}
            lastRefreshedAt={lastRefreshedAt}
          />
        )}
      </section>
    </main>
  );
}