/**
 * Render a scripted session through the real solver + synth to WAV files and
 * print per-segment levels, so the mix can be checked without a browser.
 *
 *   npm run render            all presets → out/*.wav
 *   npm run render -- 650     presets whose id contains "650"
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { EngineSynth } from '../src/audio/synth.ts';
import { PRESETS, type EnginePreset } from '../src/sim/config.ts';
import { EngineCore } from '../src/sim/core.ts';

const FS = 48000;

interface Segment {
  name: string;
  seconds: number;
  apply: (core: EngineCore, t: number) => void;
}

const SCRIPT: Segment[] = [
  { name: '起动', seconds: 0.8, apply: (c) => (c.controls.starter = c.rpm < 1100) },
  { name: '怠速', seconds: 2.5, apply: (c) => (c.controls.starter = false) },
  { name: '轰油', seconds: 1.2, apply: (c, t) => (c.controls.throttle = t < 0.25 ? 1 : 0) },
  { name: '全油门', seconds: 2.5, apply: (c) => (c.controls.throttle = 1) },
  { name: '收油', seconds: 3, apply: (c) => (c.controls.throttle = 0) },
];

function render(preset: EnginePreset): void {
  const core = new EngineCore(preset.engine, preset.ecu);
  const synth = new EngineSynth(FS, preset.engine);
  const total = SCRIPT.reduce((s, x) => s + x.seconds, 0);
  const left = new Float32Array(Math.round(total * FS));
  const right = new Float32Array(left.length);
  let i = 0;
  console.log(`\n${preset.name}`);
  for (const seg of SCRIPT) {
    const n = Math.round(seg.seconds * FS);
    let sq = 0;
    let peak = 0;
    let rpmMax = 0;
    for (let k = 0; k < n; k++, i++) {
      seg.apply(core, k / FS);
      core.step(1 / FS);
      synth.tick(core);
      left[i] = synth.outL;
      right[i] = synth.outR;
      sq += synth.outL * synth.outL;
      peak = Math.max(peak, Math.abs(synth.outL));
      rpmMax = Math.max(rpmMax, core.rpm);
    }
    const rms = Math.sqrt(sq / n);
    const db = (x: number): string => (20 * Math.log10(Math.max(1e-6, x))).toFixed(1).padStart(6);
    console.log(`  ${seg.name.padEnd(4, '　')}  RMS ${db(rms)} dBFS  峰值 ${db(peak)} dBFS  最高 ${rpmMax.toFixed(0)} rpm`);
  }
  mkdirSync('out', { recursive: true });
  writeFileSync(`out/${preset.id}.wav`, wav(left, right));
}

function wav(l: Float32Array, r: Float32Array): Buffer {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(FS, 24);
  buf.writeUInt32LE(FS * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round((l[i] ?? 0) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round((r[i] ?? 0) * 32767), 46 + i * 4);
  }
  return buf;
}

const filter = process.argv[2];
for (const p of PRESETS) if (!filter || p.id.includes(filter)) render(p);
