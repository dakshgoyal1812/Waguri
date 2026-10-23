import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
// The shipped waguri.vrm is optimized with EXT_meshopt_compression; GLTFLoader
// refuses the file unless a decoder is provided (no-op for non-meshopt models).
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import BirdLoader from './BirdLoader.jsx';
import { DEFAULT_VRM_URL } from '../lib/vrmStore.js';
import { applyAvatarCustomization } from '../lib/avatarCustomization.js';

const EMOTION_PRESETS = ['happy', 'angry', 'sad', 'surprised', 'relaxed', 'neutral'];
const VISEME_PRESETS = ['aa', 'ih', 'ou', 'ee', 'oh'];

// Expression synonyms for cross-VRM compatibility (VRM 0.x, VRM 1.0, VRoid exports)
const EXPRESSION_SYNONYMS = {
  happy: ['happy', 'joy', 'smile', 'fcl_all_joy', 'fcl_all_smile'],
  relaxed: ['relaxed', 'fun', 'fcl_all_fun'],
  sad: ['sad', 'sorrow', 'fcl_all_sorrow'],
  angry: ['angry', 'anger', 'fcl_all_angry'],
  surprised: ['surprised', 'surprise', 'fcl_all_surprised'],
  neutral: ['neutral', 'fcl_all_neutral'],
  blink: ['blink', 'eye_close', 'fcl_eye_close', 'blink_both'],
  aa: ['aa', 'a', 'fcl_mth_a'],
  ih: ['ih', 'i', 'fcl_mth_i'],
  ou: ['ou', 'u', 'fcl_mth_u'],
  ee: ['ee', 'e', 'fcl_mth_e'],
  oh: ['oh', 'o', 'fcl_mth_o'],
};

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
const VOWEL_LIST = [
  { id: 'aa', f1: 800, f2: 1200 },
  { id: 'ee', f1: 500, f2: 2000 },
  { id: 'ih', f1: 320, f2: 2300 },
  { id: 'oh', f1: 500, f2: 850 },
  { id: 'ou', f1: 320, f2: 900 },
];

// ---- arm rest pose (model-independent) ----
// The tuned Euler pose below assumes the bone frames of waguri.vrm; models
// with different normalized binds (VRM0 axis conversions, A-pose exports)
// would swing their arms somewhere random — Zero's went straight up. Instead
// the arms are aligned by WORLD direction: a per-model delta quaternion is
// computed at load that swings each arm from its own bind direction to these
// targets (X+ = model's left, Y+ up, Z+ forward toward camera).
const ARM_REST_TARGETS = {
  left: {
    upper: new THREE.Vector3(0.28, -0.95, 0.08).normalize(),  // down, slightly out/forward
    lower: new THREE.Vector3(0.20, -0.90, 0.32).normalize(),  // gentle elbow bend forward
  },
  right: {
    upper: new THREE.Vector3(-0.28, -0.95, 0.08).normalize(),
    lower: new THREE.Vector3(-0.20, -0.90, 0.32).normalize(),
  },
};

const FINGER_BONES = [
  'leftIndexProximal', 'leftMiddleProximal', 'leftRingProximal', 'leftLittleProximal',
  'rightIndexProximal', 'rightMiddleProximal', 'rightRingProximal', 'rightLittleProximal',
];

const LEG_BONES = [
  'leftUpperLeg', 'rightUpperLeg',
  'leftLowerLeg', 'rightLowerLeg',
  'leftFoot', 'rightFoot',
  'leftToes', 'rightToes',
];

// Every normalized bone the animation loop poses; bind quaternions are
// snapshotted at load so posing composes as bind * delta.
const POSED_BONES = [
  'hips', 'spine', 'chest', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand',
  ...LEG_BONES,
  ...FINGER_BONES,
];

const _euler = new THREE.Euler();
const _quatA = new THREE.Quaternion();
const _quatB = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _tapMouse = new THREE.Vector2();
const _tapRaycaster = new THREE.Raycaster();
const _headPosVec = new THREE.Vector3();

// Set a bone's pose as a WORLD-frame Euler delta (x = pitch forward, y = yaw
// left, z = roll) composed onto its bind quaternion. Conjugating through the
// parent's world orientation makes the delta direction identical on every
// model — VRM0 exports (and other rigs) store bone frames flipped/rotated,
// which is why a local-Euler bow made Zero lean backwards.
function poseWorldBone(node, bindMap, x, y, z) {
  if (!node) return;
  _euler.set(x, y, z);
  const bind = bindMap ? bindMap.get(node) : null;
  if (!bind || !node.parent) {
    node.rotation.copy(_euler);
    return;
  }
  _quatA.setFromEuler(_euler);
  node.parent.getWorldQuaternion(_parentQ);
  _quatB.copy(_parentQ).invert().multiply(_quatA).multiply(_parentQ);
  node.quaternion.copy(_quatB).multiply(bind);
}

// Compute per-side quaternions that swing the arms from their bind pose into
// the natural rest pose. Measured once at load, at bind pose; the render loop
// re-applies them every frame.
function computeArmRestPose(vrm) {
  const pose = {};
  const humanoid = vrm.humanoid;
  if (!humanoid) return pose;

  const alignDelta = (bone, child, targetDir) => {
    child.updateWorldMatrix(true, false); // refreshes bone's matrixWorld too
    const from = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    const to = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld);
    const bindDir = to.sub(from).normalize();
    const worldQuat = new THREE.Quaternion();
    bone.getWorldQuaternion(worldQuat);
    // world rotation that turns bindDir into targetDir, expressed in the
    // bone's local space: D = Qw⁻¹ · R · Qw
    const rot = new THREE.Quaternion().setFromUnitVectors(bindDir, targetDir);
    return worldQuat.clone().invert().multiply(rot).multiply(worldQuat);
  };

  for (const side of ['left', 'right']) {
    const upper = humanoid.getNormalizedBoneNode(side + 'UpperArm');
    const lower = humanoid.getNormalizedBoneNode(side + 'LowerArm');
    const hand = humanoid.getNormalizedBoneNode(side + 'Hand');
    if (!upper || !lower || !hand) continue;

    const bindUpper = upper.quaternion.clone();
    const bindLower = lower.quaternion.clone();
    const dUpper = alignDelta(upper, lower, ARM_REST_TARGETS[side].upper);
    // Pose the upper arm BEFORE measuring the forearm so the forearm target
    // is reached relative to the final upper-arm orientation, not the bind.
    upper.quaternion.copy(bindUpper).multiply(dUpper);
    const dLower = alignDelta(lower, hand, ARM_REST_TARGETS[side].lower);
    upper.quaternion.copy(bindUpper); // the render loop re-poses every frame
    pose[side] = { bindUpper, bindLower, dUpper, dLower };
  }
  return pose;
}

// Device tier breakpoints
const TIER_MEDIA = {
  mobile: '(max-width: 767px)',
  tablet: '(min-width: 768px) and (max-width: 1024px)',
  desktop: '(min-width: 1025px)',
};

