// Beat detection for the PMV Generator and Media Storm – runs entirely in the browser (Web Audio).
// 1. Onset curve: energy rises in the bass (kick drum) and in the whole signal.
// 2. Tempo: autocorrelation of the onset curve, weighted around 120 BPM (against octave errors).
// 3. Beats: dynamic programming after D. Ellis (2007) – follows small tempo fluctuations.
// 4. Energy per beat (0–1): this gives the calm parts and the drops.
// 5. Pace per beat (0–1): how busy the music is – hi-hats, fills and drum rolls feel faster at the same tempo.
//
// Long files (DJ mixes, over 45 min): decoding the whole thing at once needs ~2.5 GB for two hours –
// more than a browser allows. Those are read piece by piece (WAV directly, MP3 in frame-aligned
// pieces), each piece is boiled down to the onset curve right away (a few MB for hours), the tempo
// is found per 2-minute stretch (a mix changes tempo), and the song plays streamed from the file.

const HOP = 512;
const LONG = 45 * 60;
const LSR = 22050; // long files: analysed at 22.05 kHz …
const LHOP = 256; // … with the same frame rate as normal songs (44100 / 512)

export async function analyzeSong(arrayBuffer) {
  return analyzeBuffer(await new OfflineAudioContext(1, 1, 44100).decodeAudioData(arrayBuffer));
}

