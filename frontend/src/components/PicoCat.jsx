/* Darken / lighten a hex colour for outlines & highlights. */
export function shade(hex, f) {
  const n = parseInt((hex || '#4D96FF').slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* ─── Pico cat sprite (matches reference: notched ears, black eyes,
       white mouth, foot) — outline & highlight derived from colour. ───── */
export function PicoCat({ colour, dir = 1, pose = 'stand', eyes = 'open', size = 1 }) {
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
