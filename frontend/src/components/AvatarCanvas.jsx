import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
// The shipped waguri.vrm is optimized with EXT_meshopt_compression; GLTFLoader
// refuses the file unless a decoder is provided (no-op for non-meshopt models).
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import BirdLoader from './BirdLoader.jsx';

const EMOTION_PRESETS = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral'];
const VISEME_PRESETS = ['aa', 'ih', 'ou', 'ee', 'oh'];

// ---- emotion blends ----
// Visemes (aa/ih/ou/ee/oh) are strictly audio-driven and never injected into idle
// emotion blends so Waguri's mouth stays naturally closed when she isn't speaking.
// In waguri.vrm (VRoid standard), 'relaxed' (Fcl_ALL_Fun) gives a sweet anime smile
// with lips closed, while 'happy' (Fcl_ALL_Joy) is an open laugh.
const EMOTION_BLENDS = {
  happy:     [{ name: 'relaxed', value: 0.65 }],
  excited:   [{ name: 'relaxed', value: 0.75 }, { name: 'surprised', value: 0.2 }],
  sad:       [{ name: 'sad', value: 0.7 }],
  angry:     [{ name: 'angry', value: 0.7 }],
  surprised: [{ name: 'surprised', value: 0.6 }],
  relaxed:   [{ name: 'relaxed', value: 0.65 }],
  neutral:   [{ name: 'neutral', value: 1.0 }],
  curious:   [{ name: 'surprised', value: 0.25 }, { name: 'relaxed', value: 0.4 }],
  playful:   [{ name: 'relaxed', value: 0.7 }],
  think:     [{ name: 'relaxed', value: 0.4 }, { name: 'sad', value: 0.15 }],
};

// ---- eye saccades (ported verbatim from airi's eye-motions.ts) ----
// Micro eye-darts between randomized intervals, weighted toward short gaps.
const EYE_SACCADE_INT_STEP = 400;
const EYE_SACCADE_INT_P = [
  [0.075, 800],
  [0.110, 0],
  [0.125, 0],
  [0.140, 0],
  [0.125, 0],
  [0.050, 0],
  [0.040, 0],
  [0.030, 0],
  [0.020, 0],
  [1.000, 0],
];
for (let i = 1; i < EYE_SACCADE_INT_P.length; i++) {
  EYE_SACCADE_INT_P[i][0] += EYE_SACCADE_INT_P[i - 1][0];
  EYE_SACCADE_INT_P[i][1] = EYE_SACCADE_INT_P[i - 1][1] + EYE_SACCADE_INT_STEP;
}
function randomSaccadeInterval() {
  const r = Math.random();
  for (let i = 0; i < EYE_SACCADE_INT_P.length; i++) {
    if (r <= EYE_SACCADE_INT_P[i][0]) {
      return EYE_SACCADE_INT_P[i][1] + Math.random() * EYE_SACCADE_INT_STEP;
    }
  }
  return EYE_SACCADE_INT_P[EYE_SACCADE_INT_P.length - 1][1] + Math.random() * EYE_SACCADE_INT_STEP;
}

// ---- wLipSync-style vowel competition ----
// airi drives the mouth by detecting the DOMINANT vowel (A/E/I/O/U -> aa/ee/ih/
// oh/ou) from audio formants; only that viseme opens. We reproduce the same
// one-vowel-wins architecture from our AnalyserNode: score each vowel by the
// product of its two formant-band energies (F1×F2), keep the winner with
// hysteresis so the mouth doesn't flicker between similar vowels.
const VOWEL_FORMANTS = {
  // viseme: [F1 Hz, F2 Hz]
  aa: [800, 1200],
  ee: [500, 2000],
  ih: [320, 2300],
  oh: [500, 850],
  ou: [320, 900],
};

// Cursor eye-tracking is desktop-only (acceptance: disabled on touch/mobile).
const EYE_TRACKING_QUERY = '(pointer: fine)';