// A file or blob: normal songs as before; long ones piece by piece → { long: true, media, frames, … }
export async function analyzeFile(file, onProgress = () => {}) {
  const dur = await mediaDuration(file);
  if (!(dur > LONG)) return analyzeSong(await file.arrayBuffer());
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const tag = String.fromCharCode(...head);
  let frames;
  if (tag.startsWith("RIFF") && tag.slice(8, 12) === "WAVE") frames = await readWav(file, dur, onProgress);
  else if (tag.startsWith("ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) frames = await readMp3(file, dur, onProgress);
  else throw new Error(`This song is very long (${Math.round(dur / 60)} min) – the browser can only read long files as MP3 or WAV. Convert it to MP3, or cut it into parts.`);
  return Object.assign(songFromFrames(frames), { frames, media: URL.createObjectURL(file) });
}

// Only a part of a long song (seconds) – from the stored onset curves, no reading again
export function songFromFrames(F, from = 0, to = Infinity) {
  const fps = LSR / LHOP;
  const a = Math.max(0, Math.floor(from * fps));
  const b = Math.min(F.n, Math.ceil(Math.min(to, F.n / fps) * fps));
  const eLow = F.eLow.subarray(a, b);
  const eAll = F.eAll.subarray(a, b);
  const n = b - a;
  const onset = onsetCurve(eLow, eAll, fps);
  // Tempo per 2-minute stretch (a mix changes tempo), beats per stretch, stitched in the overlaps
  const W = Math.round(120 * fps);
  const step = Math.round(100 * fps);
  const margin = Math.round(10 * fps);
  const beats = [];
  const periods = [];
  for (let s = 0; s < n; s += step) {
    const e = Math.min(n, s + W);
    const seg = onset.subarray(s, e);
    if (seg.length < fps * 8) break;
    const P = estimatePeriod(seg, fps);
    periods.push(P);
    const lo = s === 0 ? 0 : s + margin;
    const hi = e >= n ? n : e - margin;
    for (const f of trackBeats(seg, P)) {
      const g = f + s;
      if (g < lo || g >= hi) continue;
      if (beats.length && g - beats[beats.length - 1] < 0.5 * P) continue;
      beats.push(g);
    }
    if (e >= n) break;
  }
  const sorted = periods.slice().sort((x, y) => x - y);
  const P = sorted[sorted.length >> 1] || fps / 2;
  // Energy per beat from the frame energies; the overview from the frame peaks
  const rms = beats.map((f, k) => {
    const end = beats[k + 1] || Math.min(n, f + Math.round(P));
    let s = 0;
    for (let i = f; i < end; i++) s += eAll[i];
    return Math.sqrt(s / Math.max(1, (end - f) * LHOP));
  });
  const peaks = new Float32Array(800);
  const per = Math.max(1, Math.floor(n / 800));
  for (let i = 0; i < 800; i++) {
    let m = 0;
    for (let j = i * per, end = Math.min(n, j + per); j < end; j++) m = Math.max(m, F.peak[a + j]);
    peaks[i] = m;
  }
  return { duration: n / fps, bpm: (60 * fps) / P, beats: beats.map((f) => f / fps), energy: normEnergy(rms), pace: beatPace(onset, beats, P), peaks, long: true };
}

function mediaDuration(file) {
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(v);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => finish(isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => finish(0);
    setTimeout(() => finish(0), 15000);
    el.src = url;
  });
}

// Collects frame energies (bass and all), frame peaks – for any length, at 22.05 kHz
class FrameSink {
  constructor(total) {
    const cap = Math.ceil(total / LHOP) + 64;
    this.eLow = new Float32Array(cap);
    this.eAll = new Float32Array(cap);
    this.peak = new Float32Array(cap);
    this.n = 0;
    this.acc = 0;
    this.accLow = 0;
    this.max = 0;
    this.k = 0;
    const w = (2 * Math.PI * 160) / LSR;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.f = { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  push(x) {
    const { b0, b1, b2, a1, a2 } = this.f;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + b1 * this.x1 + b2 * this.x2 - a1 * this.y1 - a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = v;
      this.y2 = this.y1;
      this.y1 = y;
      this.acc += v * v;
      this.accLow += y * y;
      const av = v < 0 ? -v : v;
      if (av > this.max) this.max = av;
      if (++this.k === LHOP) {
        if (this.n >= this.eAll.length) this.grow();
        this.eAll[this.n] = this.acc;
        this.eLow[this.n] = this.accLow;
        this.peak[this.n] = this.max;
        this.n++;
        this.acc = this.accLow = this.max = 0;
        this.k = 0;
      }
    }
  }
  grow() {
    for (const k of ["eLow", "eAll", "peak"]) {
      const b = new Float32Array(this[k].length * 2);
      b.set(this[k]);
      this[k] = b;
    }
  }
}

// Linear resampling to 22.05 kHz, carried across pieces
function resampler(rate) {
  const step = rate / LSR;
  let t = 0; // next output position in input samples, relative to the current piece (-1 … 0: between pieces)
  let last = 0;
  return (x) => {
    const n = x.length;
    const out = new Float32Array(Math.max(0, Math.floor((n - 1 - t) / step) + 2));
    const at = (i) => (i < 0 ? last : x[i]);
    let o = 0;
    while (t <= n - 1) {
      const i = Math.floor(t);
      const f = t - i;
      out[o++] = f ? at(i) + (at(i + 1) - at(i)) * f : at(i);
      t += step;
    }
    t -= n;
    if (n) last = x[n - 1];
    return out.subarray(0, o);
  };
}

async function readWav(file, dur, onProgress) {
  const dv = new DataView(await file.slice(0, 1 << 16).arrayBuffer());
  let p = 12;
  let fmt = null;
  let dataAt = 0;
  let dataLen = 0;
  while (p + 8 <= dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    const len = dv.getUint32(p + 4, true);
    if (id === "fmt ") {
      let tagId = dv.getUint16(p + 8, true);
      if (tagId === 0xfffe) tagId = dv.getUint16(p + 32, true); // extensible: the real format
      fmt = { tag: tagId, ch: dv.getUint16(p + 10, true), rate: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
    } else if (id === "data") {
      dataAt = p + 8;
      dataLen = len && len !== 0xffffffff ? Math.min(len, file.size - dataAt) : file.size - dataAt;
      break;
    }
    p += 8 + len + (len & 1);
  }
  if (!fmt || !dataAt || !(fmt.tag === 1 || fmt.tag === 3) || ![16, 24, 32].includes(fmt.bits)) throw new Error("This WAV file can't be read piece by piece (only PCM 16/24/32-bit or float) – convert it to MP3");
  const bpf = (fmt.ch * fmt.bits) / 8;
  const sink = new FrameSink(dur * LSR * 1.02);
  const rs = resampler(fmt.rate);
  const block = bpf * 262144;
  for (let off = 0; off < dataLen; off += block) {
    const buf = await file.slice(dataAt + off, dataAt + Math.min(dataLen, off + block)).arrayBuffer();
    const v = new DataView(buf);
    const frames = Math.floor(buf.byteLength / bpf);
    const mono = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      let s = 0;
      for (let c = 0; c < fmt.ch; c++) {
        const q = i * bpf + (c * fmt.bits) / 8;
        s += fmt.tag === 3 ? v.getFloat32(q, true) : fmt.bits === 16 ? v.getInt16(q, true) / 32768 : fmt.bits === 24 ? ((v.getUint8(q) | (v.getUint8(q + 1) << 8) | (v.getInt8(q + 2) << 16)) / 8388608) : v.getInt32(q, true) / 2147483648;
      }
      mono[i] = s / fmt.ch;
    }
    sink.push(rs(mono));
    onProgress(Math.min(1, (off + block) / dataLen));
  }
  return sink;
}

// MP3 frame header → { len, spf, rate } or null
const MP3_BR = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], // MPEG-1 Layer III
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], // MPEG-2/2.5 Layer III
];
const MP3_SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Frame(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  const bri = b[i + 2] >> 4;
  const sri = (b[i + 2] >> 2) & 3;
  if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return null;
  const rate = MP3_SR[ver][sri];
  const br = MP3_BR[ver === 3 ? 0 : 1][bri] * 1000;
  const pad = (b[i + 2] >> 1) & 1;
  return ver === 3 ? { len: Math.floor((144 * br) / rate) + pad, spf: 1152, rate } : { len: Math.floor((72 * br) / rate) + pad, spf: 576, rate };
}

