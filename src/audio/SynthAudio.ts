export class SynthAudio {
  private ctx: AudioContext | null = null;
  public lastPlayedBhopFreq = 0;
  public bhopTickCount = 0;

  // Speed whoosh / wind rush audio loop
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windNoiseSource: AudioBufferSourceNode | null = null;
  private windInitialized = false;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.ctx && !this.windInitialized) {
      this.initWindLoop();
    }
  }

  private initWindLoop(): void {
    if (!this.ctx || this.windInitialized) return;
    this.windInitialized = true;

    try {
      // 2 seconds of pink/white noise buffer for smooth looping wind
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        data[i] = (b0 + b1 + b2 + white * 0.5362) * 0.11;
      }

      this.windFilter = this.ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.setValueAtTime(350, this.ctx.currentTime);
      this.windFilter.Q.setValueAtTime(1.6, this.ctx.currentTime);

      this.windGain = this.ctx.createGain();
      this.windGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.ctx.destination);

      this.windNoiseSource = this.ctx.createBufferSource();
      this.windNoiseSource.buffer = noiseBuffer;
      this.windNoiseSource.loop = true;
      this.windNoiseSource.connect(this.windFilter);
      this.windNoiseSource.start(0);
    } catch {
      // AudioContext may not be allowed to auto-play before gesture
    }
  }

  /**
   * Dynamically adjusts wind rush / speed whoosh based on player UPS
   */
  public updateSpeedLoop(ups: number, dt: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter) return;

    // Wind rush begins subtly above 290 UPS and swells powerfully toward 900+ UPS
    const speedRatio = Math.max(0, Math.min(1.2, (ups - 290) / 580));
    const targetGain = speedRatio > 0.02 ? Math.min(0.24, speedRatio * 0.18) : 0.0001;
    const targetFreq = 260 + speedRatio * 1650;

    const now = this.ctx.currentTime;
    const rampRate = Math.min(1, dt * 10);
    const curGain = this.windGain.gain.value;
    const newGain = curGain + (targetGain - curGain) * rampRate;
    this.windGain.gain.setValueAtTime(Math.max(0.0001, newGain), now);

    const curFreq = this.windFilter.frequency.value;
    const newFreq = curFreq + (targetFreq - curFreq) * rampRate;
    this.windFilter.frequency.setValueAtTime(Math.max(100, newFreq), now);
  }

  /**
   * Resonant hypersonic boost pad turbine surge
   */
  public playBoost(ups = 600): void {
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;

    // 1. Low sonic punch
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(160, now);
    subOsc.frequency.exponentialRampToValueAtTime(42, now + 0.28);
    subGain.gain.setValueAtTime(0.32, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    subOsc.connect(subGain);
    subGain.connect(this.ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 0.32);

    // 2. Rising turbine flare / laser chirp
    const flareOsc = this.ctx.createOscillator();
    const flareGain = this.ctx.createGain();
    flareOsc.type = 'sawtooth';
    const startPitch = Math.min(800, 320 + (ups / 1000) * 200);
    flareOsc.frequency.setValueAtTime(startPitch, now);
    flareOsc.frequency.exponentialRampToValueAtTime(startPitch * 2.8, now + 0.22);
    flareGain.gain.setValueAtTime(0.22, now);
    flareGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    flareOsc.connect(flareGain);
    flareGain.connect(this.ctx.destination);
    flareOsc.start(now);
    flareOsc.stop(now + 0.26);
  }

  /**
   * Pitch-ascending bhop landing synth tick that rises in frequency as UPS climbs
   */
  public playBhopTick(ups: number, isDoubleJump = false): void {
    this.unlock();
    const speedRatio = Math.max(0, Math.min(1, (ups - 280) / 620));
    const baseFreq = isDoubleJump
      ? 520 + speedRatio * 560
      : 320 + speedRatio * 540;
    this.lastPlayedBhopFreq = Math.round(baseFreq);
    this.bhopTickCount++;

    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isDoubleJump ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.38, now + 0.065);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  /**
   * TFC Conc-Style Impulse Dash synth burst
   */
  public playDash(): void {
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.14);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.17);
  }

  public playDerezz(): void {
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.35);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.37);
  }

  /**
   * High-tech mode / collision toggle audio cue
   */
  public playToggle(enabled: boolean): void {
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = enabled ? 'sine' : 'triangle';
    const startFreq = enabled ? 380 : 640;
    const endFreq = enabled ? 720 : 320;

    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.1);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.13);
  }

  /**
   * Resonant cyber bump sound when colliding with another runner in competitive mode
   */
  public playPlayerBump(relSpeed = 100): void {
    this.unlock();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    const freq = Math.min(680, 220 + relSpeed * 0.8);
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.09);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.11);
  }
}
