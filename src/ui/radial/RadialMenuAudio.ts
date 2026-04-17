/**
 * Radial menu audio feedback — synthesized tones via Web Audio API.
 *
 * No external assets — all sounds generated on the fly with oscillators
 * + ADSR envelopes. This keeps bundle size small and guarantees tight
 * timing (no decoder latency).
 *
 * Sound design:
 *
 *   OPEN        — rising chirp (220 → 880 Hz, 80 ms), triangle wave
 *                 → "something appeared" feeling
 *
 *   SECTOR_CROSS — subtle tick (1400 Hz, 20 ms), very low volume
 *                 → tactile feedback as cursor crosses boundaries
 *                   Think: keyboard click or tape-measure notch
 *
 *   HOVER_LOCK  — soft bump (550 Hz, 40 ms) when sector locks on
 *                 → different from CROSS so you can tell "settled"
 *                   vs "passing through"
 *
 *   CONFIRM     — major third interval (C5 + E5, 150 ms), sine + triangle
 *                 → happy confirmation tone
 *
 *   CANCEL      — falling chirp (880 → 220 Hz, 120 ms), sawtooth
 *                 → "undone" sound
 *
 *   CLOSE       — soft whoosh (filtered noise, 100 ms)
 *                 → gentle wind-down
 *
 *   SUBTYPE_CYCLE — single note scaled by index (A3 + index * 50 Hz)
 *                 → pitch ladder tells you roughly where you are in list
 *
 * All sounds respect a master volume (default 0.2 — these are UI,
 * not music, they should be subtle).
 */

// ── Audio context (lazy init) ───────────────────────────────────

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterVolume = 0.25;
let enabled = true;

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ── Low-level tone generator with ADSR ──────────────────────────

interface ToneOptions {
  freq: number;
  durationMs: number;
  type?: OscillatorType;
  attackMs?: number;
  decayMs?: number;
  sustainLevel?: number;
  releaseMs?: number;
  volume?: number;
  freqEndHz?: number; // for pitch slides
}

function playTone(opts: ToneOptions): void {
  if (!enabled) return;
  try {
    const ac = ensureCtx();
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = opts.type ?? 'sine';
    osc.frequency.value = opts.freq;

    const now = ac.currentTime;
    const dur = opts.durationMs / 1000;
    const atk = (opts.attackMs ?? 5) / 1000;
    const dec = (opts.decayMs ?? 10) / 1000;
    const sus = opts.sustainLevel ?? 0.7;
    const rel = (opts.releaseMs ?? 40) / 1000;
    const vol = opts.volume ?? 1;

    // ADSR envelope
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(vol, now + atk);
    gain.gain.linearRampToValueAtTime(vol * sus, now + atk + dec);
    gain.gain.setValueAtTime(vol * sus, now + dur - rel);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    // Optional pitch slide
    if (opts.freqEndHz !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(10, opts.freqEndHz),
        now + dur,
      );
    }

    osc.connect(gain);
    gain.connect(masterGain!);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  } catch {
    // audio not ready, silently skip
  }
}

// ── Noise burst (for whoosh) ────────────────────────────────────

function playNoiseBurst(durationMs: number, lowpassHz: number, volume: number): void {
  if (!enabled) return;
  try {
    const ac = ensureCtx();
    const bufferSize = Math.ceil(ac.sampleRate * (durationMs / 1000));
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const src = ac.createBufferSource();
    src.buffer = buffer;

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;

    const gain = ac.createGain();
    const now = ac.currentTime;
    const dur = durationMs / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain!);
    src.start(now);
    src.stop(now + dur);
  } catch {}
}

// ── Public API ──────────────────────────────────────────────────

export const radialAudio = {
  /** Wheel opens. */
  open(): void {
    playTone({
      freq: 220, freqEndHz: 660, durationMs: 100,
      type: 'triangle', attackMs: 3, decayMs: 15, sustainLevel: 0.4, releaseMs: 60, volume: 0.4,
    });
  },

  /** Cursor crosses a sector boundary. */
  sectorCross(): void {
    playTone({
      freq: 1400, durationMs: 18,
      type: 'square', attackMs: 1, decayMs: 4, sustainLevel: 0, releaseMs: 8, volume: 0.08,
    });
  },

  /** Sector becomes highlighted (settled on). */
  hoverLock(): void {
    playTone({
      freq: 660, durationMs: 45,
      type: 'sine', attackMs: 2, decayMs: 10, sustainLevel: 0.5, releaseMs: 25, volume: 0.18,
    });
  },

  /** Selection committed. */
  confirm(): void {
    playTone({
      freq: 523.25, durationMs: 120, // C5
      type: 'sine', attackMs: 3, decayMs: 20, sustainLevel: 0.6, releaseMs: 80, volume: 0.3,
    });
    setTimeout(() => {
      playTone({
        freq: 659.25, durationMs: 150, // E5
        type: 'triangle', attackMs: 3, decayMs: 25, sustainLevel: 0.5, releaseMs: 100, volume: 0.25,
      });
    }, 40);
  },

  /** Selection canceled / wheel dismissed. */
  cancel(): void {
    playTone({
      freq: 880, freqEndHz: 220, durationMs: 130,
      type: 'sawtooth', attackMs: 2, decayMs: 15, sustainLevel: 0.3, releaseMs: 80, volume: 0.2,
    });
  },

  /** Wheel closes (normal dismiss, not cancel). */
  close(): void {
    playNoiseBurst(90, 2000, 0.08);
  },

  /** Subtype scroll cycle. Pitch scales with index. */
  subtypeCycle(index: number, total: number): void {
    const base = 440;
    const step = 1.12; // semitone-ish
    const freq = base * Math.pow(step, (index / Math.max(1, total - 1)) * 8);
    playTone({
      freq, durationMs: 50,
      type: 'square', attackMs: 2, decayMs: 10, sustainLevel: 0.4, releaseMs: 25, volume: 0.12,
    });
  },

  /** Master volume (0-1). */
  setVolume(vol: number): void {
    masterVolume = Math.max(0, Math.min(1, vol));
    if (masterGain) masterGain.gain.value = masterVolume;
  },

  /** Enable/disable all radial audio. */
  setEnabled(on: boolean): void {
    enabled = on;
  },

  /** Force-unlock audio context on first user gesture. */
  unlock(): void {
    ensureCtx();
  },
};