async function readMp3(file, dur, onProgress) {
  // 1. Where every frame starts (headers only – fast even for hours)
  const starts = [];
  let rate = 0;
  let spf = 1152;
  let pos = 0;
  const first = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (first[0] === 0x49 && first[1] === 0x44 && first[2] === 0x33) pos = 10 + ((first[6] << 21) | (first[7] << 14) | (first[8] << 7) | first[9]) + (first[5] & 0x10 ? 10 : 0);
  const BLK = 8 << 20;
  while (pos < file.size - 4) {
    const bytes = new Uint8Array(await file.slice(pos, Math.min(file.size, pos + BLK + 4)).arrayBuffer());
    let i = 0;
    while (i < bytes.length - 4) {
      const h = mp3Frame(bytes, i);
      const next = h && i + h.len + 4 <= bytes.length ? mp3Frame(bytes, i + h.len) : null;
      if (h && (next || i + h.len + 4 > bytes.length)) {
        if (!rate) (rate = h.rate), (spf = h.spf);
        starts.push(pos + i);
        i += h.len;
        if (i >= BLK) break;
      } else i++; // lost the rhythm (tag, junk): look for the next real frame
    }
    pos += i;
    onProgress(0.15 * Math.min(1, pos / file.size));
    if (i === 0) break;
  }
  if (starts.length < 100 || !rate) throw new Error("This MP3 file can't be read");
  // The first frame is often an info frame (Xing/Info, with the encoder's delay in the LAME part):
  // players leave it out and skip the delay – so does this, then the beats match what you hear
  let encDelay = 0;
  const h0 = new Uint8Array(await file.slice(starts[0], starts[1]).arrayBuffer());
  const text = String.fromCharCode(...h0.subarray(0, Math.min(h0.length, 64)));
  const x = Math.max(text.indexOf("Xing"), text.indexOf("Info"));
  if (x > 0) {
    const flags = h0[x + 7];
    const lame = x + 8 + (flags & 1 ? 4 : 0) + (flags & 2 ? 4 : 0) + (flags & 4 ? 100 : 0) + (flags & 8 ? 4 : 0);
    if (lame + 24 <= h0.length && /^[A-Za-z]{4}/.test(String.fromCharCode(...h0.subarray(lame, lame + 4)))) encDelay = (h0[lame + 21] << 4) | (h0[lame + 22] >> 4);
    starts.shift();
  }
  starts.push(file.size);
  // 2. Decode pieces of ~70 s at 22.05 kHz; each piece starts two frames early (the decoder needs
  //    them to warm up), those are cut off again, and the decoder's own delay (529 samples) –
  //    so the pieces fit together sample-exactly
  const total = starts.length - 1;
  const sink = new FrameSink(((total * spf) / rate) * LSR * 1.02);
  const per = Math.round((70 * rate) / spf);
  const ctx = new OfflineAudioContext(1, 1, LSR);
  const frameOut = (spf * LSR) / rate;
  const decDelay = (529 * LSR) / rate;
  let written = 0;
  for (let f = 0; f < total; f += per) {
    const g = Math.min(total, f + per);
    const pre = Math.min(2, f);
    const buf = await ctx.decodeAudioData(await file.slice(starts[f - pre], starts[g]).arrayBuffer());
    const chs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
    const skip = Math.round(pre * frameOut + decDelay + (f === 0 ? (encDelay * LSR) / rate : 0));
    const want = Math.round(g * frameOut) - written; // keeps the running total exact
    const mono = new Float32Array(want);
    for (let i = 0; i < want; i++) {
      const j = i + skip;
      if (j >= buf.length) break;
      let s = 0;
      for (const d of chs) s += d[j];
      mono[i] = s / chs.length;
    }
    sink.push(mono);
    written += want;
    onProgress(0.15 + 0.85 * (g / total));
  }
  return sink;
}

