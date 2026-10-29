/** Small allocation-free DSP blocks used by the engine synthesiser. */

export class OnePole {
  private a = 0;
  private z = 0;

  constructor(cutoffHz: number, sampleRate: number) {
    this.setCutoff(cutoffHz, sampleRate);
  }

  setCutoff(cutoffHz: number, sampleRate: number): void {
    this.a = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate);
  }

  lowpass(x: number): number {
    this.z += this.a * (x - this.z);
    return this.z;
  }

  highpass(x: number): number {
    return x - this.lowpass(x);
  }
}

/** RBJ biquad, transposed direct form II. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  static bandpass(freq: number, q: number, sampleRate: number): Biquad {
    return new Biquad().setBandpass(freq, q, sampleRate);
  }

  static lowpass(freq: number, q: number, sampleRate: number): Biquad {
    return new Biquad().setLowpass(freq, q, sampleRate);
  }

  setBandpass(freq: number, q: number, sampleRate: number): this {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  setLowpass(freq: number, q: number, sampleRate: number): this {
    const w = (2 * Math.PI * Math.min(freq, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cw = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cw) / 2 / a0;
    this.b1 = (1 - cw) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cw) / a0;
    this.a2 = (1 - alpha) / a0;
    return this;
  }

  process(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Circular delay with linearly interpolated fractional reads. */
export class Delay {
  private readonly buf: Float32Array;
  private readonly mask: number;
  private w = 0;

  constructor(maxSamples: number) {
    let size = 1;
    while (size < maxSamples + 2) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
  }

  write(x: number): void {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }

  /** Value written `delay` samples ago (delay ≥ 1). */
  read(delay: number): number {
    const d = Math.max(1, Math.min(this.mask - 1, delay));
    const i = Math.floor(d);
    const f = d - i;
    const a = this.buf[(this.w - i) & this.mask] ?? 0;
    const b = this.buf[(this.w - i - 1) & this.mask] ?? 0;
    return a + (b - a) * f;
  }
}

class Comb {
  private readonly buf: Float32Array;
  private i = 0;
  private store = 0;

  constructor(
    size: number,
    private readonly feedback: number,
    private readonly damp: number,
  ) {
    this.buf = new Float32Array(size);
  }

  process(x: number): number {
    const y = this.buf[this.i] ?? 0;
    this.store = y * (1 - this.damp) + this.store * this.damp;
    this.buf[this.i] = x + this.store * this.feedback;
    this.i = (this.i + 1) % this.buf.length;
    return y;
  }
}

class Allpass {
  private readonly buf: Float32Array;
  private i = 0;

  constructor(size: number) {
    this.buf = new Float32Array(size);
  }

  process(x: number): number {
    const b = this.buf[this.i] ?? 0;
    this.buf[this.i] = x + b * 0.5;
    this.i = (this.i + 1) % this.buf.length;
    return b - x;
  }
}

/** A small, fairly dry test-cell room (Schroeder/Freeverb style). */
export class Room {
  private readonly combsL: Comb[];
  private readonly combsR: Comb[];
  private readonly apL: Allpass[];
  private readonly apR: Allpass[];
  outL = 0;
  outR = 0;

  constructor(sampleRate: number) {
    const k = sampleRate / 44100;
    const combSizes = [1116, 1188, 1277, 1356];
    const apSizes = [556, 441];
    const spread = 23;
    this.combsL = combSizes.map((s) => new Comb(Math.round(s * k * 0.6), 0.74, 0.35));
    this.combsR = combSizes.map((s) => new Comb(Math.round((s + spread) * k * 0.6), 0.74, 0.35));
    this.apL = apSizes.map((s) => new Allpass(Math.round(s * k)));
    this.apR = apSizes.map((s) => new Allpass(Math.round((s + spread) * k)));
  }

  process(x: number): void {
    let l = 0;
    let r = 0;
    for (const c of this.combsL) l += c.process(x);
    for (const c of this.combsR) r += c.process(x);
    for (const a of this.apL) l = a.process(l);
    for (const a of this.apR) r = a.process(r);
    this.outL = l * 0.25;
    this.outR = r * 0.25;
  }
}
