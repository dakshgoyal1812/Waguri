import React from 'react';

export default function BirdLoader({ progress = 0 }) {
  return (
    <div className="vrm-loading-overlay">
      <div className="bird-scene">
        <div id="sky">
          <div className="bird">
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>
            <div className="wind"></div>

            <div className="bird_body">
              <div className="bird_head"></div>

              <div className="bird_wing_left">
                <div className="bird_wing_left_top"></div>
              </div>

              <div className="bird_wing_right">
                <div className="bird_wing_right_top"></div>
              </div>

              <div className="bird_tail_left"></div>
              <div className="bird_tail_right"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="vrm-loading-status">
        <h3 className="vrm-loading-title">WAGURI</h3>
        <p className="vrm-loading-text">
          Loading 3D Avatar... {progress}%
        </p>
        <div className="vrm-loading-progress-bar">
          <div
            className="vrm-loading-progress-fill"
            style={{ width: `${Math.max(6, Math.min(100, progress))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