// Only a part of a decoded song (seconds) – e.g. the music from a longer video
export function sliceBuffer(buf, start, end) {
  const sr = buf.sampleRate;
  const a = Math.max(0, Math.floor(start * sr));
  const b = Math.min(buf.length, Math.ceil((end || buf.duration) * sr));
  const out = new AudioBuffer({ length: Math.max(1, b - a), numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
  return out;
}

export async function analyzeBuffer(buf) {
  const sr = buf.sampleRate;
  const fps = sr / HOP;
  const mono = mixdown(buf);
  const low = await lowpass(buf, 160);
  const n = Math.floor(mono.length / HOP);
  const onset = onsetCurve(frameEnergy(low, n), frameEnergy(mono, n), fps);
  const period = estimatePeriod(onset, fps);
  const frames = trackBeats(onset, period);
  const beats = frames.map((f) => (f * HOP) / sr);
  return {
    buffer: buf,
    duration: buf.duration,
    bpm: (60 * fps) / period,
    beats,
    energy: beatEnergy(mono, sr, beats),
    pace: beatPace(onset, frames, period),
    peaks: overview(mono, 800),
  };
}

// Halve/double the tempo afterwards (if the detection is off by an octave)
export function rescale(song, factor) {
  const b = song.beats;
  let beats;
  if (factor === 2) {
    beats = [];
    for (let i = 0; i < b.length; i++) {
      beats.push(b[i]);
      if (i + 1 < b.length) beats.push((b[i] + b[i + 1]) / 2);
    }
  } else beats = b.filter((_, i) => i % 2 === 0);
  return Object.assign({}, song, { beats, bpm: song.bpm * factor, energy: resampleEnergy(song.energy, beats.length), pace: song.pace && resampleEnergy(song.pace, beats.length) });
}

// Shift the beat grid (seconds), e.g. when the cuts come slightly too early
export function shift(song, sec) {
  return Object.assign({}, song, { beats: song.beats.map((t) => t + sec).filter((t) => t >= 0 && t < song.duration) });
}

// ---------- Building blocks ----------

function mixdown(buf) {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

async function lowpass(buf, freq) {
  const ctx = new OfflineAudioContext(1, buf.length, buf.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = freq;
  src.connect(f).connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

function frameEnergy(x, n) {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * HOP, end = j + HOP; j < end; j++) s += x[j] * x[j];
    e[i] = s;
  }
  return e;
}

function onsetCurve(eLow, eAll, fps) {
  const n = eLow.length;
  const raw = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dl = Math.log(eLow[i] + 1e-6) - Math.log(eLow[i - 1] + 1e-6);
    const da = Math.log(eAll[i] + 1e-6) - Math.log(eAll[i - 1] + 1e-6);
    raw[i] = 0.65 * Math.max(0, dl) + 0.35 * Math.max(0, da);
  }
  // Subtract the moving average (only real peaks count) and normalize
  const w = Math.max(1, Math.round(fps * 0.4));
  const out = new Float32Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += raw[i];
    if (i >= w) acc -= raw[i - w];
    out[i] = Math.max(0, raw[i] - acc / Math.min(i + 1, w));
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i];
  mean /= n || 1;
  let sd = 0;
  for (let i = 0; i < n; i++) sd += (out[i] - mean) ** 2;
  sd = Math.sqrt(sd / (n || 1)) || 1;
  for (let i = 0; i < n; i++) out[i] /= sd;
  return out;
}

function autocorr(o, lag) {
  let s = 0;
  const n = o.length - lag;
  for (let i = 0; i < n; i++) s += o[i] * o[i + lag];
  return n > 0 ? s / n : 0;
}

function estimatePeriod(o, fps) {
  const lagMin = Math.floor((60 * fps) / 200);
  const lagMax = Math.ceil((60 * fps) / 60);
  const score = (l) => {
    const bpm = (60 * fps) / l;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    return w * (autocorr(o, l) + 0.5 * autocorr(o, 2 * l));
  };
  let best = lagMin;
  let bestS = -Infinity;
  const s = {};
  for (let l = lagMin - 1; l <= lagMax + 1; l++) s[l] = score(l);
  for (let l = lagMin; l <= lagMax; l++) {
    if (s[l] > bestS) {
      bestS = s[l];
      best = l;
    }
  }
  // Parabola through the neighbors → period with decimals
  const a = s[best - 1];
  const b = s[best];
  const c = s[best + 1];
  const d = a - 2 * b + c;
  return best + (d < 0 ? (0.5 * (a - c)) / d : 0);
}

function trackBeats(o, period) {
  const n = o.length;
  const alpha = 100;
  const score = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(2 * period);
  const hi = Math.max(1, Math.round(period / 2));
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let arg = -1;
    for (let j = Math.max(0, i - lo); j <= i - hi; j++) {
      const v = score[j] - alpha * Math.log((i - j) / period) ** 2;
      if (v > best) {
        best = v;
        arg = j;
      }
    }
    score[i] = o[i] + (arg >= 0 && best > 0 ? best : 0);
    back[i] = arg >= 0 && best > 0 ? arg : -1;
  }
  // Find the best end in the last bar and trace back
  let end = n - 1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[end]) end = i;
  const beats = [];
  for (let i = end; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();
  // Fill gaps at the start (quiet intro) with the grid
  const first = beats[0] || 0;
  const pre = [];
  for (let f = first - period; f >= 0; f -= period) pre.unshift(Math.round(f));
  return pre.concat(beats);
}

