import React from 'react';

// AIRI's "Colorful Wave" background: cross grid + two drifting wave layers.
// Pure SVG/CSS so it costs nothing while the VRM renders.
export default function WaveBackground() {
  // one repeating wave path, 2x viewport wide, drifting left via CSS
  const wavePath = (amp, y) => {
    const seg = 480;
    let d = `M0 ${y}`;
    for (let x = 0; x < 3840; x += seg * 2) {
      d += ` Q ${x + seg / 2} ${y - amp} ${x + seg} ${y} T ${x + seg * 2} ${y}`;
    }
    return d + ` V 2000 H 0 Z`;
  };
  return (
    <>
      <div className="cross-grid" />
      <svg className="wave-svg wave-1" viewBox="0 0 1920 2000" preserveAspectRatio="none" aria-hidden="true">
        <path d={wavePath(60, 920)} fill="var(--wave-a)" />
      </svg>
      <svg className="wave-svg wave-2" viewBox="0 0 1920 2000" preserveAspectRatio="none" aria-hidden="true">
        <path d={wavePath(90, 1010)} fill="var(--wave-b)" />
      </svg>
    </>
  );
}
