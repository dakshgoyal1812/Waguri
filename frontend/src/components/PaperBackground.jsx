import React from 'react';

export default function PaperBackground() {
  return (
    <div className="light-paper-pattern" aria-hidden="true">
      <div className="container" />
      <div className="paper">
        <span className="orbit-overlay" />
        <svg className="texture-filter">
          <filter id="void-texture">
            <feTurbulence
              seed="5"
              result="noise1"
              numOctaves="8"
              baseFrequency="0.015"
              type="fractalNoise"
            />
            <feTurbulence
              seed="2"
              result="noise2"
              numOctaves="8"
              baseFrequency="0.015"
              type="fractalNoise"
            />
            <feMerge result="noise">
              <feMergeNode in="noise1" />
              <feMergeNode in="noise1" />
              <feMergeNode in="noise2" />
            </feMerge>
            <feGaussianBlur
              result="blur"
              stdDeviation="0"
              in="noise"
            />
            <feSpecularLighting
              result="specular"
              lightingColor="#ffffff"
              specularExponent="20"
              specularConstant="1"
              surfaceScale="3"
              in="blur"
            >
              <feDistantLight elevation="45" azimuth="90" />
            </feSpecularLighting>
            <feComposite
              result="lit"
              operator="over"
              in2="SourceGraphic"
              in="specular"
            />
            <feBlend mode="screen" in2="lit" in="SourceGraphic" />
          </filter>

          <filter id="alt-void-texture">
            <feTurbulence
              repeatCount="indefinite"
              dur="6s"
              values="0.015; 0.02; 0.015"
              attributeName="baseFrequency"
              seed="2"
              result="noise1"
              numOctaves="8"
              baseFrequency="0.015"
              type="fractalNoise"
            />
            <feTurbulence
              repeatCount="indefinite"
              dur="6s"
              values="0.015; 0.02; 0.015"
              attributeName="baseFrequency"
              seed="1"
              result="noise2"
              numOctaves="8"
              baseFrequency="0.015"
              type="fractalNoise"
            />
            <feMerge result="noise">
              <feMergeNode in="noise1" />
              <feMergeNode in="noise1" />
              <feMergeNode in="noise2" />
            </feMerge>
            <feGaussianBlur
              result="blur"
              stdDeviation="0"
              in="noise"
            />
            <feSpecularLighting
              result="specular"
              lightingColor="#ffeeff"
              specularExponent="20"
              specularConstant="1"
              surfaceScale="3"
              in="blur"
            >
              <feDistantLight elevation="45" azimuth="90" />
            </feSpecularLighting>
            <feComposite
              result="lit"
              operator="over"
              in2="SourceGraphic"
              in="specular"
            />
            <feBlend mode="screen" in2="lit" in="SourceGraphic" />
          </filter>
        </svg>
      </div>
    </div>
  );
}