const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
    (navigator.msMaxTouchPoints && navigator.msMaxTouchPoints > 0)
  );
};

const getDeviceTier = () => {
  if (typeof window === 'undefined') return 'desktop';
  if (window.matchMedia(TIER_MEDIA.mobile).matches) return 'mobile';
  if (window.matchMedia(TIER_MEDIA.tablet).matches) return 'tablet';
  return 'desktop';
};

// 3D model room (.glb) is strictly for laptop / desktop (>= 769px); phones use the anime room wallpaper
const isLaptopOrDesktop = (w) => {
  if (typeof window === 'undefined') return false;
  const width = w !== undefined ? w : window.innerWidth;
  const tier = getDeviceTier();
  return tier !== 'mobile' && width >= 769;
};

export default function AvatarCanvas({
  currentEmotion = 'neutral',
  audioElement = null,
  isSpeaking = false,
  chatOpen = true,
  vrmUrl = DEFAULT_VRM_URL,
  showRoom = false,
  onModelLoaded = () => {},
  onTouchReaction = () => {},
  customization = null,
  isStudioOpen = false,
  studioFocus = 'default',
  modelRotation = 0,
  onRotateModel = null,
  customizingPart = null,
  onFocusChange = null,
}) {
  const mountRef = useRef(null);
  const vrmRef = useRef(null);
  const sceneRef = useRef(null);
  const roomGroupRef = useRef(null);
  const roomSceneRef = useRef(null);
  const showRoomRef = useRef(showRoom);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const [loadProgress, setLoadProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loaderVisible, setLoaderVisible] = useState(true);

  const customizationRef = useRef(customization);
  customizationRef.current = customization;

  const isStudioOpenRef = useRef(isStudioOpen);
  const studioFocusRef = useRef(studioFocus);
  const modelRotationRef = useRef(modelRotation);
  const onRotateModelRef = useRef(onRotateModel);
  const baseModelRotYRef = useRef(0);

  useEffect(() => { isStudioOpenRef.current = isStudioOpen; }, [isStudioOpen]);
  useEffect(() => { studioFocusRef.current = studioFocus; }, [studioFocus]);
  useEffect(() => { modelRotationRef.current = modelRotation; }, [modelRotation]);
  useEffect(() => { onRotateModelRef.current = onRotateModel; }, [onRotateModel]);

  useEffect(() => {
    if (vrmRef.current && customization) {
      applyAvatarCustomization(vrmRef.current, customization);
    }
  }, [customization]);
  const [loadError, setLoadError] = useState(null);
  const [retryKey, setRetryKey] = useState(0); // bumped by the Retry button

  // Synchronize 3D room visibility dynamically without rebuilding VRM
  // 3D model room is strictly enabled on laptop/desktop (>= 769px); on phone, wallpaper is used
  useEffect(() => {
    const isDesktop = isLaptopOrDesktop();
    const active = Boolean(showRoom && isDesktop);
    showRoomRef.current = active;
    if (roomGroupRef.current) {
      roomGroupRef.current.visible = active;
    }
  }, [showRoom]);

  // Interactive touch reactions (head pat, shoulder tap)
  const touchReaction = useRef({ active: false, type: null, t: 0, duration: 2.0 });
  const touchCallbackRef = useRef(onTouchReaction);
  useEffect(() => { touchCallbackRef.current = onTouchReaction; }, [onTouchReaction]);

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

  // Device tier & touch state
  const isTouch = useRef(isTouchDevice());
  const tierRef = useRef(getDeviceTier());

  // Cursor & touch eye-tracking + touch idle look-around
  const lookState = useRef({
    enabled: true,
    isTouch: isTouchDevice(),
    rawX: 0, rawY: 0,          // latest mouse/touch drag, normalized [-1, 1]
    smoothX: 0, smoothY: 0,    // damped values used by the rAF loop
    lastMoveAt: 0,             // timestamp of last user input
    touchActive: false,
  });

  // Eye saccades (airi eye-motions): tiny eye darts layered on the gaze when the
  // cursor is idle — eyes-only, the head stays put, which is what reads as "alive".
  const saccadeState = useRef({ nextAt: 800, until: 0, dx: 0, dy: 0, x: 0, y: 0 });

  // wLipSync competition state: the currently winning vowel (hysteresis anchor).
  const lipVowelRef = useRef('aa');

  // Per-model expression name map (canonical VRM1 name -> actual model name).
  // VRM0.x models (e.g. VRoid exports) keep authored names for non-standard
  // presets — Zero stores "surprised" as a custom expression named 'Surprised'
  // — so every setValue goes through this map; null = the model lacks it.
  const expressionNameMapRef = useRef(null);

  // Bind-pose snapshot of the normalized bones (captured at load, before the
  // animation loop poses them) — used by the dev probe and rest-pose logic.
  const bindQuatsRef = useRef(null);
  // Per-model arm rest deltas (null for the default model, which keeps its
  // hand-tuned absolute Euler pose).
  const armRestPoseRef = useRef(null);

  // Idle micro-gesture state machine (lively anime head tilt / nod / weight shift)
  const gestureState = useRef({
    nextAt: 1.5,
    type: null,        // 'headTiltL' | 'headTiltR' | 'cheerfulNod' | 'curiousLean' | 'weightShift'
    t: 0,              // seconds since gesture start
    duration: 2.,
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

  // Cursor & touch eye-tracking input (mousemove + touchstart/touchmove/touchend)
  useEffect(() => {
    // Ensure no residual background pan remains
    document.documentElement.style.removeProperty('--bg-pan-x');
    document.documentElement.style.removeProperty('--bg-pan-y');

    const onMove = (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;   // [-1, 1]
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      lookState.current.rawX = Math.max(-1, Math.min(1, nx));
      lookState.current.rawY = Math.max(-1, Math.min(1, ny));
      lookState.current.lastMoveAt = performance.now();
    };

    const onTouchStart = (e) => {
      if (e.touches && e.touches[0]) {
        lookState.current.touchActive = true;
        const t = e.touches[0];
        const nx = (t.clientX / window.innerWidth) * 2 - 1;
        const ny = (t.clientY / window.innerHeight) * 2 - 1;
        lookState.current.rawX = Math.max(-1, Math.min(1, nx));
        lookState.current.rawY = Math.max(-1, Math.min(1, ny));
        lookState.current.lastMoveAt = performance.now();
      }
    };

    const onTouchMove = (e) => {
      if (e.touches && e.touches[0]) {
        const t = e.touches[0];
        const nx = (t.clientX / window.innerWidth) * 2 - 1;
        const ny = (t.clientY / window.innerHeight) * 2 - 1;
        lookState.current.rawX = Math.max(-1, Math.min(1, nx));
        lookState.current.rawY = Math.max(-1, Math.min(1, ny));
        lookState.current.lastMoveAt = performance.now();
      }
    };

    const onTouchEnd = () => {
      lookState.current.touchActive = false;
    };

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });

    // Breakpoint matchMedia listeners for tier changes
    const mqlMobile = window.matchMedia(TIER_MEDIA.mobile);
    const mqlTablet = window.matchMedia(TIER_MEDIA.tablet);
    const updateTier = () => {
      tierRef.current = getDeviceTier();
      isTouch.current = isTouchDevice();
      lookState.current.isTouch = isTouch.current;
      const isDesktop = isLaptopOrDesktop(window.innerWidth);
      if (roomGroupRef.current) {
        roomGroupRef.current.visible = Boolean(showRoomRef.current && isDesktop);
      }
    };
    mqlMobile.addEventListener('change', updateTier);
    mqlTablet.addEventListener('change', updateTier);

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      mqlMobile.removeEventListener('change', updateTier);
      mqlTablet.removeEventListener('change', updateTier);
    };
  }, []);

  // Main Three.js Scene Setup. Re-runs on retryKey (failure retry) and on
  // vrmUrl (avatar switch): the whole stage rebuilds with the new model while
  // the bird loader covers the swap.
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Fresh loader state so switching avatars shows the bird again
    setLoadProgress(0);
    setIsLoaded(false);
    setLoaderVisible(true);
    setLoadError(null);

    let width = container.clientWidth || 400;
    let height = container.clientHeight || 500;

    const scene = new THREE.Scene();

    // Responsive camera framing for phones vs tablets vs desktop
    const getTargetCameraParams = (w, h, isChatOpen, tier, isStudio, focus) => {
      const currentTier = tier || getDeviceTier();
      const isDesktop = isLaptopOrDesktop(w);
      const aspect = w / h;

      if (isStudio) {
        // --- 3D WARDROBE & AVATAR STUDIO MODE ---
        // On desktop/laptop: character is shifted left (-0.28 to -0.32) so she sits centered in the open viewport beside the right studio drawer
        // On mobile: character is framed in the upper half of screen above the bottom sheet
        if (isDesktop && currentTier !== 'mobile') {
          if (focus === 'face') {
            return {
              pos: new THREE.Vector3(-0.24, 1.38, 1.05),
              look: new THREE.Vector3(-0.14, 1.34, 0),
              fov: 24,
            };
          }
          if (focus === 'shoes') {
            return {
              pos: new THREE.Vector3(-0.25, 0.40, 1.55),
              look: new THREE.Vector3(-0.14, 0.22, 0),
              fov: 28,
            };
          }
          if (focus === 'body') {
            return {
              pos: new THREE.Vector3(-0.28, 1.02, 1.70),
              look: new THREE.Vector3(-0.15, 0.94, 0),
              fov: 32,
            };
          }
          // Default / Full in Studio
          return {
            pos: new THREE.Vector3(-0.30, 0.90, 2.22),
            look: new THREE.Vector3(-0.16, 0.86, 0),
            fov: 35,
          };
        }

        // Mobile Studio Framing (upper half of screen)
        if (focus === 'face') {
          return {
            pos: new THREE.Vector3(0, 1.34, 1.08),
            look: new THREE.Vector3(0, 1.32, 0),
            fov: 26,
          };
        }
        if (focus === 'shoes') {
          return {
            pos: new THREE.Vector3(0, 0.44, 1.50),
            look: new THREE.Vector3(0, 0.22, 0),
            fov: 28,
          };
        }
        if (focus === 'body') {
          return {
            pos: new THREE.Vector3(0, 1.06, 1.72),
            look: new THREE.Vector3(0, 0.96, 0),
            fov: 32,
          };
        }
        // Default / Full on mobile
        return {
          pos: new THREE.Vector3(0, 1.15, 2.30),
          look: new THREE.Vector3(0, 0.90, 0),
          fov: 36,
        };
      }

      // --- STANDARD COMPANION MODE ---
      if (currentTier === 'mobile' || aspect < 0.75 || !isDesktop) {
        // Phone portrait: standard centered framing, zero clipping from 3D room meshes
        return {
          pos: new THREE.Vector3(0, 1.00, 2.25),
          look: new THREE.Vector3(0, 0.94, 0),
          fov: 34,
        };
      }

      if (currentTier === 'tablet') {
        if (isChatOpen) {
          // Tablet with chat card on the side:
          return {
            pos: new THREE.Vector3(-0.20, 0.98, 2.15),
            look: new THREE.Vector3(-0.10, 0.94, 0),
            fov: 34,
          };
        }
        return {
          pos: new THREE.Vector3(0, 0.98, 2.15),
          look: new THREE.Vector3(0, 0.94, 0),
          fov: 34,
        };
      }

      // Desktop (1025px+): balanced companion framing with ample headroom and clear view down to knees
      if (isChatOpen) {
        // Shift left (-0.28) into open viewport area away from the 420px chat card
        return {
          pos: new THREE.Vector3(-0.28, 0.98, 2.12),
          look: new THREE.Vector3(-0.16, 0.94, 0),
          fov: 34,
        };
      }
      return {
        pos: new THREE.Vector3(0, 0.96, 2.20),
        look: new THREE.Vector3(0, 0.92, 0),
        fov: 34,
      };
    };

    const currentLook = new THREE.Vector3(0, 0.94, 0);
    const initialParams = getTargetCameraParams(
      width,
      height,
      chatOpenRef.current,
      tierRef.current,
      isStudioOpenRef.current,
      studioFocusRef.current
    );

    const camera = new THREE.PerspectiveCamera(initialParams.fov, width / height, 0.1, 20);
    camera.position.copy(initialParams.pos);
    currentLook.copy(initialParams.look);
    camera.lookAt(currentLook);

    // Sharpness: render at up to 2x device pixels on every tier. Phones report
    // DPR 2.6-3.5, so the old 1.25 mobile cap stretched the canvas over 2x and
    // made her look blurry. 2x stays crisp on every phone while still capping
    // fill rate well below a full 3x render (keeps GPU/battery cost light).
    const maxPr = 2;

    const renderer = new THREE.WebGLRenderer({
      antialias: true, // hardware MSAA is cheap at this resolution; hair edges stay smooth
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPr));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = false; // Disable heavy shadow maps on mobile/web
    container.appendChild(renderer.domElement);

    // Lights: balanced anime lighting with rim/back light for 3D silhouette separation
    const ambientLight = new THREE.AmbientLight(0xfff8f0, 0.95);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff0f5, 1.25);
    keyLight.position.set(1.2, 2.2, 1.5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe0e7ff, 0.55);
    fillLight.position.set(-1.2, 1.2, 1.0);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xfdf4ff, 0.75);
    rimLight.position.set(0, 1.8, -1.8);
    scene.add(rimLight);

    // Eye-tracking look target: a point in front of her face the eyes follow
    const lookTarget = new THREE.Object3D();
    lookTarget.position.set(0, 1.34, 2.5);
    scene.add(lookTarget);

    sceneRef.current = scene;

    // 3D Sitting Room Stage setup
    const roomGroup = new THREE.Group();
    roomGroup.name = 'sittingRoomStage';
    roomGroupRef.current = roomGroup;
    scene.add(roomGroup);

    // Warm ambient and accent lights specifically for the room stage (tuned for mobile brightness & OLED clarity)
    const roomAmbient = new THREE.AmbientLight(0xfff2e6, 0.85);
    roomGroup.add(roomAmbient);

    const roomWarmPoint = new THREE.PointLight(0xffd1a4, 1.5, 10);
    roomWarmPoint.position.set(0, 2.7, 0.2);
    roomGroup.add(roomWarmPoint);

    const roomFillLight = new THREE.DirectionalLight(0xfff8f0, 0.45);
    roomFillLight.position.set(0, 2.0, 2.0);
    roomGroup.add(roomFillLight);

    // Soft grounded contact shadow under avatar's feet
    const shadowGeo = new THREE.PlaneGeometry(0.85, 0.85);
    const sCanvas = document.createElement('canvas');
    sCanvas.width = 64;
    sCanvas.height = 64;
    const sCtx = sCanvas.getContext('2d');
    const grad = sCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(30, 20, 15, 0.55)');
    grad.addColorStop(0.5, 'rgba(30, 20, 15, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 64, 64);
    const shadowTex = new THREE.CanvasTexture(sCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.005, 0);
    roomGroup.add(contactShadow);

    // Responsive room layout adapter: scales and depths the room for mobile portrait
    // so couches, walls, and windows fit cleanly on phone screens instead of blowing up.
    const applyRoomLayout = (w, h, tier) => {
      const room = roomSceneRef.current;
      if (!room) return;
      const aspect = w / h;
      const currentTier = tier || getDeviceTier();
      if (currentTier === 'mobile' || aspect < 0.75) {
        // Phone portrait: Scale room down and push it back into depth
        room.scale.setScalar(0.52);
        room.position.set(0, -0.01, -1.05);
      } else if (currentTier === 'tablet' || aspect < 1.2) {
        room.scale.setScalar(0.75);
        room.position.set(0, 0, -0.45);
      } else {
        // Desktop landscape: natural 1:1 scale (looks great on laptop)
        room.scale.setScalar(1.0);
        room.position.set(0, 0, 0);
      }
    };

    // Load the baked 3D sitting room
    const roomLoader = new GLTFLoader();
    roomLoader.load(
      '/room.glb',
      (gltf) => {
        if (disposed) return;
        const roomScene = gltf.scene;
        roomSceneRef.current = roomScene;
        roomScene.traverse((obj) => {
          if (obj.isMesh && obj.material) {
            obj.matrixAutoUpdate = false;
            obj.updateMatrix();
            obj.material.side = THREE.DoubleSide;
            if (obj.material.map) {
              obj.material.map.colorSpace = THREE.SRGBColorSpace;
            }
            if (obj.material.isMeshStandardMaterial) {
              obj.material.roughness = 0.95;
              obj.material.metalness = 0.0;
            }
          }
        });
        roomGroup.add(roomScene);
        applyRoomLayout(width, height, tierRef.current);
        roomGroup.visible = Boolean(showRoomRef.current && isLaptopOrDesktop(width));
      },
      undefined,
      (err) => {
        console.warn('[waguri] Room model failed to load:', err);
      }
    );

    // Set initial visibility (laptop/desktop only)
    roomGroup.visible = Boolean(showRoomRef.current && isLaptopOrDesktop(width));

    let disposed = false;
    let cleanupModel = null;

    // Load VRM Avatar safely after MeshoptDecoder is ready
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.register((parser) => new VRMLoaderPlugin(parser));

    const startVrmLoad = () => {
      loader.load(
        vrmUrl,
        (gltf) => {
          if (disposed) return;
          const vrm = gltf.userData.vrm;
          if (!vrm) {
            setLoadError('VRM data not found in gltf payload');
            return;
          }

          // VRM optimization (best-effort; interleaved buffers are safely skipped)
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

          // VRM 0.x models face -Z (Unity convention): rotate them to VRM 1.0's
          // camera-facing +Z. No-op for VRM 1.0 models like waguri.vrm.
          VRMUtils.rotateVRM0(vrm);

          // Every added avatar is normalized to the stage's canonical size and
          // anchor (waguri.vrm's ~1.55m bind-pose height, feet at origin, centered)
          // so the tuned per-device camera framing works unchanged for any model.
          // The bundled default keeps its exact legacy path — scale stays 1.
          if (vrmUrl !== DEFAULT_VRM_URL) {
            try {
              const box = new THREE.Box3().setFromObject(vrm.scene);
              const height = box.max.y - box.min.y;
              if (height > 0.1 && Number.isFinite(height)) {
                vrm.scene.scale.setScalar(1.55 / height);
              }
              const grounded = new THREE.Box3().setFromObject(vrm.scene);
              vrm.scene.position.y -= grounded.min.y;
              vrm.scene.position.x -= (grounded.min.x + grounded.max.x) / 2;
              vrm.scene.position.z -= (grounded.min.z + grounded.max.z) / 2;
            } catch {
              // Framing fallback: leave the model as authored
            }
          }

          // Upgrade unlit hair materials (MeshBasicMaterial) to MeshStandardMaterial
          // so her hair receives soft anime shading, lighting depth, and highlights instead
          // of rendering as an unlit flat magenta block.
          vrm.scene.traverse((obj) => {
            if (obj.isMesh && obj.material) {
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              mats.forEach((mat, idx) => {
                if (mat.name && mat.name.toLowerCase().includes('hair') && (mat.isMeshBasicMaterial || !mat.isMeshStandardMaterial)) {
                  if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
                  const standardMat = new THREE.MeshStandardMaterial({
                    map: mat.map,
                    color: mat.color,
                    roughness: 0.65,
                    metalness: 0.05,
                    alphaTest: mat.alphaTest || 0.5,
                    transparent: mat.transparent,
                    side: mat.side,
                  });
                  standardMat.needsUpdate = true;
                  if (Array.isArray(obj.material)) {
                    obj.material[idx] = standardMat;
                  } else {
                    obj.material = standardMat;
                  }
                }
              });
            }
          });

          // Position is set by the normalization block above (default model
          // stays at the authored origin, facing camera per VRM spec).
          scene.add(vrm.scene);

          if (vrm.lookAt) vrm.lookAt.target = lookTarget; // cursor eye-tracking

          // Build the canonical -> actual expression name map for this model
          // (handles VRM0 authored names like Zero's 'Surprised', 'Joy', 'Fun', etc.).
          if (vrm.expressionManager) {
            const available = new Set(
              (vrm.expressionManager.expressions || []).map((e) => e.expressionName)
            );
            const nameMap = {};
            const allTargets = [...EMOTION_PRESETS, ...VISEME_PRESETS, 'blink'];
            for (const name of allTargets) {
              if (available.has(name)) {
                nameMap[name] = name;
              } else {
                const synonyms = EXPRESSION_SYNONYMS[name] || [name];
                let matched = null;
                for (const syn of synonyms) {
                  const found = [...available].find((n) => n && n.toLowerCase() === syn.toLowerCase());
                  if (found) {
                    matched = found;
                    break;
                  }
                }
                nameMap[name] = matched;
              }
            }
            expressionNameMapRef.current = nameMap;
          } else {
            expressionNameMapRef.current = null;
          }

          vrmRef.current = vrm;

          // Snapshot normalized-bone bind quaternions (before the animation
          // loop poses anything) so added models pose as bind * delta.
          bindQuatsRef.current = new Map();
          for (const b of POSED_BONES) {
            const node = vrm.humanoid?.getNormalizedBoneNode(b);
            if (node) bindQuatsRef.current.set(node, node.quaternion.clone());
          }
          // Per-model arm rest pose (world-direction aligned; see the helper).
          armRestPoseRef.current = vrmUrl === DEFAULT_VRM_URL ? null : computeArmRestPose(vrm);

          // Record model base rotation Y (VRM0 rotated models will have base rotation)
          baseModelRotYRef.current = vrm.scene.rotation.y;

          // Apply any active 3D customization (clothes, eyes, hair, skin)
          if (customizationRef.current) {
            applyAvatarCustomization(vrm, customizationRef.current);
          }

          setLoadProgress(100);
          setIsLoaded(true);
          // Wait for first render frames before starting loader fade-out
          setTimeout(() => {
            if (!disposed) setLoaderVisible(false);
          }, 450);

          entranceState.current = { active: true, t: 0, duration: 2.4 }; // greeting bow
          onModelLoaded(vrm);

          // Tiny debug/verification probe (harmless in prod): lets a console or
          // test check that visemes actually move while she speaks.
          window.__waguriAvatar = {
            loaded: () => !!vrmRef.current,
            speaking: () => speakingRef.current,
            energy: () => energyRef.current,
            applyCustomization: (cfg) => {
              if (vrmRef.current) applyAvatarCustomization(vrmRef.current, cfg);
            },
            expressionNames: () =>
              (vrmRef.current?.expressionManager?.expressions || []).map((e) => e.expressionName),
            expressionWeight: (name) =>
              vrmRef.current?.expressionManager?.getExpression(name)?.weight ?? null,
            bindQuats: () =>
              bindQuatsRef.current
                ? [...bindQuatsRef.current.entries()].map(([n, q]) => [n.name, q.toArray()])
                : null,
            armPose: () => armRestPoseRef.current,
            // Dev aid: hold the entrance bow at its peak to inspect the pose
            holdBow: () => { entranceState.current = { active: true, t: 0.7, duration: 12 }; },
            visemes: () => {
              const { aa, ih, ou, ee, oh } = expressionWeights.current;
              return { aa, ih, ou, ee, oh };
            },
            triggerTouch: (type = 'headPat') => {
              touchReaction.current = {
                active: true,
                type,
                t: 0,
                duration: type === 'headPat' ? 2.2 : 1.8,
              };
              touchCallbackRef.current?.(type);
            },
            touchReactionState: () => ({ ...touchReaction.current }),
          };

          console.log(`[AvatarCanvas] VRM model loaded from ${vrmUrl}`);
        },
        (progress) => {
          if (progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            setLoadProgress(Math.min(99, pct));
          } else {
            setLoadProgress((p) => Math.min(92, p + 12));
          }
        },
        (error) => {
          if (disposed) return;
          console.error('[AvatarCanvas] VRM loading error:', error);
          setLoadError(error.message || 'Failed to load VRM model');
        }
      );
    };

    if (MeshoptDecoder.ready) {
      MeshoptDecoder.ready.then(() => {
        if (!disposed) startVrmLoad();
      }).catch((err) => {
        console.warn('[AvatarCanvas] MeshoptDecoder.ready error:', err);
        if (!disposed) startVrmLoad();
      });
    } else {
      startVrmLoad();
    }

    cleanupModel = () => {
      const vrm = vrmRef.current;
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
        vrmRef.current = null;
      }
      delete window.__waguriAvatar;
    };

    // Handle Container / Window Resize with ResizeObserver
    const handleResize = (newW, newH) => {
      if (!container) return;
      width = newW || container.clientWidth || 400;
      height = newH || container.clientHeight || 500;
      if (width === 0 || height === 0) return;

      const isDesktop = isLaptopOrDesktop(width);
      if (roomGroupRef.current) {
        roomGroupRef.current.visible = Boolean(showRoomRef.current && isDesktop);
      }

      camera.aspect = width / height;
      const targetParams = getTargetCameraParams(
        width,
        height,
        chatOpenRef.current,
        tierRef.current,
        isStudioOpenRef.current,
        studioFocusRef.current
      );
      camera.fov = targetParams.fov;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxPr));
      if (isDesktop) {
        applyRoomLayout(width, height, tierRef.current);
      }
    };

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: w, height: h } = entry.contentRect;
          if (w > 0 && h > 0) {
            handleResize(w, h);
          }
        }
      });
      resizeObserver.observe(container);
    }
    const onWinResize = () => handleResize(container.clientWidth, container.clientHeight);
    window.addEventListener('resize', onWinResize);

    // ---- Interactive Touch Reactions & Studio Drag Rotation ----
    let downX = 0;
    let downY = 0;
    let lastDragX = 0;
    let isDraggingStudio = false;
    let downTime = 0;

    const onPointerDown = (e) => {
      downX = e.clientX;
      downY = e.clientY;
      lastDragX = e.clientX;
      downTime = performance.now();
      if (isStudioOpenRef.current) {
        isDraggingStudio = true;
      }
    };

    const onPointerMove = (e) => {
      if (isDraggingStudio && isStudioOpenRef.current) {
        const dx = e.clientX - lastDragX;
        lastDragX = e.clientX;
        if (Math.abs(dx) > 0.4 && onRotateModelRef.current) {
          onRotateModelRef.current((prev) => prev - dx * 0.45);
        }
      }
    };

    const onPointerUp = (e) => {
      isDraggingStudio = false;
      const dt = performance.now() - downTime;
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      // Only count as intentional tap/click if short duration (<450ms) and minimal drag (<15px)
      if (dt > 450 || dist > 15) return;

      const vrm = vrmRef.current;
      if (!vrm || !vrm.scene) return;

      const rect = renderer.domElement.getBoundingClientRect();
      _tapMouse.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      _tapRaycaster.setFromCamera(_tapMouse, camera);

      const intersects = _tapRaycaster.intersectObject(vrm.scene, true);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const humanoid = vrm.humanoid;
        let isHead = false;

        if (humanoid) {
          const headBone = humanoid.getNormalizedBoneNode('head');
          if (headBone) {
            headBone.getWorldPosition(_headPosVec);
            // Within 0.32m of head bone center, or hit point is at/above forehead/hair level
            if (hit.point.distanceTo(_headPosVec) < 0.32 || hit.point.y >= _headPosVec.y - 0.08) {
              isHead = true;
            }
          }
        }

        if (!humanoid && hit.point.y > 1.25) {
          isHead = true;
        }

        const reactionType = isHead ? 'headPat' : 'shoulderTap';
        touchReaction.current = {
          active: true,
          type: reactionType,
          t: 0,
          duration: reactionType === 'headPat' ? 2.2 : 1.8,
        };

        touchCallbackRef.current?.(reactionType);
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });

    // Animation Loop
    const clock = new THREE.Clock();
    let animId = null;
    const freqData = new Uint8Array(256);

    // Frame rate throttle by tier: Tablet = 60fps cap, Desktop = uncapped/vsync.
    // Mobile is ADAPTIVE: start at 60fps so lip-sync looks smooth on capable
    // phones; if the device can't hold ~50fps over a 3s window (weak GPU or
    // thermal throttling), drop to 30fps for the rest of the session. One-way
    // switch keeps the feel stable and saves battery exactly where it's needed.
    let lastFrameTime = performance.now();
    let mobileFpsCap = 60;
    let fpsWinFrames = 0;
    let fpsWinSlow = 0;

    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (document.hidden) {
        return;
      }

      const now = performance.now();
      const currentTier = tierRef.current;

      // Sample the real rendered cadence while at 60 (gaps > 500ms are tab
      // switches, not slow frames). 40%+ slow frames over ~180 frames = drop.
      if (currentTier === 'mobile' && mobileFpsCap === 60) {
        const renderedInterval = now - lastFrameTime;
        if (renderedInterval < 500) {
          fpsWinFrames++;
          if (renderedInterval > 21) fpsWinSlow++; // below ~48fps
        }
        if (fpsWinFrames >= 180) {
          if (fpsWinSlow > fpsWinFrames * 0.4) mobileFpsCap = 30;
          fpsWinFrames = 0;
          fpsWinSlow = 0;
        }
      }

      const targetFps = currentTier === 'mobile' ? mobileFpsCap : (currentTier === 'tablet' ? 60 : 0);
      const minInterval = targetFps > 0 ? (1000 / targetFps) : 0;

      if (minInterval > 0) {
        const elapsedSinceLast = now - lastFrameTime;
        if (elapsedSinceLast < minInterval - 2) { // 2ms tolerance for frame jitter
          return;
        }
      }
      lastFrameTime = now;

      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      // Smooth camera interpolation for responsive phone/desktop & chat toggle transitions
      const targetParams = getTargetCameraParams(
        width,
        height,
        chatOpenRef.current,
        currentTier,
        isStudioOpenRef.current,
        studioFocusRef.current
      );
      const camLerpSpeed = Math.min(1, delta * 4.5);
      camera.position.lerp(targetParams.pos, camLerpSpeed);
      currentLook.lerp(targetParams.look, camLerpSpeed);
      camera.lookAt(currentLook);
      if (Math.abs(camera.fov - targetParams.fov) > 0.05) {
        camera.fov += (targetParams.fov - camera.fov) * camLerpSpeed;
        camera.updateProjectionMatrix();
      }

      const vrm = vrmRef.current;

      // Live 360° Character Angle Rotation in Studio Mode
      if (vrm && vrm.scene) {
        const baseRot = baseModelRotYRef.current || 0;
        const targetRotY = isStudioOpenRef.current
          ? baseRot + (((modelRotationRef.current || 0) * Math.PI) / 180)
          : baseRot;
        vrm.scene.rotation.y = THREE.MathUtils.lerp(
          vrm.scene.rotation.y,
          targetRotY,
          Math.min(1, delta * 7)
        );
      }

      if (vrm) {
        const humanoid = vrm.humanoid;
        let finalHeadZ = 0;

        // ---- cursor & touch eye-tracking + touch idle look-around ----
        const look = lookState.current;
        const isTouchDev = look.isTouch;
        const touchIdle = isTouchDev && !look.touchActive && (now - look.lastMoveAt > 2200);
        const cursorIdle = !isTouchDev && (now - look.lastMoveAt > 4000);

        let targetGazeX = 0;
        let targetGazeY = 0;

        if (isTouchDev && touchIdle) {
          // Touch device idle: subtle, organic look-around drift (slow sine-wave)
          // so she doesn't stare blankly into space
          targetGazeX = Math.sin(elapsed * 0.45) * 0.28 + Math.sin(elapsed * 0.95) * 0.10;
          targetGazeY = Math.cos(elapsed * 0.35) * 0.16 + Math.sin(elapsed * 0.65) * 0.08;
        } else if (look.enabled) {
          targetGazeX = cursorIdle ? 0 : look.rawX;
          targetGazeY = cursorIdle ? 0 : look.rawY;
        }

        const k = Math.min(1, delta * (isTouchDev && touchIdle ? 2.5 : 4.5));
        look.smoothX += (targetGazeX - look.smoothX) * k;
        look.smoothY += (targetGazeY - look.smoothY) * k;

        // Eyes-only tracking (≤30° H / ≤20° V) — head never moves with cursor
        const headYawFromCursor = 0;
        const headPitchFromCursor = 0;

        // ---- eye saccades (micro darts layered on top) ----
        const sac = saccadeState.current;
        const nowMs = performance.now();
        if (nowMs > sac.nextAt) {
          sac.dx = (Math.random() * 2 - 1) * 0.35;
          sac.dy = (Math.random() * 2 - 1) * 0.20;
          sac.until = nowMs + 150 + Math.random() * 400;
          sac.nextAt = nowMs + randomSaccadeInterval();
        }
        const saccActive = nowMs < sac.until && (cursorIdle || touchIdle);
        const sacK = Math.min(1, delta * 14);
        sac.x += ((saccActive ? sac.dx : 0) - sac.x) * sacK;
        sac.y += ((saccActive ? sac.dy : 0) - sac.y) * sacK;

        const gazeX = look.smoothX + sac.x;
        const gazeY = look.smoothY + sac.y;
        lookTarget.position.set(gazeX * 2.2, 1.34 - gazeY * 1.1, 2.5);

        // ---- 1. Audio Lip-Sync analysis (runs FIRST so the body layers below can
        //         ride the same voice energy — the whole body moves when she talks).
        const lipTargets = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
        let frameEnergy = 0;

        if (analyserRef.current && speakingRef.current) {
          analyserRef.current.getByteFrequencyData(freqData);

          // Fast RMS with integer multiplication
          let sumSquares = 0;
          for (let i = 0; i < freqData.length; i++) {
            const v = freqData[i];
            sumSquares += v * v;
          }
          const rms = Math.sqrt(sumSquares / (freqData.length * 65025));
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

            // Dominant vowel wins with hysteresis (zero memory allocation)
            let best = lipVowelRef.current;
            let bestScore = 0;
            for (let i = 0; i < VOWEL_LIST.length; i++) {
              const item = VOWEL_LIST[i];
              const score = band(item.f1, 170) * band(item.f2, 260);
              const hurdle = item.id === best ? bestScore : bestScore * 1.15;
              if (score > hurdle) {
                best = item.id;
                bestScore = score;
              }
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

        // ---- 2. Dynamic idle anime gestures (frequent & lively like AIRI) ----
        // ---- 2. Idle micro-gestures (head and legs remain strictly still as requested) ----
        const g = gestureState.current;
        let gestureChestX = 0;
        if (!entranceState.current.active && !speakingRef.current) {
          if (g.type === null && elapsed > g.nextAt) {
            g.type = 'breathe';
            g.t = 0;
            g.duration = 2.4;
          }
          if (g.type) {
            g.t += delta;
            if (g.t >= g.duration) {
              g.type = null;
              g.nextAt = elapsed + 3.0 + Math.random() * 3.0;
            }
          }
        }

        // ---- 3a. Entrance greeting bow value (on model load): spine bows, head
        //          dips, a little hold, then release — folded into the pose below.
        const ent = entranceState.current;
        let entranceBow = 0;
        if (ent.active) {
          ent.t += delta;
          const t = ent.t;
          const bowIn = Math.min(1, t / 0.7);
          const bowOut = Math.min(1, Math.max(0, (t - (ent.duration - 0.8)) / 0.8));
          entranceBow = 0.38 * bowIn * (1 - bowOut);
          if (t >= ent.duration) ent.active = false;
        }

        // ---- 3b. Interactive touch reactions (head pat & shoulder tap) ----
        const tr = touchReaction.current;
        let touchHeadTilt = 0;
        let touchHeadPitch = 0;
        let touchHeadYaw = 0;
        let touchSurprised = 0;
        let touchRelaxed = 0;

        if (tr.active) {
          tr.t += delta;
          if (tr.t >= tr.duration) {
            tr.active = false;
          } else {
            const t = tr.t;
            if (tr.type === 'headPat') {
              // Gentle sweet tilt leaning into the touch + happy relaxed expression
              const env = Math.sin((t / tr.duration) * Math.PI);
              touchHeadTilt = 0.11 * env;
              touchHeadPitch = -0.05 * env;
              touchRelaxed = 0.85 * env;
            } else if (tr.type === 'shoulderTap') {
              // Quick surprised glance toward the tap, then a warm relieved smile
              if (t < 0.6) {
                const env = Math.sin((t / 0.6) * Math.PI);
                touchHeadYaw = 0.12 * env;
                touchHeadPitch = 0.05 * env;
                touchSurprised = 0.75 * env;
              } else {
                const env = Math.sin(((t - 0.6) / 1.2) * Math.PI);
                touchHeadTilt = -0.05 * env;
                touchRelaxed = 0.70 * env;
              }
            }
          }
        }

        // ---- 3. WHOLE-BODY MOTION (Natural breathing and arm posture; head and legs strictly grounded) ----
        if (humanoid) {
          // Gentle natural breathing cycle (chest & upper spine only)
          const breath = Math.sin(elapsed * 2.2);

          const chest = humanoid.getNormalizedBoneNode('chest');
          const spine = humanoid.getNormalizedBoneNode('spine');
          const head = humanoid.getNormalizedBoneNode('head');
          const hips = humanoid.getNormalizedBoneNode('hips');
          const lShoulder = humanoid.getNormalizedBoneNode('leftShoulder');
          const rShoulder = humanoid.getNormalizedBoneNode('rightShoulder');

          // Leg bones (ensured 100% still and grounded)
          const lUpperLeg = humanoid.getNormalizedBoneNode('leftUpperLeg');
          const rUpperLeg = humanoid.getNormalizedBoneNode('rightUpperLeg');
          const lLowerLeg = humanoid.getNormalizedBoneNode('leftLowerLeg');
          const rLowerLeg = humanoid.getNormalizedBoneNode('rightLowerLeg');
          const lFoot = humanoid.getNormalizedBoneNode('leftFoot');
          const rFoot = humanoid.getNormalizedBoneNode('rightFoot');

          // HEAD: 100% still and steady (no head wobble, tilt, nod, or dip)
          const finalHeadX = 0;
          const finalHeadY = 0;
          finalHeadZ = 0;

          if (vrmUrl === DEFAULT_VRM_URL) {
            // Shipped model
            if (chest) {
              chest.rotation.set(breath * 0.022 + voiceEnergy * 0.015, 0, 0);
            }
            if (spine) {
              spine.rotation.set(breath * 0.012 + voiceEnergy * 0.015, 0, 0);
            }
            // LEGS & HIPS: 100% completely still, grounded, zero wobble or movement
            if (hips) {
              hips.rotation.set(0, 0, 0);
            }
            if (lUpperLeg) lUpperLeg.rotation.set(0, 0, 0);
            if (rUpperLeg) rUpperLeg.rotation.set(0, 0, 0);
            if (lLowerLeg) lLowerLeg.rotation.set(0, 0, 0);
            if (rLowerLeg) rLowerLeg.rotation.set(0, 0, 0);
            if (lFoot) lFoot.rotation.set(0, 0, 0);
            if (rFoot) rFoot.rotation.set(0, 0, 0);

            if (lShoulder) lShoulder.rotation.set(0, 0, breath * 0.025);
            if (rShoulder) rShoulder.rotation.set(0, 0, -breath * 0.025);
            if (head) {
              head.rotation.set(0, 0, 0);
            }

            // Natural relaxed anime arm rest pose
            const lUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
            const rUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
            const lLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
            const rLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');
            const lHand = humanoid.getNormalizedBoneNode('leftHand');
            const rHand = humanoid.getNormalizedBoneNode('rightHand');

            if (lUpperArm) lUpperArm.rotation.set(0.08 + breath * 0.015, 0.05, -1.28 + breath * 0.02);
            if (rUpperArm) rUpperArm.rotation.set(0.08 + breath * 0.015, -0.05, 1.28 - breath * 0.02);

            if (lLowerArm) lLowerArm.rotation.set(-0.35, 0.12, -0.15);
            if (rLowerArm) rLowerArm.rotation.set(-0.35, -0.12, 0.15);

            if (lHand) lHand.rotation.set(0.08, 0.10, -0.05);
            if (rHand) rHand.rotation.set(0.08, -0.10, 0.05);

            for (const fb of FINGER_BONES) {
              const node = humanoid.getNormalizedBoneNode(fb);
              if (node) node.rotation.z = fb.startsWith('left') ? 0.22 : -0.22;
            }
          } else {
            // Added models via world-aligned bones
            const binds = bindQuatsRef.current;
            // LEGS & HIPS: strictly 0 rotation (grounded)
            poseWorldBone(hips, binds, 0, 0, 0);
            poseWorldBone(lUpperLeg, binds, 0, 0, 0);
            poseWorldBone(rUpperLeg, binds, 0, 0, 0);
            poseWorldBone(lLowerLeg, binds, 0, 0, 0);
            poseWorldBone(rLowerLeg, binds, 0, 0, 0);
            poseWorldBone(lFoot, binds, 0, 0, 0);
            poseWorldBone(rFoot, binds, 0, 0, 0);

            poseWorldBone(spine, binds, breath * 0.012 + voiceEnergy * 0.015, 0, 0);
            poseWorldBone(chest, binds, breath * 0.022 + voiceEnergy * 0.015, 0, 0);
            poseWorldBone(lShoulder, binds, 0, 0, breath * 0.025);
            poseWorldBone(rShoulder, binds, 0, 0, -breath * 0.025);
            // HEAD: strictly still
            poseWorldBone(head, binds, 0, 0, 0);

            const armPose = armRestPoseRef.current || {};
            const lUpperArm = humanoid.getNormalizedBoneNode('leftUpperArm');
            const rUpperArm = humanoid.getNormalizedBoneNode('rightUpperArm');
            const lLowerArm = humanoid.getNormalizedBoneNode('leftLowerArm');
            const rLowerArm = humanoid.getNormalizedBoneNode('rightLowerArm');

            if (armPose.left && lUpperArm) {
              lUpperArm.quaternion.copy(armPose.left.bindUpper).multiply(armPose.left.dUpper)
                .multiply(_quatB.setFromEuler(_euler.set(0.05, 0, breath * 0.015)));
            }
            if (armPose.right && rUpperArm) {
              rUpperArm.quaternion.copy(armPose.right.bindUpper).multiply(armPose.right.dUpper)
                .multiply(_quatB.setFromEuler(_euler.set(0.05, 0, -breath * 0.015)));
            }
            if (armPose.left && lLowerArm) {
              lLowerArm.quaternion.copy(armPose.left.bindLower).multiply(armPose.left.dLower);
            }
            if (armPose.right && rLowerArm) {
              rLowerArm.quaternion.copy(armPose.right.bindLower).multiply(armPose.right.dLower);
            }
          }
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

        // ---- 6. Update VRM Expressions (names resolved per model — see the
        //         expression name map built at load) ----
        if (vrm.expressionManager) {
          const nameMap = expressionNameMapRef.current;
          const setExpr = (name, value) => {
            const actual = nameMap ? nameMap[name] : name;
            if (actual) vrm.expressionManager.setValue(actual, value);
          };

          const blend = EMOTION_BLENDS[emotionRef.current] || EMOTION_BLENDS.neutral;
          const emotionK = Math.min(1, delta * 7); // ~0.3-0.6s settle

          for (const emo of EMOTION_PRESETS) {
            let target = blend.find((c) => c.name === emo)?.value || 0;
            if (emo === 'relaxed' && touchRelaxed > 0) {
              target = Math.max(target, touchRelaxed);
            } else if (emo === 'surprised' && touchSurprised > 0) {
              target = Math.max(target, touchSurprised);
            }
            expressionWeights.current[emo] += (target - expressionWeights.current[emo]) * emotionK;
            setExpr(emo, Math.max(0, Math.min(1, expressionWeights.current[emo])));
          }

          // Visemes: driven purely by audio lip-sync (strictly 0 in idle/silence).
          for (const v of VISEME_PRESETS) {
            setExpr(v, expressionWeights.current[v]);
          }

          // Blink
          setExpr('blink', expressionWeights.current.blink);

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
      roomGroupRef.current = null;
      roomSceneRef.current = null;
      sceneRef.current = null;
      cancelAnimationFrame(animId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', onWinResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      cleanupModel?.();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [retryKey, vrmUrl]);

  return (
    <div className="canvas-container" ref={mountRef}>
      {loaderVisible && !loadError && (
        <div className={`vrm-loading-wrapper ${isLoaded ? 'fade-out' : ''}`}>
          <BirdLoader progress={loadProgress} />
        </div>
      )}

      {isStudioOpen && isLoaded && (
        <div className="canvas-studio-hud">
          <div className="canvas-studio-hud__badge">
            <span className="hud-pulse-dot" />
            <span className="hud-title">3D Live Studio</span>
            <span className="hud-part-label">
              {customizingPart === 'eyes'
                ? '👁️ Viewing: Eyes & Iris'
                : customizingPart === 'clothes'
                ? '👗 Viewing: Outfit & Dress'
                : customizingPart === 'shoes'
                ? '👠 Viewing: Shoes & Footwear'
                : customizingPart === 'hair'
                ? '✂️ Viewing: Hair & Face'
                : customizingPart === 'skin'
                ? '🌸 Viewing: Skin Tone'
                : '✨ Live 3D Preview'}
            </span>
          </div>
          <div className="canvas-studio-hud__bar">
            <div className="hud-focus-chips">
              <button
                type="button"
                className={`hud-chip ${studioFocus === 'face' ? 'active' : ''}`}
                onClick={() => onFocusChange?.('face')}
                title="Zoom into Face & Eyes"
              >
                👁️ Face
              </button>
              <button
                type="button"
                className={`hud-chip ${studioFocus === 'body' ? 'active' : ''}`}
                onClick={() => onFocusChange?.('body')}
                title="Focus Outfit & Dress"
              >
                👗 Outfit
              </button>
              <button
                type="button"
                className={`hud-chip ${studioFocus === 'shoes' ? 'active' : ''}`}
                onClick={() => onFocusChange?.('shoes')}
                title="View Shoes & Legs"
              >
                👠 Shoes
              </button>
              <button
                type="button"
                className={`hud-chip ${studioFocus === 'default' ? 'active' : ''}`}
                onClick={() => onFocusChange?.('default')}
                title="Full Body View"
              >
                🧍 Full
              </button>
            </div>
            <div className="hud-rotate-chips">
              <button
                type="button"
                className="hud-chip icon"
                onClick={() => onRotateModel?.((r) => r - 45)}
                title="Turn Left (-45°)"
              >
                ⟲
              </button>
              <button
                type="button"
                className={`hud-chip ${Math.round((modelRotation || 0) % 360) === 0 ? 'active' : ''}`}
                onClick={() => onRotateModel?.(0)}
                title="Front View"
              >
                Front
              </button>
              <button
                type="button"
                className={`hud-chip ${Math.round(Math.abs((modelRotation || 0) % 360)) === 90 ? 'active' : ''}`}
                onClick={() => onRotateModel?.(90)}
                title="Side View"
              >
                Side
              </button>
              <button
                type="button"
                className={`hud-chip ${Math.round(Math.abs((modelRotation || 0) % 360)) === 180 ? 'active' : ''}`}
                onClick={() => onRotateModel?.(180)}
                title="Back View (inspect back of hair & outfit)"
              >
                Back
              </button>
              <button
                type="button"
                className="hud-chip icon"
                onClick={() => onRotateModel?.((r) => r + 45)}
                title="Turn Right (+45°)"
              >
                ⟳
              </button>
            </div>
            <span className="hud-drag-tip">💡 Drag 3D character to rotate 360°</span>
          </div>
        </div>
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