function beatEnergy(mono, sr, beats) {
  const rms = beats.map((t, k) => {
    const a = Math.floor(t * sr);
    const b = Math.min(mono.length, Math.floor((beats[k + 1] || t + 0.5) * sr));
    let s = 0;
    for (let i = a; i < b; i++) s += mono[i] * mono[i];
    return Math.sqrt(s / Math.max(1, b - a));
  });
  return normEnergy(rms);
}

// How busy each beat is: the mean onset strength between it and the next (frames) → 0–1 like the energy
function beatPace(onset, frames, period) {
  const busy = frames.map((f, k) => {
    const end = Math.min(onset.length, frames[k + 1] ?? f + Math.round(period));
    let s = 0;
    for (let i = f; i < end; i++) s += onset[i];
    return s / Math.max(1, end - f);
  });
  return normEnergy(busy);
}

// Loudness per beat → 0–1 (10th to 95th percentile), smoothed over a bar
function normEnergy(rms) {
  const sorted = rms.slice().sort((x, y) => x - y);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 0;
  const lo = q(0.1);
  const span = q(0.95) - lo || 1;
  const e = rms.map((r) => Math.min(1, Math.max(0, (r - lo) / span)));
  // Smooth over one bar so the mood doesn't flicker
  return e.map((_, k) => {
    let s = 0;
    let c = 0;
    for (let j = k - 2; j <= k + 1; j++) if (j >= 0 && j < e.length) (s += e[j]), c++;
    return s / c;
  });
}

function resampleEnergy(e, len) {
  return Array.from({ length: len }, (_, i) => e[Math.min(e.length - 1, Math.floor((i * e.length) / len))] || 0);
}

function overview(x, buckets) {
  const out = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(x.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    for (let i = b * size, end = Math.min(x.length, i + size); i < end; i++) m = Math.max(m, Math.abs(x[i]));
    out[b] = m;
  }
  return out;
}
