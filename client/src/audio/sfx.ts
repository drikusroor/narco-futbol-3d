/**
 * Every sound in the game is synthesised in the browser: boots on the ball, a
 * referee's whistle, a crowd made of filtered noise. No audio files to load,
 * and swapping in real recordings later is a matter of replacing these calls.
 */
function loadVolume(): number {
  try {
    const raw = localStorage.getItem('nf.volume');
    if (raw !== null) {
      const v = Number(raw);
      if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
    }
  } catch {
    // no storage; fall back to the default level
  }
  return 0.55;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private lastStep = 0;
  muted = false;
  /** 0..1 from the settings screen; 0.55 is the old fixed level. */
  private volume = loadVolume();

  /** Must be called from a user gesture - browsers insist. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);

    // Pre-render a second of noise; everything percussive is built from it.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    this.startCrowd();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.applyGain();
    return this.muted;
  }

  /** Master volume, 0..1. Unmutes as soon as you drag it up. */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.volume > 0) this.muted = false;
    this.applyGain();
    try {
      localStorage.setItem('nf.volume', String(this.volume));
    } catch {
      // not persisting is survivable
    }
  }

  getVolume(): number {
    return this.volume;
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private get t(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private noise(duration: number): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noiseBuffer) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.start(this.t);
    src.stop(this.t + duration);
    return src;
  }

  private env(attack: number, decay: number, peak: number): GainNode | null {
    if (!this.ctx || !this.master) return null;
    const g = this.ctx.createGain();
    const now = this.t;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    g.connect(this.master);
    return g;
  }

  // --- ambience -------------------------------------------------------------

  private startCrowd(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.055;

    src.connect(filter).connect(gain).connect(this.master);
    src.start();

    this.crowdGain = gain;
    this.crowdFilter = filter;
  }

  /** 0..1 - murmur through to full roar. */
  setCrowd(level: number): void {
    if (!this.crowdGain || !this.crowdFilter || !this.ctx) return;
    const now = this.t;
    const target = 0.045 + level * 0.28;
    this.crowdGain.gain.setTargetAtTime(target, now, 0.25);
    this.crowdFilter.frequency.setTargetAtTime(480 + level * 900, now, 0.3);
  }

  // --- one shots ------------------------------------------------------------

  kick(power: number): void {
    if (!this.ctx) return;
    const thumpGain = this.env(0.004, 0.12 + power * 0.08, 0.5 + power * 0.4);
    if (thumpGain) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(190 + power * 120, this.t);
      osc.frequency.exponentialRampToValueAtTime(58, this.t + 0.14);
      osc.connect(thumpGain);
      osc.start();
      osc.stop(this.t + 0.25);
    }
    // The leathery slap on top.
    const slapGain = this.env(0.002, 0.06, 0.28 + power * 0.3);
    const src = this.noise(0.12);
    if (slapGain && src) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400 + power * 900;
      bp.Q.value = 1.1;
      src.connect(bp).connect(slapGain);
    }
  }

  /** Boot scuffing turf - called on a stride cadence while running. */
  step(speed: number, now: number): void {
    if (!this.ctx) return;
    const interval = Math.max(0.19, 0.52 - speed * 0.03);
    if (now - this.lastStep < interval) return;
    this.lastStep = now;
    const g = this.env(0.003, 0.07, 0.03 + speed * 0.006);
    const src = this.noise(0.09);
    if (g && src) {
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1800;
      src.connect(hp).connect(g);
    }
  }

  slide(): void {
    if (!this.ctx) return;
    const g = this.env(0.02, 0.42, 0.34);
    const src = this.noise(0.5);
    if (g && src) {
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2200, this.t);
      bp.frequency.exponentialRampToValueAtTime(420, this.t + 0.42);
      bp.Q.value = 0.9;
      src.connect(bp).connect(g);
    }
  }

  tackle(): void {
    if (!this.ctx) return;
    const g = this.env(0.003, 0.1, 0.4);
    const src = this.noise(0.14);
    if (g && src) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      src.connect(lp).connect(g);
    }
  }

  /** Two detuned tones plus a warble - a cheap pea whistle. */
  whistle(long = false): void {
    if (!this.ctx || !this.master) return;
    const dur = long ? 0.75 : 0.34;
    const g = this.env(0.012, dur, 0.24);
    if (!g) return;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 24;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);

    for (const [freq, detune] of [
      [2650, 0],
      [3320, 12],
    ] as const) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      lfoGain.connect(osc.frequency);
      osc.connect(g);
      osc.start();
      osc.stop(this.t + dur + 0.1);
    }
    lfo.start();
    lfo.stop(this.t + dur + 0.1);
  }

  post(): void {
    if (!this.ctx) return;
    const g = this.env(0.002, 0.9, 0.32);
    if (!g) return;
    // Metallic clang: a carrier plus an inharmonic modulator.
    const carrier = this.ctx.createOscillator();
    const mod = this.ctx.createOscillator();
    const modGain = this.ctx.createGain();
    carrier.frequency.value = 720;
    mod.frequency.value = 1730;
    modGain.gain.value = 900;
    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(g);
    carrier.start();
    mod.start();
    carrier.stop(this.t + 1);
    mod.stop(this.t + 1);
  }

  bounce(power: number): void {
    if (!this.ctx) return;
    const g = this.env(0.002, 0.09, Math.min(0.3, 0.04 + power * 0.02));
    const src = this.noise(0.1);
    if (g && src) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1300;
      src.connect(lp).connect(g);
    }
  }

  wall(power: number): void {
    if (!this.ctx) return;
    const g = this.env(0.002, 0.16, Math.min(0.34, 0.05 + power * 0.02));
    if (!g) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(160, this.t);
    osc.frequency.exponentialRampToValueAtTime(70, this.t + 0.15);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    osc.connect(lp).connect(g);
    osc.start();
    osc.stop(this.t + 0.2);
  }

  /** Bright little arpeggio when you run over contraband. */
  powerup(): void {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      const g = this.ctx!.createGain();
      const at = this.t + i * 0.06;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.22, at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      g.connect(this.master!);
      const osc = this.ctx!.createOscillator();
      osc.type = 'square';
      osc.frequency.value = f;
      osc.connect(g);
      osc.start(at);
      osc.stop(at + 0.18);
    });
  }

  /** Air horn over the roar. */
  goal(): void {
    if (!this.ctx || !this.master) return;
    this.setCrowd(1);
    const g = this.env(0.03, 1.4, 0.3);
    if (!g) return;
    for (const f of [233, 311, 466]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1600;
      osc.connect(lp).connect(g);
      osc.start();
      osc.stop(this.t + 1.5);
    }
  }

  /** A gasp when a chance goes begging. */
  gasp(): void {
    this.setCrowd(0.75);
  }
}
