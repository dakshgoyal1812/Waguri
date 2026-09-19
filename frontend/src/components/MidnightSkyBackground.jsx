import React from 'react';

export default function MidnightSkyBackground() {
  return (
    <div className="uiverse-midnight-sky" aria-hidden="true">
      <div className="sky-canvas">
        <div className="stars stars-1" />
        <div className="stars stars-2" />
        <div className="stars stars-3" />

        <div className="meteor m1" />
        <div className="meteor m2" />
        <div className="meteor m3" />

        <div className="moon" />
      </div>
    </div>
  );
}
