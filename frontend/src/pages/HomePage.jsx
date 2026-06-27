import { useEffect, useRef, useState, memo } from 'react';

/* ─── Coordinate system ───────────────────────────────────────────────
   SVG viewBox: 1200 x 700.  Character x is 0–100 (% of width → ×12 = SVG x).
   House interior: SVG x 160–1000, y 100–600.  Stairwell SVG x 932–996.
   Floor surfaces (cat feet) in SVG y: ground 592, floor2 456, floor3 276.
   ────────────────────────────────────────────────────────────────────── */

const FLOOR_Y = [592, 456, 276];
const STAIR_X = 80;            // char-x of the stairwell
const WALK_SPEED = 9;          // char-units / second
const SPEAK_CHANCE = 0.12;  // chance to speak when a cat settles / interacts
const SPEAK_MS = 3200;         // how long a speech bubble stays up
const MIN_GAP = 7;             // min horizontal spacing (char-x) between cats on a floor

/* ─── Rooms ────────────────────────────────────────────────────────────
   xMin/xMax are char-x bounds; anchor is the furniture a cat "uses".      */
const ROOMS = {
  kitchen: { floor: 0, xMin: 14.5, xMax: 40.5, anchor: { x: 18, action: 'cook' }, label: 'Kitchen' },
  lounge:  { floor: 0, xMin: 43,   xMax: 76.5, anchor: { x: 50, action: 'sit'  }, label: 'Lounge'  },
  garden:  { floor: 0, xMin: 3.5,  xMax: 12.5, anchor: { x: 8,  action: 'sit'  }, label: 'Garden', outdoor: true },
  nerdy:   { floor: 1, xMin: 14.5, xMax: 33.5, anchor: { x: 19, action: 'nap'  }, label: 'Study'   },
  sporty:  { floor: 1, xMin: 36,   xMax: 55.5, anchor: { x: 46, action: 'lift' }, label: 'Gym'     },
  gamer:   { floor: 1, xMin: 57.5, xMax: 76.5, anchor: { x: 74, action: 'game' }, label: 'Gamer'   },
  master:  { floor: 2, xMin: 14.5, xMax: 76.5, anchor: { x: 22, action: 'nap'  }, label: 'Master'  },
  terrace: { floor: 2, xMin: 84,   xMax: 94,   anchor: { x: 88, action: 'sit'  }, label: 'Terrace', outdoor: true },
};
const HOME_ROOMS = ['kitchen', 'lounge', 'nerdy', 'sporty', 'gamer', 'master'];
const ALL_ROOMS = Object.keys(ROOMS);

function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
function pickRoomXSpot(room) { return rand(room.xMin + 2, room.xMax - 2); }

