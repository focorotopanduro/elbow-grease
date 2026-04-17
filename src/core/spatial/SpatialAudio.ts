/**
 * Spatial Audio Feedback — 3D positional audio for pipe events.
 *
 * Uses the Web Audio API with HRTF panning to place sounds in 3D
 * space. When a pipe snaps at position [2, 0, -1], the snap sound
 * comes from that direction in the user's headphones/speakers.
 *
 * In VR, this dramatically enhances spatial awareness — the user
 * hears where things happen, not just sees them.
 *
 * Sound categories:
 *   snap    → short metallic click at snap position
 *   route   → subtle flow/whoosh along the pipe path
 *   error   → low buzz at violation position
 *   reward  → satisfying chime at completion point
 *   ambient → quiet HVAC hum for immersion
 */

import { eventBus } from '../EventBus';
import { EV, type Vec3, type RewardPayload, type CuePayload } from '../events';

// ── Audio context (lazy init) ───────────────────────────────────

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let listener3D: AudioListener | null = null;

function getAudioContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
    listener3D = ctx.listener;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ── Synthesized sounds (no external files needed) ───────────────

function playToneAt(
  position: Vec3,
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.3,
): void {
  const audio = getAudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  const panner = audio.createPanner();

  // 3D position
  panner.positionX.value = position[0];
  panner.positionY.value = position[1];
  panner.positionZ.value = position[2];
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 30;
  panner.rolloffFactor = 1.5;

  osc.type = type;
  osc.frequency.value = frequency;

  // Envelope: quick attack, sustain, release
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + 0.01);
  gain.gain.setValueAtTime(volume, now + duration * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain);
  gain.connect(panner);
  panner.connect(masterGain!);

  osc.start(now);
  osc.stop(now + duration);
}

function playSnapSound(position: Vec3): void {
  // Short metallic click: high freq, very short
  playToneAt(position, 2400, 0.08, 'square', 0.15);
  playToneAt(position, 3600, 0.05, 'sine', 0.1);
}

function playRouteSound(position: Vec3): void {
  // Subtle whoosh
  playToneAt(position, 200, 0.15, 'sine', 0.08);
}

function playErrorSound(position: Vec3): void {
  // Low buzz
  playToneAt(position, 120, 0.3, 'sawtooth', 0.2);
  playToneAt(position, 90, 0.4, 'square', 0.1);
}

function playRewardSound(position: Vec3, intensity: number): void {
  // Ascending chime — more notes for higher intensity
  const baseFreq = 523; // C5
  const notes = intensity > 0.7 ? [1, 1.25, 1.5, 2] : [1, 1.25];
  notes.forEach((mult, i) => {
    setTimeout(() => {
      playToneAt(position, baseFreq * mult, 0.25, 'sine', 0.25 * intensity);
    }, i * 80);
  });
}

// ── Listener position update ────────────────────────────────────

export function updateListenerPosition(position: Vec3, forward: Vec3): void {
  if (!listener3D) return;
  if (listener3D.positionX) {
    listener3D.positionX.value = position[0];
    listener3D.positionY.value = position[1];
    listener3D.positionZ.value = position[2];
    listener3D.forwardX.value = forward[0];
    listener3D.forwardY.value = forward[1];
    listener3D.forwardZ.value = forward[2];
    listener3D.upX.value = 0;
    listener3D.upY.value = 1;
    listener3D.upZ.value = 0;
  }
}

export function setMasterVolume(vol: number): void {
  if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, vol));
}

// ── EventBus wiring ─────────────────────────────────────────────

let booted = false;

export function bootSpatialAudio(): void {
  if (booted) return;
  booted = true;

  eventBus.on(EV.PIPE_SNAP, (payload: { position: Vec3 }) => {
    playSnapSound(payload.position);
  });

  eventBus.on(EV.PIPE_ROUTE_UPDATE, (payload: { points: Vec3[] }) => {
    const last = payload.points[payload.points.length - 1];
    if (last) playRouteSound(last);
  });

  eventBus.on<CuePayload>(EV.CUE, (payload) => {
    if (payload.type === 'highlight' && payload.position) {
      playErrorSound(payload.position);
    }
  });

  eventBus.on<RewardPayload>(EV.REWARD, (payload) => {
    const pos = payload.position ?? [0, 2, 0];
    playRewardSound(pos, payload.intensity);
  });
}
