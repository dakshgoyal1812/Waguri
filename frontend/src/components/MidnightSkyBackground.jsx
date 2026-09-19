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
        <div className="meteor m4" />
        <div className="meteor m5" />
        <div className="meteor m6" />
        <div className="meteor m7" />
        <div className="meteor m8" />
        <div className="meteor m9" />
        <div className="meteor m10" />
        <div className="meteor m11" />
        <div className="meteor m12" />

        <div className="moon">
          <svg viewBox="0 0 100 100" className="moon-svg" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <mask id="crescentMask">
                <rect width="100" height="100" fill="#ffffff" />
                <circle cx="40" cy="46" r="32" fill="#000000" />
              </mask>
              <linearGradient id="moonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="50%" stopColor="#fffad1" />
                <stop offset="100%" stopColor="#fce085" />
              </linearGradient>
              <radialGradient id="moonAura" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#fff8db" stopOpacity="0.4" />
                <stop offset="60%" stopColor="#fde68a" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#fde68a" stopOpacity="0" />
              </radialGradient>
            </defs>
            {/* Ambient soft glow aura */}
            <circle cx="50" cy="50" r="48" fill="url(#moonAura)" />
            {/* Smooth luminous crescent moon body */}
            <circle cx="50" cy="50" r="36" fill="url(#moonGradient)" mask="url(#crescentMask)" />
            {/* Soft craters on visible crescent */}
            <g mask="url(#crescentMask)" opacity="0.32">
              <circle cx="62" cy="42" r="3.2" fill="#d4be68" />
              <circle cx="67" cy="55" r="4.2" fill="#d4be68" />
              <circle cx="58" cy="68" r="3" fill="#d4be68" />
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
