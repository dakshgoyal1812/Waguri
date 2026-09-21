// DEV-ONLY harness (not part of the build): renders the real AvatarCanvas +
// VRMPicker without the Google auth gate so avatar switching can be tested in
// a browser. Open /dev-avatar-harness.html?vrm=zero while running `vite`.
// Safe to delete — vite build never includes it (only index.html is an entry).
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { UserRound } from 'lucide-react';
import AvatarCanvas from './components/AvatarCanvas.jsx';
import VRMPicker from './components/VRMPicker.jsx';
import PaperBackground from './components/PaperBackground.jsx';
import { BUNDLED_AVATARS, DEFAULT_VRM_URL, getCustomVrmBlob, saveCustomVrm, listCustomVrms, deleteCustomVrm } from './lib/vrmStore.js';
import { useVoiceInput } from './useVoiceInput.js';
import './index.css';

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('vrm') === 'zero' ? 'zero' : 'waguri';
  const [activeId, setActiveId] = useState(initial);
  const activeIdRef = useRef(initial);
  activeIdRef.current = activeId;
  const [vrmUrl, setVrmUrl] = useState(DEFAULT_VRM_URL);
  const [pickerOpen, setPickerOpen] = useState(params.get('picker') === '1');
  const [emotion, setEmotion] = useState('relaxed');
  const objectUrls = useRef(new Map());

  useEffect(() => {
    const bundled = BUNDLED_AVATARS.find((a) => a.id === activeId);
    if (bundled) { setVrmUrl(bundled.url); return; }
    getCustomVrmBlob(activeId)
      .then((blob) => {
        let url = objectUrls.current.get(activeId);
        if (!url) { url = URL.createObjectURL(blob); objectUrls.current.set(activeId, url); }
        setVrmUrl(url);
      })
      .catch(() => setActiveId('waguri'));
  }, [activeId]);

  const [handsFree, setHandsFree] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const voice = useVoiceInput({
    enabled: handsFree,
    paused: false,
    onFinalTranscript: (text) => setTranscripts((t) => [...t, text]),
    lang: 'en-IN',
  });

  // Expose the active emotion & voice for probing from the console/tools
  useEffect(() => {
    window.__harness = {
      setEmotion,
      select: (id) => setActiveId(id),
      activeId: () => activeIdRef.current,
      testCustomFlow: async () => {
        const blob = await (await fetch('/waguri.vrm')).blob();
        const file = new File([blob], 'CustomTest.vrm', { type: 'model/gltf-binary' });
        const meta = await saveCustomVrm(file);
        setActiveId(meta.id);
        return meta;
      },
      listCustom: () => listCustomVrms(),
      deleteCustom: (id) => deleteCustomVrm(id),
      voice,
    };
  }, [voice]);

  useEffect(() => {
    document.title = `harness:${activeId}`;
  }, [activeId]);

  return (
    <div className="stage">
      <div className="bg-layer">
        <PaperBackground />
      </div>
      <div className="ambient-glow" />
      <AvatarCanvas currentEmotion={emotion} chatOpen={false} vrmUrl={vrmUrl} />
      <button
        type="button"
        className="vrm-fab"
        onClick={() => setPickerOpen(true)}
        title="Add or change VRM avatar"
        aria-label="Add or change VRM avatar"
      >
        <UserRound size={19} />
        <span className="vrm-fab__label">Avatar</span>
      </button>

      {/* Mic Test Button & Status in Harness */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '8px',
          zIndex: 100,
        }}
      >
        {transcripts.length > 0 && (
          <div
            style={{
              maxWidth: '320px',
              padding: '6px 12px',
              background: 'rgba(255, 255, 255, 0.92)',
              borderRadius: '12px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              fontSize: '0.8rem',
              color: '#334155',
            }}
          >
            <strong>Last transcript:</strong> "{transcripts[transcripts.length - 1]}"
          </div>
        )}
        {voice.voiceError && (
          <div
            style={{
              padding: '4px 10px',
              background: 'rgba(254, 226, 226, 0.95)',
              border: '1px solid #f87171',
              borderRadius: '8px',
              fontSize: '0.75rem',
              color: '#b91c1c',
            }}
          >
            ⚠️ {voice.voiceError}
          </div>
        )}
        <button
          type="button"
          id="test-mic-btn"
          onClick={() => setHandsFree((h) => !h)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 18px',
            borderRadius: '9999px',
            border: 'none',
            background: handsFree ? 'linear-gradient(135deg, #ec4899, #8b5cf6)' : '#ffffff',
            color: handsFree ? '#ffffff' : '#334155',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: '0.85rem',
          }}
        >
          {handsFree ? (voice.isSpeaking ? '🎤 Hearing you…' : '🎙️ Mic Active') : '🔇 Mic Off'}
          {handsFree && (
            <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>({voice.volumeLevel}%)</span>
          )}
        </button>
      </div>

      <VRMPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        activeId={activeId}
        onSelect={(id) => { setActiveId(id); setPickerOpen(false); }}
      />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
