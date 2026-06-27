import { useMemo } from 'react';
import { PicoCat } from '../components/PicoCat';

/* "2026-..." → "2h 15m ago" / "just now" / "3d ago". Minute granularity is
   plenty — the page refreshes every 20–60s. */
function formatAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const m = mins % 60;
    return m ? `${hrs}h ${m}m ago` : `${hrs}h ago`;
  }
  const days = Math.floor(hrs / 24);
  const h = hrs % 24;
  return h ? `${days}d ${h}h ago` : `${days}d ago`;
}

/* Compact clock label: 18:00 → "6pm", 00:00 → "12am". */
function fmtHour(t) {
  const d = new Date(t);
  let h = d.getHours();
  const ap = h < 12 ? 'am' : 'pm';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}${ap}`;
}

/* Tick marks anchored to real clock hours (every `stepH` hours) inside the
   window, so labels read 6pm / 12am / 6am rather than 5:18 / 11:18. */
function buildTicks(ws, now, stepH = 6) {
  const span = now - ws;
  if (span <= 0) return [];
  const hourMs = 3600 * 1000;
  const aligned = new Date(ws);
  aligned.setMinutes(0, 0, 0);
  let t = aligned.getTime();
  while (t < ws || new Date(t).getHours() % stepH !== 0) t += hourMs;
  const ticks = [];
  for (; t <= now; t += stepH * hourMs) {
    ticks.push({ pct: ((t - ws) / span) * 100, label: fmtHour(t) });
  }
  return ticks;
}

/* Turn a person's logged intervals into positioned green blocks clipped to the
   [windowStart, now] window. Open intervals (no logged leave) only reach "now"
   when the live network confirms the person is home; otherwise we trust the
   logs and don't extend. A present person with no logs at all is drawn home for
   the whole window (best-effort seed of the left edge). */
function buildBlocks(intervals, present, ws, now) {
  const span = now - ws;
  if (span <= 0) return [];

  if (present && intervals.length === 0) {
    return [{ left: 0, width: 100 }];
  }

  const blocks = [];
  for (const [start, end] of intervals) {
    const s = start === null ? ws : new Date(start).getTime();
    let e;
    if (end === null) {
      e = present ? now : s; // open span: close to now only if still home
    } else {
      e = new Date(end).getTime();
    }
    const cs = Math.max(s, ws);
    const ce = Math.min(e, now);
    if (ce <= cs) continue;
    blocks.push({ left: ((cs - ws) / span) * 100, width: ((ce - cs) / span) * 100 });
  }
  return blocks;
}

function RosterCard({ person }) {
  const { name, colour, present, lastSeen } = person;
  const status = present
    ? 'home'
    : lastSeen
      ? `last seen ${formatAgo(lastSeen)}`
      : 'last seen — unknown';

  return (
    <div className={`roster-card ${present ? 'home' : 'away'}`}>
      <div className="roster-cat">
        <PicoCat colour={colour} pose="sit" size={1.15} />
      </div>
      <div className="roster-name">{name}</div>
      <div className="roster-status">
        <span className={`roster-dot ${present ? 'on' : 'off'}`} />
        {status}
      </div>
    </div>
  );
}

export default function PresencePage({
  registeredDevices = [],
  connectedRegisteredDevices = [],
  history = null,
}) {
  const presentSet = useMemo(
    () => new Set(connectedRegisteredDevices.map((d) => d.mac_address)),
    [connectedRegisteredDevices],
  );

  // Roster: every registered person, home first, then most-recently-seen first.
  const people = useMemo(() => {
    const list = registeredDevices.map((device) => ({
      mac_address: device.mac_address,
      name: device.name,
      colour: device.colour || '#4D96FF',
      present: presentSet.has(device.mac_address),
      lastSeen: history?.people?.[device.mac_address]?.last_seen || null,
    }));

    list.sort((a, b) => {
      if (a.present !== b.present) return a.present ? -1 : 1;
      if (a.present && b.present) return a.name.localeCompare(b.name);
      if (!a.lastSeen && !b.lastSeen) return a.name.localeCompare(b.name);
      if (!a.lastSeen) return 1;
      if (!b.lastSeen) return -1;
      return new Date(b.lastSeen) - new Date(a.lastSeen);
    });
    return list;
  }, [registeredDevices, presentSet, history]);

  const gantt = useMemo(() => {
    if (!history) return null;
    const ws = new Date(history.window_start).getTime();
    const now = new Date(history.now).getTime();

    const ticks = buildTicks(ws, now, 4);

    const rows = people.map((p) => ({
      ...p,
      blocks: buildBlocks(history.people?.[p.mac_address]?.intervals || [], p.present, ws, now),
    }));

    return { ticks, rows };
  }, [history, people]);

  return (
    <div className="presence-page">
      <section className="presence-section">
        <h2 className="presence-heading">Who&apos;s home</h2>
        {people.length === 0 ? (
          <p className="empty">No people registered yet — add devices in Settings.</p>
        ) : (
          <div className="roster-grid">
            {people.map((p) => (
              <RosterCard key={p.mac_address} person={p} />
            ))}
          </div>
        )}
      </section>

      <section className="presence-section">
        <h2 className="presence-heading">Last 24 hours</h2>
        {!gantt ? (
          <p className="empty">Loading presence history…</p>
        ) : gantt.rows.length === 0 ? (
          <p className="empty">No people to chart yet.</p>
        ) : (
          <div className="gantt">
            {gantt.rows.map((row) => (
              <div className="gantt-row" key={row.mac_address}>
                <div className="gantt-label" title={row.name}>{row.name}</div>
                <div className="gantt-track">
                  {gantt.ticks.map((t, i) => (
                    <div key={`g${i}`} className="gantt-gridline" style={{ left: `${t.pct}%` }} />
                  ))}
                  {row.blocks.map((b, i) => (
                    <div
                      key={i}
                      className="gantt-block"
                      style={{ left: `${b.left}%`, width: `${b.width}%`, backgroundColor: row.colour }}
                    />
                  ))}
                  <div className="gantt-now" />
                </div>
              </div>
            ))}
            <div className="gantt-row gantt-axis-row">
              <div className="gantt-label" />
              <div className="gantt-axis">
                {gantt.ticks.filter((t) => t.pct <= 88).map((t, i) => (
                  <span
                    key={i}
                    className="gantt-tick"
                    style={{
                      left: `${t.pct}%`,
                      transform: t.pct < 5 ? 'none' : 'translateX(-50%)',
                    }}
                  >
                    {t.label}
                  </span>
                ))}
                <span className="gantt-tick now">now</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