/* Stable home room from the device's MAC address. */
function homeRoomFor(mac) {
  let h = 0;
  const s = String(mac || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HOME_ROOMS[h % HOME_ROOMS.length];
}

/* Darken / lighten a hex colour for outlines & highlights. */
function shade(hex, f) {
  const n = parseInt((hex || '#4D96FF').slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function initCharacter(device) {
  const homeRoom = homeRoomFor(device.mac_address);
  const room = ROOMS[homeRoom];
  return {
    id: device.mac_address,
    name: device.name,
    colour: device.colour || '#4D96FF',
    homeRoom,
    currentRoom: homeRoom,
    currentFloor: room.floor,
    x: pickRoomXSpot(room),
    state: 'idle',
    action: null,
    speech: null,
    dir: Math.random() > 0.5 ? 1 : -1,
    walkDuration: 0,
    targetFloor: null,
  };
}

function getCharScale(totalCount) {
  if (totalCount <= 10) return 1;
  if (totalCount <= 20) return 0.85;
  if (totalCount <= 35) return 0.72;
  return 0.6;
}

/* ─── Pico cat sprite (matches reference: notched ears, black eyes,
       white mouth, foot) — outline & highlight derived from colour. ───── */
function PicoCat({ colour, dir, pose = 'stand', eyes = 'open', size = 1 }) {
  const w = Math.round(44 * size);
  const h = Math.round(52 * size);
  const D = shade(colour, 0.45);   // outline
  const L = shade(colour, 1.22);   // highlight
  const sit = pose === 'sit';
  const dy = sit ? 6 : 0;          // sitting cat sinks down a touch

  return (
    <svg
      width={w} height={h}
      viewBox="0 0 44 52"
      shapeRendering="crispEdges"
      style={{ transform: dir === -1 ? 'scaleX(-1)' : 'none', display: 'block', overflow: 'visible' }}
    >
      <g transform={`translate(0 ${dy})`}>
        {/* Ears (two nubs with a notch between) */}
        <rect x="7"  y="8"  width="9" height="11" fill={colour} stroke={D} strokeWidth="2" />
        <rect x="28" y="8"  width="9" height="11" fill={colour} stroke={D} strokeWidth="2" />
        <rect x="9"  y="10" width="3" height="4"  fill={L} />
        {/* Body */}
        <rect x="6" y="16" width="32" height="28" rx="3" fill={colour} stroke={D} strokeWidth="2.5" />
        {/* Highlight */}
        <rect x="10" y="19" width="8" height="5" fill={L} opacity="0.8" />
        {/* Eyes */}
        {eyes === 'closed' ? (
          <>
            <rect x="13" y="29" width="7" height="2" fill="#15151f" />
            <rect x="24" y="29" width="7" height="2" fill="#15151f" />
          </>
        ) : (
          <>
            <rect x="13" y="25" width="7" height="8" fill="#15151f" />
            <rect x="24" y="25" width="7" height="8" fill="#15151f" />
            <rect x="14" y="26" width="2" height="2" fill="#fff" opacity="0.7" />
            <rect x="25" y="26" width="2" height="2" fill="#fff" opacity="0.7" />
          </>
        )}
        {/* Mouth / chin */}
        <rect x="20" y="36" width="4" height="4" fill="#fff" stroke={D} strokeWidth="0.5" />
        {/* Legs (hidden when sitting) */}
        {!sit && (
          <g className="cat-legs">
            <rect className="cat-leg cat-leg-l" x="11" y="44" width="9" height="7" rx="1" fill={colour} stroke={D} strokeWidth="2" />
            <rect className="cat-leg cat-leg-r" x="24" y="44" width="9" height="7" rx="1" fill={colour} stroke={D} strokeWidth="2" />
          </g>
        )}
        {/* Tucked paws when sitting */}
        {sit && (
          <rect x="11" y="42" width="22" height="4" rx="2" fill={colour} stroke={D} strokeWidth="1.5" />
        )}
      </g>
    </svg>
  );
}

/* ─── Character ────────────────────────────────────────────────────────── */
function Character({ char, containerWidth, containerHeight, scale }) {
  const floorY = FLOOR_Y[char.currentFloor];
  const nametagH = 16 * scale;
  const catH = 52 * scale;
  const totalH = catH + nametagH;
  const x = (char.x / 100) * containerWidth;
  const y = (floorY / 700) * containerHeight - totalH;

  const isOnStairs = char.state === 'onStairs';
  const isMoving = char.state === 'walking';
  const stairTargetY = isOnStairs && char.targetFloor !== null
    ? (FLOOR_Y[char.targetFloor] / 700) * containerHeight - totalH
    : y;

  const pose = isMoving
    ? 'walk'
    : char.state === 'interacting' && (char.action === 'sit' || char.action === 'nap')
      ? 'sit'
      : 'stand';
  const eyes = char.state === 'interacting' && char.action === 'nap' ? 'closed' : 'open';

  return (
    <div
      className={`pico-char ${char.state}`}
      style={{
        left: x,
        top: isOnStairs ? stairTargetY : y,
        transition: isMoving
          ? `left ${char.walkDuration}s linear`
          : isOnStairs
            ? 'left 0s, top 2s ease-in-out'
            : 'left 0.1s linear, top 0.2s linear',
      }}
    >
      {char.speech && (
        <div className="char-speech" style={{ fontSize: `${Math.max(0.25, 0.34 * scale)}rem` }}>
          {char.speech}
        </div>
      )}
      <div className="char-nametag" style={{ fontSize: `${Math.max(0.25, 0.32 * scale)}rem` }}>
        {char.name}
      </div>
      <PicoCat colour={char.colour} dir={char.dir} pose={pose} eyes={eyes} size={scale} />
    </div>
  );
}

/* ─── What cats say, by room (plus a shared pool). Edit freely. ─────────── */
const SPEECH_LINES = {
  generic: ['hi!', 'cozy~', 'la la la', 'home sweet home', 'nice day', '*purr*', 'hello!'],
  kitchen: ['mmm snack', 'is it dinner?', 'tea time', 'yum!', 'who ate my food'],
  lounge:  ['comfy~', 'what’s on tv?', 'just chilling', 'movie night?'],
  nerdy:   ['so much to read', 'fascinating', 'one more chapter', 'hmm…'],
  sporty:  ['one more rep', 'feel the burn', 'go go go!', 'gains!'],
  gamer:   ['gg!', 'one more game', 'clutch!', 'lag!!', 'noob'],
  master:  ['nap time', 'so sleepy', 'zzz', 'comfy bed'],
  garden:  ['fresh air!', 'pretty flowers', 'birds!', 'sunny~'],
  terrace: ['nice view', 'fresh air!', 'so peaceful', 'sunset soon'],
};

function pickSpeech(roomId) {
  const pool = [...(SPEECH_LINES[roomId] || []), ...SPEECH_LINES.generic];
  return pool[Math.floor(Math.random() * pool.length)];
}

/* ─── Top-right event feed: who entered / left, in their colour ─────────── */
function EventFeed({ logs, colourByMac }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="event-feed">
        <div className="event-feed-title">Comings &amp; Goings</div>
        <div className="event-empty">Nobody&apos;s come or gone yet</div>
      </div>
    );
  }
  return (
    <div className="event-feed">
      <div className="event-feed-title">Comings &amp; Goings</div>
      {logs.slice(0, 5).map((log, i) => {
        const colour = colourByMac.get(log.mac_address) || '#cfcfcf';
        const time = log.created_at
          ? new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
          : '';
        return (
          <div className="event-row" key={`${log.created_at}-${i}`} style={{ color: colour }}>
            <span className="event-text">{log.name} {log.is_leaving ? 'left home' : 'entered'}</span>
            <span className="event-time">{time}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Hanging lantern with warm glow ───────────────────────────────────── */
function Lantern({ x, y }) {
  return (
    <g>
      <circle cx={x} cy={y + 10} r="46" fill="url(#glow)" />
      <line x1={x} y1={y - 18} x2={x} y2={y} stroke="#3a2a1e" strokeWidth="2" />
      <rect x={x - 3} y={y - 20} width="6" height="3" fill="#5e4128" stroke="#33271c" strokeWidth="1" />
      <rect x={x - 7} y={y} width="14" height="16" rx="2" fill="#ffcf6b" stroke="#7a4a1e" strokeWidth="2" />
      <rect x={x - 5} y={y + 3} width="10" height="10" fill="#ffe9a8" />
      <rect x={x - 8} y={y + 15} width="16" height="3" rx="1" fill="#5e4128" stroke="#33271c" strokeWidth="1" />
    </g>
  );
}

/* ─── House + scene (static → memoized) ────────────────────────────────── */
const HouseSVG = memo(function HouseSVG() {
  const OL = '#33271c';        // furniture/wood outline
  const BEAM = '#5e4128';      // frame wood
  const BEAM_HI = '#7a5636';   // frame highlight
  const beam = (x, y, w, h, key) => (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} fill={BEAM} stroke={OL} strokeWidth="2" />
      <rect x={x} y={y} width={w} height={Math.min(3, h)} fill={BEAM_HI} opacity="0.6" />
    </g>
  );

  return (
    <svg viewBox="0 0 1200 700" className="house-svg" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
      <defs>
        {/* warm tan brick interior wall */}
        <pattern id="wall" width="34" height="18" patternUnits="userSpaceOnUse">
          <rect width="34" height="18" fill="#8d7a66" />
          <rect x="1"  y="1"  width="15" height="7" fill="#a8917a" />
          <rect x="18" y="1"  width="15" height="7" fill="#ad967f" />
          <rect x="1"  y="10" width="8"  height="7" fill="#a38c75" />
          <rect x="10" y="10" width="15" height="7" fill="#ad967f" />
          <rect x="27" y="10" width="6"  height="7" fill="#a8917a" />
          <rect x="1"  y="1"  width="15" height="2" fill="#bba589" opacity="0.6" />
          <rect x="10" y="10" width="15" height="2" fill="#bba589" opacity="0.5" />
        </pattern>
        {/* wood floor planks */}
        <pattern id="floor" width="46" height="12" patternUnits="userSpaceOnUse">
          <rect width="46" height="12" fill="#7d5430" />
          <rect width="45" height="11" fill="#9c6b3e" />
          <rect y="2" width="45" height="1" fill="#86592f" opacity="0.6" />
          <rect y="8" width="45" height="1" fill="#b07e4c" opacity="0.5" />
          <rect x="45" width="1" height="11" fill="#6e4a2a" />
          <rect x="22" width="1" height="11" fill="#6e4a2a" opacity="0.5" />
        </pattern>
        {/* red roof tiles */}
        <pattern id="roof" width="22" height="11" patternUnits="userSpaceOnUse">
          <rect width="22" height="11" fill="#a8423c" />
          <rect width="21" height="10" fill="#c4524b" />
          <rect y="9" width="22" height="2" fill="#8f352f" />
          <rect width="21" height="2" fill="#d66a62" opacity="0.6" />
          <rect x="10" width="1" height="9" fill="#9c3a35" opacity="0.5" />
        </pattern>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="#7ec8ef" />
          <stop offset="55%" stopColor="#a9def0" />
          <stop offset="100%" stopColor="#cdeae4" />
        </linearGradient>
        <radialGradient id="glow">
          <stop offset="0%"  stopColor="#ffe6a0" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffe6a0" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="sunGlow">
          <stop offset="0%" stopColor="#fff6cf" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff6cf" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ─── EXTERIOR SCENE ─────────────────────────────────────────────── */}
      <rect width="1200" height="700" fill="url(#sky)" />
      <circle cx="1090" cy="80" r="70" fill="url(#sunGlow)" />
      <circle cx="1090" cy="80" r="30" fill="#fff2bf" />
      <circle cx="1090" cy="80" r="24" fill="#fff8da" />

      {/* clouds */}
      <g fill="#ffffff">
        <g opacity="0.85"><ellipse cx="200" cy="70" rx="46" ry="18" /><ellipse cx="240" cy="62" rx="32" ry="15" /><ellipse cx="165" cy="64" rx="28" ry="13" /></g>
        <g opacity="0.6"><ellipse cx="640" cy="55" rx="38" ry="15" /><ellipse cx="672" cy="48" rx="26" ry="12" /></g>
        <g opacity="0.5"><ellipse cx="960" cy="120" rx="34" ry="13" /><ellipse cx="990" cy="114" rx="24" ry="11" /></g>
      </g>

      {/* far mountains */}
      <polygon points="-40,360 150,170 330,360" fill="#bcccd8" />
      <polygon points="220,360 430,150 660,360" fill="#b0c2d0" />
      <polygon points="560,360 820,180 1080,360" fill="#bcccd8" />
      <polygon points="900,360 1120,200 1320,360" fill="#aebfce" />
      {/* snow caps */}
      <polygon points="430,150 405,185 430,178 452,192 475,168" fill="#eef5fa" />
      <polygon points="820,180 798,210 820,204 840,216 862,196" fill="#eef5fa" />

      {/* rolling hills */}
      <ellipse cx="250" cy="640" rx="420" ry="120" fill="#7bb656" />
      <ellipse cx="980" cy="650" rx="460" ry="130" fill="#6fae4c" />

      {/* distant pines */}
      {[[60, 470, 0.8], [120, 485, 0.62], [1150, 460, 0.95], [1185, 480, 0.7], [690, 430, 0.5]].map(([px, py, s], i) => (
        <g key={`fp-${i}`}>
          <rect x={px - 4 * s} y={py} width={8 * s} height={26 * s} fill="#6b4a2e" />
          <polygon points={`${px},${py - 70 * s} ${px - 30 * s},${py + 4 * s} ${px + 30 * s},${py + 4 * s}`} fill="#357a45" />
          <polygon points={`${px},${py - 50 * s} ${px - 24 * s},${py - 6 * s} ${px + 24 * s},${py - 6 * s}`} fill="#2f6b3b" />
          <polygon points={`${px},${py - 30 * s} ${px - 18 * s},${py - 12 * s} ${px + 18 * s},${py - 12 * s}`} fill="#3a8a4c" />
        </g>
      ))}

      {/* ground */}
      <rect y="600" width="1200" height="100" fill="#6aa847" />
      <rect y="648" width="1200" height="52" fill="#569036" />
      <rect y="674" width="1200" height="26" fill="#7a4d2c" />
      <rect y="692" width="1200" height="8" fill="#5e3a20" />

      {/* ─── HOUSE SHELL ────────────────────────────────────────────────── */}
      {/* stone foundation */}
      <rect x="150" y="596" width="860" height="16" fill="#9a9a9a" stroke={OL} strokeWidth="3" />
      {[...Array(17)].map((_, i) => (
        <rect key={`fn-${i}`} x={156 + i * 50} y="599" width="46" height="10" fill="#b0b0b0" stroke="#7a7a7a" strokeWidth="1" />
      ))}

      {/* interior background wall (unified shell) */}
      <rect x="160" y="100" width="840" height="500" fill="url(#wall)" />

      {/* floor planks per level */}
      <rect x="160" y="266" width="840" height="12" fill="url(#floor)" />
      <rect x="160" y="446" width="840" height="12" fill="url(#floor)" />
      <rect x="160" y="582" width="840" height="12" fill="url(#floor)" />

      {/* frame: floor divider beams */}
      {beam(160, 278, 840, 7, 'd3')}
      {beam(160, 458, 840, 7, 'd2')}
      {/* posts + top plate + base */}
      {beam(160, 100, 14, 500, 'pL')}
      {beam(986, 100, 14, 500, 'pR')}
      {beam(160, 100, 840, 12, 'top')}
      {beam(160, 588, 840, 8, 'base')}
      {/* interior dividers */}
      {beam(411, 285, 8, 161, 'i2a')}
      {beam(671, 285, 8, 161, 'i2b')}
      {beam(494, 458, 8, 124, 'i1a')}
      {/* stairwell walls */}
      {beam(928, 100, 8, 500, 'stL')}
      {beam(996, 100, 8, 500, 'stR')}

      {/* ─── ROOF ───────────────────────────────────────────────────────── */}
      <polygon points="580,16 110,100 1050,100" fill="#8f352f" stroke={OL} strokeWidth="4" />
      <polygon points="580,28 580,100 1035,100" fill="url(#roof)" />
      <polygon points="580,28 580,100 125,100" fill="url(#roof)" />
      <rect x="566" y="14" width="28" height="14" fill="#8f352f" stroke={OL} strokeWidth="2" />
      {/* chimney */}
      <rect x="330" y="40" width="34" height="48" fill="#9a6b4a" stroke={OL} strokeWidth="3" />
      <rect x="324" y="36" width="46" height="9" fill="#7a7a7a" stroke={OL} strokeWidth="2" />
      <g fill="#fff"><circle cx="347" cy="28" r="6" opacity="0.5" /><circle cx="352" cy="16" r="8" opacity="0.35" /><circle cx="345" cy="6" r="5" opacity="0.2" /></g>

      {/* ─── STAIRWELL ──────────────────────────────────────────────────── */}
      <rect x="936" y="100" width="60" height="500" fill="#a78a6a" opacity="0.45" />
      {[[590, 8], [410, 8], [264, 6]].map(([base, n], s) =>
        [...Array(n)].map((_, i) => (
          <rect key={`st-${s}-${i}`} x={938 + (i % 2) * 6} y={base - i * 18} width="52" height="5" fill="#9c6b3e" stroke={OL} strokeWidth="1" />
        ))
      )}
      <line x1="940" y1="110" x2="940" y2="595" stroke="#5e4128" strokeWidth="3" />
      <line x1="992" y1="110" x2="992" y2="595" stroke="#5e4128" strokeWidth="3" />

      {/* ═══ FLOOR 3: MASTER BEDROOM ═══════════════════════════════════════ */}
      {/* big bed */}
      <rect x="196" y="224" width="156" height="40" fill="#efe7f1" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="184" y="170" width="18" height="94" fill="#7a5fa0" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="346" y="210" width="14" height="54" fill="#7a5fa0" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="202" y="220" width="40" height="18" fill="#ffffff" stroke={OL} strokeWidth="1" rx="3" />
      <rect x="246" y="220" width="40" height="18" fill="#f3eef8" stroke={OL} strokeWidth="1" rx="3" />
      <rect x="196" y="240" width="156" height="24" fill="#9b7fc0" stroke={OL} strokeWidth="1.5" rx="2" />
      <rect x="200" y="246" width="148" height="3" fill="#b49edb" opacity="0.7" />
      {/* nightstand + lamp */}
      <rect x="366" y="238" width="34" height="26" fill="#a9743f" stroke={OL} strokeWidth="2" rx="1" />
      <rect x="380" y="226" width="6" height="14" fill="#7a7a7a" stroke={OL} strokeWidth="1" />
      <polygon points="373,227 393,227 388,215 378,215" fill="#ffe88a" stroke={OL} strokeWidth="1.5" />
      {/* fireplace */}
      <rect x="494" y="190" width="104" height="12" fill="#a9743f" stroke={OL} strokeWidth="2" rx="1" />
      <rect x="500" y="200" width="92" height="64" fill="#8d7a66" stroke={OL} strokeWidth="3" />
      <rect x="518" y="216" width="56" height="48" fill="#241910" />
      <polygon points="528,264 524,238 534,248 540,228 548,250 558,236 564,264" fill="#ff7a2e" />
      <polygon points="536,264 534,244 544,252 550,236 558,264" fill="#ffc23d" />
      <circle cx="546" cy="244" r="34" fill="url(#glow)" />
      {/* wardrobe */}
      <rect x="780" y="150" width="74" height="114" fill="#a9743f" stroke={OL} strokeWidth="2" rx="2" />
      <line x1="817" y1="152" x2="817" y2="262" stroke={OL} strokeWidth="1.5" />
      <rect x="808" y="200" width="4" height="14" fill="#ffd700" stroke={OL} strokeWidth="0.5" />
      <rect x="822" y="200" width="4" height="14" fill="#ffd700" stroke={OL} strokeWidth="0.5" />
      {/* window */}
      <rect x="660" y="150" width="58" height="56" fill="#bfe9fb" stroke={OL} strokeWidth="3" />
      <rect x="662" y="152" width="54" height="24" fill="#d9f3fe" opacity="0.6" />
      <line x1="689" y1="150" x2="689" y2="206" stroke={OL} strokeWidth="2" />
      <line x1="660" y1="178" x2="718" y2="178" stroke={OL} strokeWidth="2" />
      {/* rug */}
      <ellipse cx="430" cy="272" rx="120" ry="7" fill="#cc5de8" opacity="0.3" />
      <ellipse cx="430" cy="272" rx="86" ry="5" fill="#e090f0" opacity="0.3" />
      <Lantern x={430} y={150} />

      {/* ═══ FLOOR 2: STUDY (nerdy) ════════════════════════════════════════ */}
      <rect x="190" y="405" width="80" height="45" fill="#e8e8f0" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="190" y="402" width="80" height="12" fill="#6b5b95" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="193" y="430" width="30" height="10" fill="#d0d0e8" stroke={OL} strokeWidth="1" rx="2" />
      <rect x="190" y="416" width="80" height="35" fill="#9b8ec4" stroke={OL} strokeWidth="1.5" rx="2" />
      {/* desk + lamp + globe + telescope */}
      <rect x="300" y="420" width="60" height="30" fill="#a9743f" stroke={OL} strokeWidth="2" />
      <rect x="305" y="444" width="8" height="10" fill="#8a5d34" stroke={OL} strokeWidth="1" />
      <rect x="347" y="444" width="8" height="10" fill="#8a5d34" stroke={OL} strokeWidth="1" />
      <rect x="340" y="410" width="6" height="12" fill="#7a7a7a" stroke={OL} strokeWidth="1" />
      <rect x="334" y="405" width="18" height="8" fill="#ffe88a" stroke={OL} strokeWidth="1" rx="2" />
      <circle cx="315" cy="412" r="10" fill="#4d96ff" stroke={OL} strokeWidth="1.5" />
      <ellipse cx="315" cy="412" rx="10" ry="3" fill="none" stroke={OL} strokeWidth="0.8" />
      <rect x="312" y="421" width="6" height="3" fill="#7a7a7a" stroke={OL} strokeWidth="1" />
      <rect x="380" y="410" width="6" height="40" fill="#7a7a7a" stroke={OL} strokeWidth="1.5" />
      <rect x="370" y="405" width="26" height="8" fill="#606060" stroke={OL} strokeWidth="1.5" rx="2" />
      <circle cx="396" cy="409" r="5" fill="#bfe9fb" stroke={OL} strokeWidth="1" />
      {/* bookshelf */}
      <rect x="200" y="300" width="64" height="58" fill="#a9743f" stroke={OL} strokeWidth="2" />
      {[['#e06060', 204, 304], ['#4d96ff', 214, 304], ['#6bcb77', 224, 304], ['#ffd93d', 234, 304], ['#cc5de8', 246, 304],
        ['#ff922b', 204, 330], ['#20c997', 216, 330], ['#f783ac', 230, 330], ['#4d96ff', 242, 330]].map(([c, bx, by], i) => (
        <rect key={`nb-${i}`} x={bx} y={by} width="9" height="24" fill={c} stroke={OL} strokeWidth="1" />
      ))}

      {/* ═══ FLOOR 2: GYM (sporty) ═════════════════════════════════════════ */}
      <rect x="445" y="405" width="80" height="45" fill="#e8f0e8" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="445" y="402" width="80" height="12" fill="#4aa63a" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="448" y="430" width="30" height="10" fill="#d0e8d0" stroke={OL} strokeWidth="1" rx="2" />
      <rect x="445" y="416" width="80" height="35" fill="#7bc47b" stroke={OL} strokeWidth="1.5" rx="2" />
      <rect x="560" y="435" width="20" height="12" fill="#ffd700" stroke={OL} strokeWidth="1.5" rx="1" />
      <rect x="565" y="425" width="10" height="12" fill="#ffd700" stroke={OL} strokeWidth="1.5" />
      <rect x="558" y="420" width="24" height="8" fill="#ffd700" stroke={OL} strokeWidth="1.5" rx="3" />
      <rect x="562" y="446" width="16" height="5" fill="#a9743f" stroke={OL} strokeWidth="1" />
      <rect x="580" y="310" width="40" height="55" fill="#ff8c42" stroke={OL} strokeWidth="2" rx="1" />
      <rect x="584" y="314" width="32" height="22" fill="#ffb070" />
      <circle cx="600" cy="325" r="8" fill="#fff" stroke={OL} strokeWidth="1" />
      <rect x="546" y="450" width="22" height="4" fill="#7a7a7a" stroke={OL} strokeWidth="1" />
      <rect x="543" y="447" width="6" height="10" fill="#606060" stroke={OL} strokeWidth="1" rx="1" />
      <rect x="565" y="447" width="6" height="10" fill="#606060" stroke={OL} strokeWidth="1" rx="1" />
      <rect x="628" y="446" width="14" height="7" fill="#4d96ff" stroke={OL} strokeWidth="1" rx="2" />
      <rect x="644" y="445" width="18" height="8" fill="#ff4444" stroke={OL} strokeWidth="1" rx="2" />

      {/* ═══ FLOOR 2: GAMER ════════════════════════════════════════════════ */}
      <rect x="700" y="405" width="78" height="45" fill="#e0e8f0" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="700" y="402" width="78" height="12" fill="#2d5a8c" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="703" y="430" width="28" height="10" fill="#d0d8e8" stroke={OL} strokeWidth="1" rx="2" />
      <rect x="700" y="416" width="78" height="35" fill="#5080b0" stroke={OL} strokeWidth="1.5" rx="2" />
      <rect x="800" y="390" width="78" height="60" fill="#404040" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="805" y="350" width="32" height="22" fill="#1a1a2e" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="808" y="353" width="26" height="16" fill="#1565c0" />
      <rect x="843" y="350" width="32" height="22" fill="#1a1a2e" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="846" y="353" width="26" height="16" fill="#1565c0" />
      <rect x="812" y="356" width="8" height="8" fill="#64dd17" opacity="0.8" />
      <rect x="850" y="356" width="10" height="10" fill="#d50000" opacity="0.7" />
      <rect x="817" y="372" width="6" height="6" fill="#606060" stroke={OL} strokeWidth="1" />
      <rect x="855" y="372" width="6" height="6" fill="#606060" stroke={OL} strokeWidth="1" />
      <rect x="893" y="395" width="30" height="50" fill="#e06060" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="891" y="385" width="34" height="16" fill="#e87070" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="903" y="444" width="10" height="6" fill="#606060" stroke={OL} strokeWidth="1" />
      {[695, 712, 729, 746, 763, 780, 797, 814, 831, 848, 865, 882, 899, 916].map((rx, i) => (
        <rect key={`rgb-${i}`} x={rx} y="295" width="11" height="3"
          fill={['#FF0000', '#FF8000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#8000FF', '#FF00FF'][i % 8]} opacity="0.7" />
      ))}

      {/* ═══ FLOOR 1: KITCHEN ══════════════════════════════════════════════ */}
      <rect x="180" y="555" width="180" height="12" fill="#e8e0d8" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="180" y="567" width="180" height="25" fill="#d8d0c8" stroke={OL} strokeWidth="2" />
      <rect x="185" y="540" width="50" height="16" fill="#7a7a7a" stroke={OL} strokeWidth="2" rx="2" />
      <circle cx="200" cy="542" r="5" fill="#505050" stroke={OL} strokeWidth="1" />
      <circle cx="220" cy="542" r="5" fill="#505050" stroke={OL} strokeWidth="1" />
      <rect x="192" y="528" width="22" height="13" fill="#90a4ae" stroke={OL} strokeWidth="1.5" rx="2" />
      <path d="M200,525 Q198,518 202,514" fill="none" stroke="#b0b0b0" strokeWidth="1.5" opacity="0.5" />
      <rect x="180" y="490" width="70" height="30" fill="#c89464" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="260" y="490" width="70" height="30" fill="#c89464" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="211" y="497" width="5" height="16" fill="#8a5d34" stroke={OL} strokeWidth="1" rx="1" />
      <rect x="291" y="497" width="5" height="16" fill="#8a5d34" stroke={OL} strokeWidth="1" rx="1" />
      <rect x="280" y="548" width="30" height="10" fill="#b0c4de" stroke={OL} strokeWidth="1.5" rx="2" />
      <rect x="292" y="538" width="6" height="12" fill="#a0a0a0" stroke={OL} strokeWidth="1" />
      <rect x="380" y="520" width="50" height="62" fill="#e0e8e8" stroke={OL} strokeWidth="2" rx="3" />
      <line x1="380" y1="550" x2="430" y2="550" stroke={OL} strokeWidth="1.5" />
      <rect x="424" y="528" width="4" height="10" fill="#a0a0a0" stroke={OL} strokeWidth="1" rx="1" />
      <rect x="424" y="558" width="4" height="14" fill="#a0a0a0" stroke={OL} strokeWidth="1" rx="1" />
      <rect x="340" y="488" width="40" height="35" fill="#bfe9fb" stroke={OL} strokeWidth="2" />
      <line x1="360" y1="488" x2="360" y2="523" stroke={OL} strokeWidth="1.5" />
      <line x1="340" y1="505" x2="380" y2="505" stroke={OL} strokeWidth="1.5" />

      {/* ═══ FLOOR 1: LOUNGE ═══════════════════════════════════════════════ */}
      <rect x="540" y="550" width="120" height="20" fill="#5c6bc0" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="540" y="535" width="120" height="20" fill="#7986cb" stroke={OL} strokeWidth="2" rx="3" />
      <rect x="538" y="540" width="14" height="28" fill="#5c6bc0" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="648" y="540" width="14" height="28" fill="#5c6bc0" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="550" y="552" width="30" height="12" fill="#9fa8da" stroke={OL} strokeWidth="1" rx="2" />
      <rect x="585" y="552" width="30" height="12" fill="#9fa8da" stroke={OL} strokeWidth="1" rx="2" />
      <rect x="620" y="552" width="25" height="12" fill="#9fa8da" stroke={OL} strokeWidth="1" rx="2" />
      <rect x="710" y="555" width="80" height="8" fill="#7a7a7a" stroke={OL} strokeWidth="2" />
      <rect x="720" y="525" width="60" height="32" fill="#1a1a2e" stroke={OL} strokeWidth="2" rx="2" />
      <rect x="724" y="529" width="52" height="24" fill="#283593" />
      <rect x="729" y="532" width="14" height="10" fill="#ff8c42" opacity="0.7" rx="1" />
      <rect x="746" y="534" width="10" height="6" fill="#66bb6a" opacity="0.7" rx="1" />
      <rect x="759" y="532" width="8" height="10" fill="#ef5350" opacity="0.7" rx="1" />
      <ellipse cx="650" cy="586" rx="80" ry="8" fill="#e06060" opacity="0.25" />
      <rect x="620" y="575" width="50" height="12" fill="#a9743f" stroke={OL} strokeWidth="1.5" rx="2" />
      {/* front door */}
      <rect x="858" y="525" width="56" height="67" fill="#9a6b3a" stroke={OL} strokeWidth="3" rx="2" />
      <rect x="864" y="530" width="18" height="28" fill="#7e5430" stroke={OL} strokeWidth="1.5" rx="1" />
      <rect x="889" y="530" width="18" height="28" fill="#7e5430" stroke={OL} strokeWidth="1.5" rx="1" />
      <circle cx="885" cy="562" r="4" fill="#ffd700" stroke={OL} strokeWidth="1.5" />
      <rect x="770" y="488" width="50" height="40" fill="#bfe9fb" stroke={OL} strokeWidth="2" />
      <line x1="795" y1="488" x2="795" y2="528" stroke={OL} strokeWidth="1.5" />
      <line x1="770" y1="508" x2="820" y2="508" stroke={OL} strokeWidth="1.5" />
      <Lantern x={500} y={490} />

      {/* ─── GARDEN (outdoor, left, ground level) ───────────────────────── */}
      {/* grassy patch blended into the hillside (no hard border) */}
      <ellipse cx="95" cy="604" rx="82" ry="28" fill="#74b14a" />
      <ellipse cx="95" cy="597" rx="66" ry="16" fill="#80bd54" />
      {/* back hedge */}
      <ellipse cx="48" cy="575" rx="24" ry="16" fill="#357a45" />
      <ellipse cx="82" cy="570" rx="27" ry="18" fill="#3a8a4c" />
      <ellipse cx="120" cy="576" rx="22" ry="15" fill="#357a45" />
      <ellipse cx="76" cy="564" rx="13" ry="8" fill="#46a058" opacity="0.7" />
      <ellipse cx="44" cy="570" rx="9"  ry="6" fill="#46a058" opacity="0.6" />
      {/* leafy tree at the far left */}
      <rect x="14" y="552" width="13" height="50" fill="#6b4a2e" stroke={OL} strokeWidth="2" />
      <polygon points="20,490 -8,562 48,562" fill="#357a45" stroke={OL} strokeWidth="2" />
      <polygon points="20,516 -2,556 42,556" fill="#3a8a4c" stroke={OL} strokeWidth="2" />
      <ellipse cx="14" cy="514" rx="7" ry="5" fill="#46a058" opacity="0.6" />
      {/* low picket fence */}
      {[34, 52, 70, 88, 106, 124, 142].map(x => (
        <g key={`gf-${x}`}>
          <rect x={x} y="578" width="7" height="22" fill="#caa06a" stroke={OL} strokeWidth="1.5" />
          <polygon points={`${x},578 ${x + 3.5},572 ${x + 7},578`} fill="#caa06a" stroke={OL} strokeWidth="1.5" />
        </g>
      ))}
      <rect x="32" y="584" width="118" height="4" fill="#b8905a" stroke={OL} strokeWidth="1" />
      <rect x="32" y="593" width="118" height="4" fill="#b8905a" stroke={OL} strokeWidth="1" />
      {/* flowers */}
      {[[60, 591, '#FF6B8A'], [98, 593, '#FFD93D'], [122, 590, '#E066FF'], [80, 596, '#66CCFF']].map(([fx, fy, fc], i) => (
        <g key={`gl-${i}`}>
          <rect x={fx} y={fy} width="2.5" height="9" fill="#2f6b3b" />
          <circle cx={fx + 1.2} cy={fy - 1} r="4" fill={fc} stroke={OL} strokeWidth="0.5" />
          <circle cx={fx + 1.2} cy={fy - 1} r="1.6" fill="#ffe066" />
        </g>
      ))}
      {/* stepping stones toward the house */}
      {[[150, 601], [140, 594], [132, 601]].map(([sx, sy], i) => (
        <ellipse key={`gp-${i}`} cx={sx} cy={sy} rx="8" ry="3.5" fill="#b9b1a0" stroke={OL} strokeWidth="1" />
      ))}

      {/* ─── TERRACE (outdoor, right, floor 3) ──────────────────────────── */}
      {/* wooden deck attached to the house wall */}
      <rect x="1000" y="268" width="150" height="11" fill="url(#floor)" stroke={OL} strokeWidth="2" />
      <rect x="1000" y="279" width="150" height="6" fill="#5e4128" stroke={OL} strokeWidth="1.5" />
      {/* support brackets so it reads as attached, not floating */}
      <polygon points="1002,285 1002,322 1030,285" fill="#5e4128" stroke={OL} strokeWidth="2" />
      <polygon points="1120,285 1148,285 1148,318" fill="#5e4128" stroke={OL} strokeWidth="2" />
      <rect x="1066" y="285" width="9" height="40" fill="#6b4a2e" stroke={OL} strokeWidth="1.5" />
      {/* railing */}
      <rect x="1003" y="222" width="8" height="47" fill="#7a5636" stroke={OL} strokeWidth="2" />
      <rect x="1139" y="222" width="8" height="47" fill="#7a5636" stroke={OL} strokeWidth="2" />
      <rect x="1003" y="222" width="144" height="6" fill="#8a6440" stroke={OL} strokeWidth="1.5" />
      <rect x="1003" y="251" width="144" height="5" fill="#8a6440" stroke={OL} strokeWidth="1.5" />
      {[1020, 1038, 1056, 1092, 1110, 1128].map(x => (
        <rect key={`tb-${x}`} x={x} y="228" width="4" height="24" fill="#caa06a" stroke={OL} strokeWidth="1" />
      ))}
      {/* bistro table + stool */}
      <rect x="1070" y="248" width="26" height="6" fill="#9b7fc0" stroke={OL} strokeWidth="1.5" rx="1" />
      <rect x="1081" y="254" width="4" height="13" fill="#7a5fa0" stroke={OL} strokeWidth="1" />
      <rect x="1100" y="252" width="13" height="6" fill="#8b6fb0" stroke={OL} strokeWidth="1.5" rx="1" />
      <rect x="1105" y="258" width="4" height="9" fill="#7a5fa0" stroke={OL} strokeWidth="1" />
      {/* potted plant */}
      <rect x="1018" y="252" width="18" height="15" fill="#b87333" stroke={OL} strokeWidth="1.5" rx="2" />
      <ellipse cx="1027" cy="247" rx="12" ry="11" fill="#3a8a4c" stroke={OL} strokeWidth="1.5" />
      <circle cx="1023" cy="243" r="3.5" fill="#FF6B8A" />
      <circle cx="1031" cy="245" r="3" fill="#FFD93D" />
      {/* cosy string lights */}
      <path d="M1006,226 Q1075,238 1144,226" fill="none" stroke="#5e4128" strokeWidth="1.5" />
      {[1024, 1050, 1076, 1102, 1126].map((x, i) => (
        <circle key={`tl-${i}`} cx={x} cy={i % 2 ? 234 : 232} r="2.6" fill="#ffe6a0" />
      ))}

      {/* outer border */}
      <rect x="160" y="100" width="840" height="500" fill="none" stroke={OL} strokeWidth="4" />
    </svg>
  );
});

/* ─── Main page ────────────────────────────────────────────────────────── */
export default function HomePage({ connectedRegisteredDevices = [], logs = [], colourByMac = new Map() }) {
  const devices = connectedRegisteredDevices;
  const wrapperRef = useRef(null);
  const [dims, setDims] = useState({ width: 1200, height: 700 });
  const [characters, setCharacters] = useState([]);
  const timersRef = useRef({});
  const speechTimersRef = useRef({});
  const charsRef = useRef([]);

  useEffect(() => {
    function measure() {
      if (!wrapperRef.current) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      setDims({ width: rect.width, height: (rect.width * 700) / 1200 });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  const deviceKey = devices.map(d => d.mac_address).sort().join(',');

  useEffect(() => {
    const existingIds = new Set(charsRef.current.map(c => c.id));
    const newIds = new Set(devices.map(d => d.mac_address));

    charsRef.current
      .filter(c => !newIds.has(c.id))
      .forEach(c => {
        if (timersRef.current[c.id]) clearTimeout(timersRef.current[c.id]);
        delete timersRef.current[c.id];
        if (speechTimersRef.current[c.id]) clearTimeout(speechTimersRef.current[c.id]);
        delete speechTimersRef.current[c.id];
      });

    const kept = charsRef.current.filter(c => newIds.has(c.id));
    const added = devices
      .filter(d => !existingIds.has(d.mac_address))
      .map(initCharacter);

    const merged = [...kept, ...added];
    charsRef.current = merged;
    setCharacters([...merged]);

    // Every cat without a live timer gets (re)scheduled — keeps everyone
    // moving even as people join/leave.
    merged.forEach(c => { if (!timersRef.current[c.id]) scheduleNext(c.id); });
  }, [deviceKey]);

  useEffect(() => () => {
    Object.values(timersRef.current).forEach(clearTimeout);
    Object.values(speechTimersRef.current).forEach(clearTimeout);
    timersRef.current = {};
    speechTimersRef.current = {};
  }, []);

  function applyUpdate(id, updates) {
    charsRef.current = charsRef.current.map(c => (c.id === id ? { ...c, ...updates } : c));
    setCharacters([...charsRef.current]);
  }

  const find = id => charsRef.current.find(c => c.id === id);

  /* Walk horizontally to newX, then run onDone. */
  function walk(id, newX, onDone) {
    const c = find(id);
    if (!c) return;
    const duration = Math.max(0.6, Math.abs(newX - c.x) / WALK_SPEED);
    applyUpdate(id, { state: 'walking', x: newX, dir: newX > c.x ? 1 : -1, walkDuration: duration, action: null });
    timersRef.current[id] = setTimeout(() => { if (find(id)) onDone(); }, duration * 1000);
  }

  /* Occasionally pop a short, room-flavoured speech bubble. */
  function maybeSpeak(id) {
    if (Math.random() > SPEAK_CHANCE) return;
    const c = find(id);
    if (!c) return;
    applyUpdate(id, { speech: pickSpeech(c.currentRoom) });
    if (speechTimersRef.current[id]) clearTimeout(speechTimersRef.current[id]);
    speechTimersRef.current[id] = setTimeout(() => {
      if (find(id)) applyUpdate(id, { speech: null });
    }, SPEAK_MS);
  }

  function rest(id) {
    applyUpdate(id, { state: 'idle', action: null, walkDuration: 0 });
    maybeSpeak(id);
    scheduleNext(id);
  }

  function scheduleNext(id) {
    if (timersRef.current[id]) clearTimeout(timersRef.current[id]);
    timersRef.current[id] = setTimeout(() => decide(id), rand(1200, 3600));
  }

  function decide(id) {
    const c = find(id);
    if (!c) return;
    const atHome = c.currentRoom === c.homeRoom;
    const roll = Math.random();

    if (!atHome && roll < 0.5) return travelTo(id, c.homeRoom);   // head home
    if (roll < 0.42) return goInteract(id);                       // use furniture
    if (roll < 0.72) return wanderInRoom(id);                     // pace the room
    const dest = ALL_ROOMS.filter(r => r !== c.currentRoom)[randInt(0, ALL_ROOMS.length - 2)];
    return travelTo(id, dest);                                    // take a trip
  }

  /* Pick an x within a room (optionally near `center`) that keeps a gap from
     other cats on `floor`, so people don't stand on top of each other. */
  function spacedX(room, floor, selfId, center = null, spread = 0) {
    const lo = center === null ? room.xMin + 2 : Math.max(room.xMin + 2, center - spread);
    const hi = center === null ? room.xMax - 2 : Math.min(room.xMax - 2, center + spread);
    const others = charsRef.current.filter(c => c.id !== selfId && c.currentFloor === floor);
    if (others.length === 0) return rand(lo, hi);
    let best = rand(lo, hi);
    let bestGap = -1;
    for (let i = 0; i < 12; i++) {
      const cand = rand(lo, hi);
      let nearest = Infinity;
      for (const o of others) nearest = Math.min(nearest, Math.abs(o.x - cand));
      if (nearest >= MIN_GAP) return cand;       // far enough from everyone
      if (nearest > bestGap) { bestGap = nearest; best = cand; }
    }
    return best;                                  // crowded room: least-bad spot
  }

  function wanderInRoom(id) {
    const c = find(id);
    if (!c) return;
    walk(id, spacedX(ROOMS[c.currentRoom], c.currentFloor, id), () => rest(id));
  }

  function goInteract(id) {
    const c = find(id);
    if (!c) return;
    const { anchor } = ROOMS[c.currentRoom];
    // cluster near the furniture but spread out if someone's already there
    walk(id, spacedX(ROOMS[c.currentRoom], c.currentFloor, id, anchor.x, 9), () => {
      applyUpdate(id, { state: 'interacting', action: anchor.action, walkDuration: 0 });
      maybeSpeak(id);
      timersRef.current[id] = setTimeout(() => { if (find(id)) rest(id); }, rand(2800, 5500));
    });
  }

  function travelTo(id, dest) {
    const c = find(id);
    if (!c) return;
    const to = ROOMS[dest];
    if (to.floor === c.currentFloor) {
      walk(id, spacedX(to, to.floor, id), () => { applyUpdate(id, { currentRoom: dest }); rest(id); });
      return;
    }
    // different floor → use the stairwell
    walk(id, STAIR_X, () => {
      applyUpdate(id, { state: 'onStairs', targetFloor: to.floor });
      timersRef.current[id] = setTimeout(() => {
        const cc = find(id);
        if (!cc) return;
        applyUpdate(id, { currentFloor: to.floor, targetFloor: null });
        walk(id, spacedX(to, to.floor, id), () => { applyUpdate(id, { currentRoom: dest }); rest(id); });
      }, 2000);
    });
  }

  const svgHeight = (dims.width * 700) / 1200;
  const totalCount = devices.length;
  // Cats are sized in absolute pixels, but the house SVG scales to fit the
  // container width. Multiply by (width / 1200) so cats stay proportional to
  // the house at any size — desktop (≈1200) is unchanged; phones shrink them.
  const scale = getCharScale(totalCount) * (dims.width / 1200);

  return (
    <div className="home-page">
      <p className="home-title">203/25 Halifax Home</p>
      <p className="home-subtitle">
        {totalCount === 0 ? 'No one home right now...' : `${totalCount} ${totalCount === 1 ? 'person' : 'people'} home`}
      </p>

      <div className="house-scene">
        <div className="house-wrapper" ref={wrapperRef} style={{ position: 'relative' }}>
          <HouseSVG />
          <div className="char-layer" style={{ height: svgHeight }}>
            {characters.map(char => (
              <Character key={char.id} char={char} containerWidth={dims.width} containerHeight={svgHeight} scale={scale} />
            ))}
          </div>
          <EventFeed logs={logs} colourByMac={colourByMac} />
        </div>
      </div>
    </div>
  );
}