export default function AvatarCanvas({
  currentEmotion = 'neutral',
  audioElement = null,
  isSpeaking = false,
  chatOpen = true,
  onModelLoaded = () => {},
}) {
  const mountRef = useRef(null);
  const vrmRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [retryKey, setRetryKey] = useState(0); // bumped by the Retry button

  // The rAF loop below runs in a mount-only effect, so props it reads must arrive
  // via refs — a bare closure would capture the first render's values forever and
  // emotions/lip-sync would never react to new props.
  const emotionRef = useRef(currentEmotion);
  const speakingRef = useRef(isSpeaking);
  const chatOpenRef = useRef(chatOpen);
  useEffect(() => { emotionRef.current = currentEmotion; }, [currentEmotion]);
  useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  // Smoothed audio loudness (0..1) — drives the whole-body speech emphasis so she
  // doesn't just move her mouth when talking (airi-style full-body "aliveness").
  const energyRef = useRef(0);

  // Expression target weights for smooth lerping
  const expressionWeights = useRef({
    happy: 0,
    angry: 0,
    sad: 0,
    surprised: 0,
    relaxed: 0,
    neutral: 1,
    aa: 0,
    ih: 0,
    ou: 0,
    ee: 0,
    oh: 0,
    blink: 0,
  });

  // Blink state (2-6s randomized, occasional double-blink, slower while speaking)
  const blinkState = useRef({
    nextBlinkTime: 2.0,
    isBlinking: false,
    blinkProgress: 0,
  });

  // Cursor eye-tracking: normalized mouse position + smoothed lean targets
  const lookState = useRef({
    enabled: typeof window !== 'undefined' && window.matchMedia?.(EYE_TRACKING_QUERY).matches,
    rawX: 0, rawY: 0,          // latest mousemove, normalized [-1, 1]
    smoothX: 0, smoothY: 0,    // damped values used by the rAF loop
    lastMoveAt: 0,             // fall back to ambient eye motion when quiet
  });

  // Eye saccades (airi eye-motions): tiny eye darts layered on the gaze when the
  // cursor is idle — eyes-only, the head stays put, which is what reads as "alive".
  const saccadeState = useRef({ nextAt: 800, until: 0, dx: 0, dy: 0, x: 0, y: 0 });

  // wLipSync competition state: the currently winning vowel (hysteresis anchor).
  const lipVowelRef = useRef('aa');

  // Idle micro-gesture state machine (subtle head tilt / weight shift)
  const gestureState = useRef({
    nextAt: 5.0,
    type: null,        // 'headTiltL' | 'headTiltR' | 'headTiltNod' | 'weightShift'
    t: 0,              // seconds since gesture start
    duration: 3.0,
  });

  // Entrance animation (greeting bow) after a successful model load
  const entranceState = useRef({ active: false, t: 0, duration: 2.4 });

  // Setup Web Audio Lip-Sync Analyser.
  // The listener is PERSISTENT (not `{ once: true }`) and re-arms on every play:
  // an AudioContext created without a user gesture starts suspended (silent audio
  // AND a silent analyser), and a one-shot init that failed would disable
  // lip-sync for the whole session. Resuming on each play keeps both healthy.
  useEffect(() => {
    if (!audioElement) return;

    const setupAudio = () => {
      try {
        if (!audioCtxRef.current) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          audioCtxRef.current = new AudioContext();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }

        // createMediaElementSource is legal exactly ONCE per element — guard by
        // element identity so re-plays and prop re-renders never re-create it.
        if (!sourceNodeRef.current || sourceNodeRef.current.__element !== audioElement) {
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.5;

          const source = ctx.createMediaElementSource(audioElement);
          source.__element = audioElement;
          source.connect(analyser);
          analyser.connect(ctx.destination);

          sourceNodeRef.current = source;
          analyserRef.current = analyser;
        }
      } catch (err) {
        // "source already created" is benign (analyser from the first setup is
        // still live); anything else leaves lip-sync off but audio untouched.
        if (!sourceNodeRef.current) {
          console.warn('[AvatarCanvas] AudioContext / Analyser init failed:', err.message);
        }
      }
    };

    audioElement.addEventListener('play', setupAudio);
    // If the element is ALREADY playing when we attach (race with App state),
    // initialize immediately instead of waiting for the next play event.
    if (!audioElement.paused) setupAudio();
    return () => {
      audioElement.removeEventListener('play', setupAudio);
    };
  }, [audioElement]);

  // Cursor & touch eye-tracking input (mousemove + touchstart/touchmove)
  useEffect(() => {
    if (!lookState.current.enabled) return;
    const onMove = (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;   // [-1, 1]
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      lookState.current.rawX = Math.max(-1, Math.min(1, nx));
      lookState.current.rawY = Math.max(-1, Math.min(1, ny));
      lookState.current.lastMoveAt = performance.now();
      document.documentElement.style.setProperty('--bg-pan-x', `${-nx * 18}px`);
      document.documentElement.style.setProperty('--bg-pan-y', `${-ny * 14}px`);
    };
    const onTouch = (e) => {
      if (e.touches && e.touches[0]) {
        const t = e.touches[0];
        const nx = (t.clientX / window.innerWidth) * 2 - 1;
        const ny = (t.clientY / window.innerHeight) * 2 - 1;
        lookState.current.rawX = Math.max(-1, Math.min(1, nx));
        lookState.current.rawY = Math.max(-1, Math.min(1, ny));
        lookState.current.lastMoveAt = performance.now();
        document.documentElement.style.setProperty('--bg-pan-x', `${-nx * 18}px`);
        document.documentElement.style.setProperty('--bg-pan-y', `${-ny * 14}px`);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchstart', onTouch);
      window.removeEventListener('touchmove', onTouch);
    };
  }, []);

  // Main Three.js Scene Setup (re-runs on retryKey for the failure retry button)
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let width = container.clientWidth || 400;
    let height = container.clientHeight || 500;

    const scene = new THREE.Scene();

    // Responsive camera framing for phones vs desktop
    const getTargetCameraParams = (w, h, isChatOpen) => {
      const isMobile = w <= 768 || (w / h) < 0.9;
      if (!isMobile) {
        // Desktop: centered head-to-waist framing
        return {
          pos: new THREE.Vector3(0, 1.28, 1.45),
          look: new THREE.Vector3(0, 1.12, 0),
          fov: 32,
        };
      }
      if (isChatOpen) {
        // Phone with chat bottom sheet open:
        // Position Waguri prominently in the top ~50% open screen above the chat card
        return {
          pos: new THREE.Vector3(0, 1.16, 1.90),
          look: new THREE.Vector3(0, 0.96, 0),
          fov: 34,
        };
      }
      // Phone with chat closed (full portrait view):
      // Elegant full portrait framing head-to-waist on vertical phone screen
      return {
        pos: new THREE.Vector3(0, 1.20, 2.15),
        look: new THREE.Vector3(0, 1.05, 0),
        fov: 33,
      };
    };

    const currentLook = new THREE.Vector3(0, 1.12, 0);
    const initialParams = getTargetCameraParams(width, height, chatOpenRef.current);

    const camera = new THREE.PerspectiveCamera(initialParams.fov, width / height, 0.1, 20);
    camera.position.copy(initialParams.pos);
    currentLook.copy(initialParams.look);
    camera.lookAt(currentLook);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff0f5, 1.6);
    keyLight.position.set(1.0, 2.0, 1.5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe0e7ff, 0.9);
    fillLight.position.set(-1.0, 1.5, 1.0);
    scene.add(fillLight);

    // Eye-tracking look target: a point in front of her face the eyes follow
    const lookTarget = new THREE.Object3D();
    lookTarget.position.set(0, 1.34, 2.5);
    scene.add(lookTarget);

    let disposed = false;
    let cleanupModel = null;

    // Load VRM Avatar
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      '/waguri.vrm',
      (gltf) => {
        if (disposed) return;
        const vrm = gltf.userData.vrm;
        if (!vrm) {
          setLoadError('VRM data not found in gltf payload');
          return;
        }

        // VRM 1.0 optimization (best-effort; interleaved buffers are safely skipped)
        try {
          VRMUtils.removeUnnecessaryVertices(gltf.scene);
        } catch {
          // Interleaved buffers cannot be pruned by VRMUtils; benign and safe to skip
        }
        try {
          VRMUtils.removeUnnecessaryJoints(gltf.scene);
        } catch {
          // Benign and safe to skip
        }

        // Position avatar
        vrm.scene.position.set(0, 0, 0);
        vrm.scene.rotation.y = 0; // facing camera
        scene.add(vrm.scene);

        if (vrm.lookAt) vrm.lookAt.target = lookTarget; // cursor eye-tracking

        vrmRef.current = vrm;
        setIsLoaded(true);
        entranceState.current = { active: true, t: 0, duration: 2.4 }; // greeting bow
        onModelLoaded(vrm);

        // Tiny debug/verification probe (harmless in prod): lets a console or
        // test check that visemes actually move while she speaks.
        window.__waguriAvatar = {
          loaded: () => !!vrmRef.current,
          speaking: () => speakingRef.current,
          energy: () => energyRef.current,
          visemes: () => {
            const { aa, ih, ou, ee, oh } = expressionWeights.current;
            return { aa, ih, ou, ee, oh };
          },
        };

        console.log('[AvatarCanvas] Waguri VRM 1.0 model loaded successfully');
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          setLoadProgress(pct);
        } else {
          setLoadProgress((p) => Math.min(95, p + 10));
        }
      },
      (error) => {
        if (disposed) return;
        console.error('[AvatarCanvas] VRM loading error:', error);
        setLoadError(error.message || 'Failed to load VRM model');
      }
    );

    cleanupModel = () => {
      const vrm = vrmRef.current;
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
        vrmRef.current = null;
      }
      delete window.__waguriAvatar;
    };

    // Handle Window Resize
    const handleResize = () => {
      if (!container) return;
      width = container.clientWidth;
      height = container.clientHeight;
      camera.aspect = width / height;
      const targetParams = getTargetCameraParams(width, height, chatOpenRef.current);
      camera.fov = targetParams.fov;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    window.addEventListener('resize', handleResize);

    // Animation Loop
    const clock = new THREE.Clock();
    let animId = null;
    const freqData = new Uint8Array(256);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Smooth camera interpolation for responsive phone/desktop & chat toggle transitions
      const targetParams = getTargetCameraParams(width, height, chatOpenRef.current);
      const camLerpSpeed = Math.min(1, delta * 3.5);
      camera.position.lerp(targetParams.pos, camLerpSpeed);
      currentLook.lerp(targetParams.look, camLerpSpeed);
      camera.lookAt(currentLook);
      if (Math.abs(camera.fov - targetParams.fov) > 0.05) {
        camera.fov += (targetParams.fov - camera.fov) * camLerpSpeed;
        camera.updateProjectionMatrix();
      }

      const vrm = vrmRef.current;
      if (vrm) {
        const humanoid = vrm.humanoid;

        // ---- cursor eye-tracking (damped, clamped to human ranges: 30° H / 20° V) ----
        const look = lookState.current;
        const cursorIdle = performance.now() - look.lastMoveAt > 4000;
        if (look.enabled) {
          const k = Math.min(1, delta * 4); // frame-rate-independent damping — no jitter
          const targetX = cursorIdle ? 0 : look.rawX;
          const targetY = cursorIdle ? 0 : look.rawY;
          look.smoothX += (targetX - look.smoothX) * k;
          look.smoothY += (targetY - look.smoothY) * k;
        }

        // Eyes-only cursor tracking (airi lookAt style): the EYES follow the
        // cursor fully; the head only leans a tiny ~4° for organic feel.
        const lookYaw = look.enabled ? THREE.MathUtils.clamp(look.smoothX * 0.5, -0.52, 0.52) : 0;   // eyes ≤30°
        const lookPitch = look.enabled ? THREE.MathUtils.clamp(-look.smoothY * 0.34, -0.35, 0.35) : 0; // eyes ≤20°
        const headYawFromCursor = look.enabled ? lookYaw * 0.12 : 0;   // head barely follows
        const headPitchFromCursor = look.enabled ? lookPitch * 0.12 : 0;

        // ---- eye saccades (airi port): ambient micro darts when the cursor is idle ----
        const sac = saccadeState.current;
        const nowMs = performance.now();
        if (nowMs > sac.nextAt) {
          sac.dx = (Math.random() * 2 - 1) * 0.4;
          sac.dy = (Math.random() * 2 - 1) * 0.22;
          sac.until = nowMs + 150 + Math.random() * 400;
          sac.nextAt = nowMs + randomSaccadeInterval();
        }
        const saccActive = nowMs < sac.until && (cursorIdle || !look.enabled);
        const sacK = Math.min(1, delta * 14);
        sac.x += ((saccActive ? sac.dx : 0) - sac.x) * sacK;
        sac.y += ((saccActive ? sac.dy : 0) - sac.y) * sacK;

        // Eyes track the cursor AND the saccade layer; the head only follows the
        // cursor (saccades are eye-darts — head motion would look like staring).
        const gazeX = (look.enabled ? look.smoothX : 0) + sac.x;
        const gazeY = (look.enabled ? look.smoothY : 0) + sac.y;
        lookTarget.position.set(gazeX * 2.2, 1.34 - gazeY * 1.1, 2.5);

        // ---- 1. Audio Lip-Sync analysis (runs FIRST so the body layers below can
        //         ride the same voice energy — the whole body moves when she talks).
        const lipTargets = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
        let frameEnergy = 0;

        if (analyserRef.current && speakingRef.current) {
          analyserRef.current.getByteFrequencyData(freqData);

          // RMS level with airi's 0.08 gate: silence keeps the mouth shut.
          let sumSquares = 0;
          for (let i = 0; i < freqData.length; i++) {
            const v = freqData[i] / 255;
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / freqData.length);
          const level = Math.min(1, rms * 3.2);

          if (level > 0.08) {
            // Formant-proxy energies around each vowel's F1/F2 pair.
            const binHz = audioCtxRef.current ? audioCtxRef.current.sampleRate / freqData.length / 2 : 46.9;
            const band = (center, width) => {
              const c = center / binHz;
              const w = Math.max(1, width / binHz);
              let s = 0, n = 0;
              for (let i = Math.max(1, Math.floor(c - w)); i <= Math.min(freqData.length - 1, Math.ceil(c + w)); i++) {
                s += freqData[i]; n++;
              }
              return n ? s / (n * 255) : 0;
            };
            const e = {};
            for (const [vowel, [f1, f2]] of Object.entries(VOWEL_FORMANTS)) {
              e[vowel] = band(f1, 170) * band(f2, 260); // both formants present -> strong score
            }
            // Dominant vowel wins; hysteresis keeps the current vowel unless the
            // challenger clearly beats it (prevents aa<->oh flicker).
            let best = lipVowelRef.current, bestScore = e[best] * 1.15;
            for (const vowel of Object.keys(e)) {
              if (e[vowel] > bestScore) { best = vowel; bestScore = e[vowel]; }
            }
            lipVowelRef.current = best;

            // Only the winning viseme opens; natural opening scaled to volume (capped at 0.58 so mouth never overstretches)
            const speechFactor = Math.min(1, Math.max(0, (level - 0.08) / 0.7));
            lipTargets[best] = Math.min(0.58, 0.15 + speechFactor * 0.40);
            frameEnergy = level;
          }
        }

        // Asymmetric energy envelope — attacks fast with the voice, decays gently.
        const energy = energyRef.current;
        const energyK = Math.min(1, delta * (frameEnergy > energy ? 18 : 5));
        energyRef.current = energy + (frameEnergy - energy) * energyK;
        const voiceEnergy = energyRef.current;

        // ---- 2. Idle micro-gestures (feeling layer: she fidgets when YOU are
        //         inactive; paused while she speaks so lip-sync stays the focus) ----
        const g = gestureState.current;
        let gestureHeadZ = 0, gestureHeadX = 0, gestureHipsZ = 0;
        if (!entranceState.current.active && !speakingRef.current) {
          if (g.type === null && elapsed > g.nextAt) {
            const roll = Math.random();
            g.type = roll < 0.35 ? 'headTiltL' : roll < 0.7 ? 'headTiltR' : roll < 0.85 ? 'headTiltNod' : 'weightShift';
            g.t = 0;
            g.duration = 2.6 + Math.random() * 1.6;
          }
          if (g.type) {
            g.t += delta;
            // smooth envelope: rise, hold, fall
            const env = Math.max(0, Math.min(1, Math.min(g.t / 0.8, (g.duration - g.t) / 0.8)));
            if (g.type === 'headTiltL') gestureHeadZ = 0.09 * env;
            else if (g.type === 'headTiltR') gestureHeadZ = -0.09 * env;
            else if (g.type === 'headTiltNod') gestureHeadX = 0.05 * env;
            else if (g.type === 'weightShift') { gestureHipsZ = 0.02 * env; gestureHeadZ = 0.03 * env; }
            if (g.t >= g.duration) {
              g.type = null;
              g.nextAt = elapsed + 6 + Math.random() * 6;
            }
          }
        }

        // ---- 3. WHOLE-BODY motion (airi-style stage presence) ----
        // Breathing (chest/shoulders), slow whole-body sway and weight transfer
        // (spine/hips), arm/hand micro-sway — plus a voice-driven emphasis layer
        // so she leans and nods with her speech instead of talking "from the neck up".
        if (humanoid) {
          const breath = Math.sin(elapsed * 2.2);        // ~21/min chest cycle
          const sway = Math.sin(elapsed * 0.45);         // slow ~14s torso drift
          const weight = Math.sin(elapsed * 0.23);       // even slower weight transfer

          const chest = humanoid.getNormalizedBoneNode('chest');
          const spine = humanoid.getNormalizedBoneNode('spine');
          const head = humanoid.getNormalizedBoneNode('head');
          const hips = humanoid.getNormalizedBoneNode('hips');
          const lShoulder = humanoid.getNormalizedBoneNode('leftShoulder');
          const rShoulder = humanoid.getNormalizedBoneNode('rightShoulder');

          if (chest) chest.rotation.x = breath * 0.02 + voiceEnergy * 0.012;
          if (spine) {
            spine.rotation.x = breath * 0.012 + voiceEnergy * 0.02;
            spine.rotation.y = sway * 0.045
              + (speakingRef.current ? Math.sin(elapsed * 2.1) * 0.025 * voiceEnergy : 0);
          }
          if (hips) {
            hips.rotation.y = sway * 0.03;               // whole body drifts with the torso
            hips.rotation.z = weight * 0.015 + gestureHipsZ;
          }
          if (lShoulder) lShoulder.rotation.z = breath * 0.03;
          if (rShoulder) rShoulder.rotation.z = -breath * 0.03;
          if (head) {
            // Idle sway (softened while tracking) + gesture offsets; the cursor
            // moves her EYES — the head only gets the tiny organic follow. While
            // speaking she nods subtly on the voice envelope (~1.4 Hz).
            const swayScale = look.enabled ? 0.4 : 1;
            head.rotation.y = Math.sin(elapsed * 0.7) * 0.02 * swayScale + headYawFromCursor;
            head.rotation.z = Math.cos(elapsed * 0.9) * 0.01 * swayScale + gestureHeadZ;
            head.rotation.x = Math.sin(elapsed * 0.5) * 0.008 + headPitchFromCursor + gestureHeadX
              + (speakingRef.current ? Math.sin(elapsed * 8.5) * 0.03 * voiceEnergy : 0);
          }

          // Natural arm rest pose — applied EVERY frame so the idle loop never
          // snaps back to the VRM's stiff T-pose, with breathing-coupled micro-sway.
          const lUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
          const rUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
          const lLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
          const rLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
          const lHand = humanoid.getNormalizedBoneNode('leftHand');
          const rHand = humanoid.getNormalizedBoneNode('rightHand');
          if (lUpperArm) lUpperArm.rotation.set(-0.06 + breath * 0.01, 0, -1.22 + breath * 0.025);
          if (rUpperArm) rUpperArm.rotation.set(-0.06 + breath * 0.01, 0, 1.22 - breath * 0.025);
          // negative X bends the hanging forearm forward (+Z)
          if (lLowerArm) lLowerArm.rotation.set(-0.26, 0, -0.05);
          if (rLowerArm) rLowerArm.rotation.set(-0.26, 0, 0.05);
          if (lHand) lHand.rotation.set(0, 0, -0.08 + Math.sin(elapsed * 1.3) * 0.02);
          if (rHand) rHand.rotation.set(0, 0, 0.08 + Math.sin(elapsed * 1.3 + 1.7) * 0.02);
        }

        // ---- 3a. Entrance greeting bow (on model load): spine bows, head dips, a
        //          little hold, then release — forced [happy] face below while it plays.
        const ent = entranceState.current;
        let entranceBow = 0;
        if (ent.active) {
          ent.t += delta;
          const t = ent.t;
          const bowIn = Math.min(1, t / 0.7);
          const bowOut = Math.min(1, Math.max(0, (t - (ent.duration - 0.8)) / 0.8));
          entranceBow = 0.38 * bowIn * (1 - bowOut);
          const spine = humanoid?.getNormalizedBoneNode('spine');
          const head = humanoid?.getNormalizedBoneNode('head');
          if (spine) spine.rotation.x += entranceBow;
          if (head) head.rotation.x += entranceBow * 0.35;
          if (t >= ent.duration) ent.active = false;
        }

        // ---- 4. Natural Blinking Loop — 2-6s randomized; occasional double-blink;
        //         blink rate reduced ~40% while she is speaking.
        const b = blinkState.current;
        if (!b.isBlinking && elapsed > b.nextBlinkTime) {
          b.isBlinking = true;
          b.blinkProgress = 0;
        }

        if (b.isBlinking) {
          b.blinkProgress += delta * 12; // fast blink ~160ms
          let blinkWeight = 0;
          if (b.blinkProgress <= 1.0) {
            blinkWeight = Math.sin(b.blinkProgress * Math.PI);
          } else {
            b.isBlinking = false;
            const baseInterval = 2.5 + Math.random() * 3.5; // 2.5-6s
            // blink frequency suppressed by 50% while she is speaking
            const interval = baseInterval * (speakingRef.current ? 2.0 : 1.0);
            // ~25% chance of a natural double-blink right after this one
            const doubleBlink = !b._wasDouble && Math.random() < 0.25;
            b.nextBlinkTime = elapsed + (doubleBlink ? 0.18 + Math.random() * 0.15 : interval);
            b._wasDouble = doubleBlink;
            blinkWeight = 0;
          }
          expressionWeights.current.blink = blinkWeight;
        } else {
          expressionWeights.current.blink = 0;
        }

        // ---- 5. Smooth the viseme weights toward the analyzed targets.
        // Asymmetric smoothing — snap OPEN with voice bursts, close CLEANLY when silent.
        const isSpeakingNow = speakingRef.current;
        const openRate = Math.min(1, delta * 22);
        const closeRate = isSpeakingNow ? Math.min(1, delta * 12) : Math.min(1, delta * 22);
        for (const v of VISEME_PRESETS) {
          const target = lipTargets[v];
          const cur = expressionWeights.current[v];
          let next = cur + (target - cur) * (target > cur ? openRate : closeRate);
          // Snap tiny residual values to 0 so the mouth rests completely closed
          if (!isSpeakingNow && next < 0.005) next = 0;
          expressionWeights.current[v] = next;
        }

        // ---- 6. Update VRM Expressions
        if (vrm.expressionManager) {
          const blend = EMOTION_BLENDS[emotionRef.current] || EMOTION_BLENDS.neutral;
          const emotionK = Math.min(1, delta * 7); // ~0.3-0.6s settle

          for (const emo of EMOTION_PRESETS) {
            const target = blend.find((c) => c.name === emo)?.value || 0;
            expressionWeights.current[emo] += (target - expressionWeights.current[emo]) * emotionK;
            vrm.expressionManager.setValue(emo, Math.max(0, Math.min(1, expressionWeights.current[emo])));
          }

          // Visemes: driven purely by audio lip-sync (strictly 0 in idle/silence).
          for (const v of VISEME_PRESETS) {
            vrm.expressionManager.setValue(v, expressionWeights.current[v]);
          }

          // Blink
          vrm.expressionManager.setValue('blink', expressionWeights.current.blink);

          vrm.expressionManager.update();
        }

        // Spring bone physics & model update
        vrm.update(delta);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      cleanupModel?.();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [retryKey]);

  return (
    <div className="canvas-container" ref={mountRef}>
      {!isLoaded && !loadError && (
        <BirdLoader progress={loadProgress} />
      )}

      {loadError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            textAlign: 'center',
            color: '#f87171',
            zIndex: 10,
            gap: '10px',
          }}
        >
          <p style={{ fontWeight: 600, marginBottom: '6px' }}>Failed to load 3D Avatar</p>
          <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{loadError}</p>
          <button
            onClick={() => { setLoadError(null); setLoadProgress(0); setRetryKey((k) => k + 1); }}
            style={{
              padding: '8px 18px',
              borderRadius: '9999px',
              border: '1px solid rgba(244, 114, 182, 0.4)',
              background: 'rgba(244, 114, 182, 0.12)',
              color: '#f472b6',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
