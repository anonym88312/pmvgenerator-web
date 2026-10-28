// PMV Generator: layouts (split screens) and effects for the canvas.
// The generator decides WHEN something happens (beats, energy, drops) – this file decides HOW it looks.

// level = how "full" a layout feels; the generator picks by energy (calm → 1, drop → 4)
export const LAYOUTS = {
  full: { name: "Fullscreen", groups: 1, level: 1, hint: "One clip over everything" },
  kaleido: { name: "Kaleidoscope", groups: 1, level: 2, hint: "One clip, mirrored four times" },
  duo: { name: "2-way", groups: 2, level: 2, hint: "Two clips side by side" },
  trim: { name: "3-way mirrored", groups: 2, level: 3, hint: "Left and right the same clip mirrored, a different one in the middle" },
  tri: { name: "3-way", groups: 3, level: 3, hint: "Three different clips" },
  quad: { name: "4-way", groups: 4, level: 4, hint: "Four fields" },
};

// Fields of a layout: rectangle, group (which clip) and mirroring.
// dir "cols" = side by side (columns), "rows" = stacked (rows).
export function slotsFor(id, W, H, dir = "cols") {
  const wide = dir !== "rows";
  const split = (n, groups, mirror) =>
    groups.map((g, i) => {
      const a = Math.round((i * (wide ? W : H)) / n);
      const b = Math.round(((i + 1) * (wide ? W : H)) / n);
      return wide ? { x: a, y: 0, w: b - a, h: H, g, fx: !!mirror[i], fy: false } : { x: 0, y: a, w: W, h: b - a, g, fx: !!mirror[i], fy: false };
    });
  const quad = (groupsOf, mirrorOf) =>
    [0, 1, 2, 3].map((i) => {
      const x0 = Math.round(((i % 2) * W) / 2);
      const y0 = Math.round((Math.floor(i / 2) * H) / 2);
      return { x: x0, y: y0, w: Math.round(W / 2), h: Math.round(H / 2), g: groupsOf(i), fx: mirrorOf(i)[0], fy: mirrorOf(i)[1] };
    });
  switch (id) {
    case "duo":
      return split(2, [0, 1], [0, 0]);
    case "trim":
      return split(3, [0, 1, 0], [0, 0, 1]);
    case "tri":
      return split(3, [0, 1, 2], [0, 0, 0]);
    case "quad":
      return quad((i) => i, () => [false, false]);
    case "kaleido":
      return quad(() => 0, (i) => [i % 2 === 1, i >= 2]);
    default:
      return [{ x: 0, y: 0, w: W, h: H, g: 0, fx: false, fy: false }];
  }
}

export const aspectOfGroup = (slots, g) => {
  const s = slots.find((x) => x.g === g) || slots[0];
  return s.w / s.h;
};

// Color looks: a filter on each clip + a tint over the whole picture (soft-light). Both scale with the strength (a: 0…1)
const f3 = (x) => x.toFixed(3);
export const LOOKS = {
  none: { filter: () => "", tint: null },
  warm: { filter: (a) => `sepia(${f3(0.22 * a)}) saturate(${f3(1 + 0.2 * a)}) contrast(${f3(1 + 0.04 * a)})`, tint: [255, 140, 60, 0.22] },
  pink: { filter: (a) => `saturate(${f3(1 + 0.15 * a)}) contrast(${f3(1 + 0.05 * a)})`, tint: [255, 62, 138, 0.3] },
  cold: { filter: (a) => `saturate(${f3(1 - 0.15 * a)}) contrast(${f3(1 + 0.06 * a)})`, tint: [60, 140, 255, 0.26] },
  vivid: { filter: (a) => `saturate(${f3(1 + 0.7 * a)}) contrast(${f3(1 + 0.12 * a)})`, tint: null },
  bw: { filter: (a) => `grayscale(${f3(a)}) contrast(${f3(1 + 0.15 * a)})`, tint: null },
  noir: { filter: (a) => `grayscale(${f3(a)}) contrast(${f3(1 + 0.5 * a)}) brightness(${f3(1 - 0.12 * a)})`, tint: null, vignette: true },
  custom: { filter: () => "", tint: null }, // your own color (S.lookColor)
};
const hexRgb = (h) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h || ""));
  const n = m ? parseInt(m[1], 16) : 0xff4d94;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export class Compositor {
  constructor(canvas, S) {
    this.c = canvas;
    this.g = canvas.getContext("2d");
    this.W = canvas.width;
    this.H = canvas.height;
    this.S = S;
    this.fx = S.fx;
    this.t = { flash: -9, flashA: 0, flashColor: "#fff", shake: -9, glitch: -9, rgb: -9, rgbAmt: 0, rgbDur: 0.1, invert: -9, tunnel: -9, tunnelDur: 0.5, strobe: -9, text: -9, word: "" };
    this.words = String(S.words || "").split(/[,;\n]+/).map((w) => w.trim()).filter(Boolean);
    this.look = LOOKS[S.look] || LOOKS.none;
    // The look at its strength: the filter for each clip, the tint over everything
    const la = Math.max(0, Math.min(1, (S.lookAmt ?? 100) / 100));
    this.lookFilter = this.look.filter(la);
    const tint = S.look === "custom" ? [...hexRgb(S.lookColor), 0.34] : this.look.tint;
    this.lookTint = tint ? `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${f3(tint[3] * la)})` : null;
    this.bright = Math.max(0, Math.min(1, (S.bright || 0) / 100));
    this.pulseAmt = Math.max(0, Math.min(1.5, (S.pulseAmt ?? 100) / 100));
    this.title = ""; // intro/outro – set by the generator
    this.duration = 0;
    this.songStart = 0; // show time at which the current song began (intro / outro per song)
    this.credits = () => "";
    const off = (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    };
    this.off = off;
    this.prev = off(this.W, this.H); // for echo
    this.red = off(this.W, this.H); // for RGB split
    this.cyan = off(this.W, this.H);
    this.grain = makeGrain(off(256, 256));
    this.backs = []; // tiny canvases for the blurred border in "Fit" mode (one per field)
    this.lines = makeScanlines(off(4, 4));
    this.pic = { flash: null, over: null }; // pictures: a flash picture covers the clips for a moment, an overlay lies over them
  }

  // The canvas got another size (the window changed shape): the buffers for echo and RGB split follow
  resize(W, H) {
    this.c.width = this.W = W;
    this.c.height = this.H = H;
    for (const k of ["prev", "red", "cyan"]) {
      this[k].width = W;
      this[k].height = H;
    }
    this.eo = this.es = null; // (the edge buffers are made again)
  }

  // ---------- Triggers (from the generator) ----------

  flash(t, a, color, force) {
    if (!this.fx.flash && !force) return;
    this.t.flash = t;
    this.t.flashA = a;
    this.t.flashColor = color;
  }
  shake(t, dur) {
    if (this.fx.shake) this.t.shake = t + dur;
  }
  glitch(t, dur) {
    if (this.fx.glitch) this.t.glitch = t + dur;
  }
  rgb(t, amount, dur) {
    if (!this.fx.rgb) return;
    this.t.rgb = t;
    this.t.rgbAmt = amount;
    this.t.rgbDur = dur;
  }
  invert(t, dur) {
    if (this.fx.invert) this.t.invert = t + dur;
  }
  tunnel(t, dur) {
    if (!this.fx.tunnel) return;
    this.t.tunnel = t;
    this.t.tunnelDur = dur;
  }
  strobe(t) {
    if (this.fx.strobe) this.t.strobe = t;
  }
  text(t) {
    if (!this.fx.text || !this.words.length) return;
    this.t.text = t;
    this.t.word = this.words[Math.floor(Math.random() * this.words.length)];
  }

  // ---------- Pictures (image flash / image overlay) ----------
  // pic: { el: ImageBitmap, w, h }, times in show seconds
  picFlash(pic, t0, t1) {
    this.pic.flash = { pic, t0, t1 };
  }
  picOver(pic, t0, t1, alpha) {
    this.pic.over = { pic, t0, t1, alpha };
  }
  // A picture over the whole frame: it fills when its shape is close to the frame's, else the whole picture sits in the middle
  // (a flash gets the blurred backdrop like a clip, an overlay stays see-through around it)
  drawPic(pic, backdrop, zoom, ox, oy) {
    const s = { x: 0, y: 0, w: this.W, h: this.H };
    const m = { kind: "image", el: pic.el, w: pic.w, h: pic.h };
    const fit = Math.max(s.w / s.h / (m.w / m.h), m.w / m.h / (s.w / s.h)) <= SNAP ? "cover" : "contain";
    if (backdrop && fit === "contain") this.backdrop(15, m, s);
    drawIn(this.g, m, s, fit, zoom, ox, oy, "", false);
  }

  // ---------- One frame ----------
  // st: { t, slots, groups (media per group), cutT (per group), energy, beatT, beatAmt, stutterT }

  draw(st) {
    let { g } = this; // (let: a field with soft seams is drawn into its own buffer first)
    const { W, H, fx } = this;
    const t = st.t;
    const e = st.energy;
    g.save();
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = this.S.smooth === false ? "low" : "high"; // clips scaled smoothly, less pixelated

    let dx = 0;
    let dy = 0;
    if (t < this.t.shake) {
      const a = 6 + 16 * e;
      dx = (Math.random() - 0.5) * a;
      dy = (Math.random() - 0.5) * a;
    }
    const hue = fx.hue ? `hue-rotate(${Math.round((t * (30 + 110 * e)) % 360)}deg) saturate(1.3)` : "";
    // Zoom pulse: eases in just BEFORE the beat (the next beat is known) so the peak lands exactly on it, then fades out softly
    let pulse = 0;
    if (fx.zoom && this.pulseAmt > 0) {
      const after = (st.beatAmt || 0) * Math.exp(-Math.max(0, t - st.beatT) * 5.5);
      const ease = (T, amt) => {
        const d = T != null ? T - t : 9;
        const x = d >= 0 && d < 0.11 ? 1 - d / 0.11 : 0;
        return (amt || 0) * x * x * (3 - 2 * x);
      };
      // (with "cut ahead of the beat" the current beat can still lie ahead: ease towards that one as well)
      const before = Math.max(ease(st.nextT, st.nextAmt), st.beatT > t ? ease(st.beatT, st.beatAmt) : 0);
      pulse = Math.max(after, before) * this.pulseAmt;
    }

    // Reveal opening: the clip sits in the middle as a small rounded window and slowly grows until the drop
    const rv = st.reveal;
    let slots = st.slots;
    // (the window has the clip's own shape – a portrait clip stands upright –, the clip fills it, black all around,
    // a soft glow that breathes with the beat)
    const reveal = !!rv && slots.length === 1;
    if (reveal) {
      const m0 = st.groups[slots[0].g];
      const k = 0.34 + 0.56 * ((1 - Math.cos(Math.PI * rv.p)) / 2);
      const want = m0 && m0.w && m0.h ? Math.max(0.4, Math.min(2.4, m0.w / m0.h)) : W / H;
      this.rvAsp = this.rvAsp == null ? want : this.rvAsp + (want - this.rvAsp) * 0.2; // follows a changing clip smoothly
      let w = W * k;
      let h = H * k;
      if (w / h > this.rvAsp) w = h * this.rvAsp;
      else h = w / this.rvAsp;
      w = Math.round(w);
      h = Math.round(h);
      const win = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, g: slots[0].g, fx: false, fy: false };
      const rad = Math.min(w, h) * 0.07;
      const beat = Math.exp(-(t - st.beatT) * 6);
      g.save();
      g.shadowColor = "rgba(255, 196, 224, .6)";
      g.shadowBlur = Math.min(W, H) * (0.045 + 0.035 * beat);
      g.fillStyle = "#000";
      roundRect(g, win.x, win.y, win.w, win.h, rad);
      g.fill();
      g.restore();
      g.save();
      roundRect(g, win.x, win.y, win.w, win.h, rad);
      g.clip();
      slots = [win];
      this.revealWin = win;
      this.revealRad = rad;
    } else {
      this.revealWin = null;
      this.rvAsp = null;
    }
    const fitM = reveal ? "cover" : this.S.fit;
    // Soft seams: the fields of a split screen blend into each other (no sharp line between them)
    const softOn = !!this.S.soft && !reveal && slots.length > 1;

    const drawField = (s, i) => {
      const m = st.groups[s.g];
      if (!m || !m.w || !m.h) return;
      const since = t - (st.cutT[s.g] || 0);
      // Scroll cut (like swiping a feed): the old clip slides out, the new one in from the other side
      // "Fit" with a clip whose shape is only a little off the field's: fill the field (a few % cropped) instead of thin
      // blurred bars at the sides – they stand out and the zoom pulse covers and uncovers them again
      const fitFor = (c) => (fitM === "contain" && Math.max(s.w / s.h / (c.w / c.h), c.w / c.h / (s.w / s.h)) <= SNAP ? "cover" : fitM);
      const fitHere = fitFor(m);
      const lv = st.leave && st.leave[s.g];
      const sp = lv ? (t - lv.t) / SCROLL : 1;
      const scrolling = !!lv && sp >= 0 && sp < 1;
      let zoom = 1 + pulse;
      if (m.kind === "image" && fx.kenburns) zoom += 0.07 * Math.min(1, since / 4);
      let ox = dx;
      let oy = dy;
      let filter = hue;
      if (this.lookFilter) filter += " " + this.lookFilter;
      if (this.bright) filter += ` brightness(${f3(1 + 0.1 * this.bright)})`;
      // Even out brightness: every clip towards a medium brightness
      if (this.S.lookEven && m.sig && m.sig.lum != null) filter += ` brightness(${Math.max(0.8, Math.min(1.4, 118 / Math.max(20, m.sig.lum))).toFixed(2)})`;
      // Transition: the new clip whips into the field with motion blur
      if (fx.whip && since < 0.16 && !scrolling) {
        const p = 1 - since / 0.16;
        const dir = (s.g + st.cutCount) % 2 ? 1 : -1;
        if (s.w >= s.h * 0.9) ox += dir * p * p * s.w * 0.6;
        else oy += dir * p * p * s.h * 0.6;
        filter += ` blur(${(p * 10).toFixed(1)}px)`;
      }
      // Zoom-in entry: the new clip shoots into the field – always from big (zooming out would show borders), alternating strong and soft
      if (fx.zoomin && since < 0.3 && !scrolling) {
        const p = since / 0.3;
        const ease = 1 - Math.pow(1 - p, 3);
        const from = (m.zoomDir || 1) > 0 ? 1.75 : 1.35;
        zoom *= from + (1 - from) * ease;
      }
      if (scrolling) {
        // Like swiping a feed: the two clips are one strip – the old one moves out, the new one follows right behind it.
        // Each is drawn with its own blurred backdrop, shifted along (else the new backdrop would cover the old clip).
        const ease = 1 - Math.pow(1 - sp, 3);
        const strip = (clip, off, zm) => {
          g.save();
          g.beginPath();
          g.rect(s.x, s.y, s.w, s.h);
          g.clip();
          g.translate(0, off);
          const ft = fitFor(clip);
          if (ft === "contain") this.backdrop(i, clip, s);
          drawIn(g, clip, s, ft, zm, ox, oy, filter.trim(), fx.kenburns);
          g.restore();
        };
        if (lv.m && lv.m.w && lv.m.h) strip(lv.m, lv.dir * s.h * ease, 1);
        strip(m, lv.dir * s.h * (ease - 1), zoom);
        return;
      }
      if (fitHere === "contain") this.backdrop(i, m, s);
      drawIn(g, m, s, fitHere, zoom, ox, oy, filter.trim(), fx.kenburns);
    };
    slots.forEach((s, i) => drawField(s, i));
    if (softOn) this.softSeams(slots); // the sharp lines between the fields become soft
    if (this.revealWin) {
      g.restore(); // (the rounded window's clip)
      g.save();
      g.strokeStyle = "rgba(255, 255, 255, .2)";
      g.lineWidth = 2;
      roundRect(g, this.revealWin.x, this.revealWin.y, this.revealWin.w, this.revealWin.h, this.revealRad);
      g.stroke();
      g.restore();
    }

    // Pictures: an overlay lies over the clips, see-through, fading in and out; a flash picture covers them for a moment
    const po = this.pic.over;
    if (po) {
      if (t >= po.t1) this.pic.over = null;
      else if (t >= po.t0) {
        g.save();
        g.globalAlpha = po.alpha * Math.max(0, Math.min(1, (t - po.t0) / 0.15, (po.t1 - t) / 0.15));
        this.drawPic(po.pic, false, 1 + pulse * 0.6, dx, dy);
        g.restore();
      }
    }
    const pf = this.pic.flash;
    let picOn = false;
    if (pf) {
      if (t >= pf.t1) this.pic.flash = null;
      else if (t >= pf.t0) {
        picOn = true;
        this.drawPic(pf.pic, true, 1 + pulse, dx, dy);
      }
    }

    // Color look: tint over everything, noir with dark corners
    if (this.lookTint) {
      g.globalCompositeOperation = "soft-light";
      g.fillStyle = this.lookTint;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "source-over";
    }
    // Brighter, smoothly: white in soft-light lifts the mid-tones without burning out the highlights
    if (this.bright) {
      g.globalCompositeOperation = "soft-light";
      g.fillStyle = `rgba(255, 255, 255, ${f3(0.4 * this.bright)})`;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "source-over";
    }
    if (this.look.vignette) vignette(g, W, H, 0.6);
    // Only the rim of the picture is softened / smeared / bent – the middle stays sharp
    if (this.S.edge && this.S.edge !== "off") this.edgeSoft(this.S.edge, Math.max(0, Math.min(1, (this.S.edgeAmt ?? 50) / 100)));

    // Dividers between fields, glowing to the beat – width from the setting (2 px at 720p, 3 px at 1080p by default); none with soft seams
    if (st.slots.length > 1 && !softOn && !picOn) {
      const dw = Math.max(1, Math.round((this.S.divW || 2) * W / 1280));
      const h2 = dw / 2;
      const glow = Math.exp(-(t - st.beatT) * 7);
      g.fillStyle = "#0a0309";
      st.slots.forEach((s) => {
        if (s.x > 0) g.fillRect(s.x - h2, s.y, dw, s.h);
        if (s.y > 0) g.fillRect(s.x, s.y - h2, s.w, dw);
      });
      if (fx.lines && glow > 0.05) {
        g.fillStyle = `rgba(255, 62, 138, ${0.9 * glow})`;
        st.slots.forEach((s) => {
          if (s.x > 0) g.fillRect(s.x - h2, s.y, dw, s.h);
          if (s.y > 0) g.fillRect(s.x, s.y - h2, s.w, dw);
        });
      }
    }

    // Echo: the last frame lingers as a slightly enlarged ghost
    if (fx.echo && e > 0.45) {
      g.globalAlpha = 0.16 + 0.2 * e; // not too strong: the echo records itself too
      g.drawImage(this.prev, -W * 0.02, -H * 0.02, W * 1.04, H * 1.04);
      g.globalAlpha = 1;
    }

    // Tunnel: the picture sits shrunk inside itself
    const tp = (t - this.t.tunnel) / this.t.tunnelDur;
    if (tp >= 0 && tp < 1) {
      const grow = 1 - tp;
      for (const f of [0.74, 0.52, 0.34]) {
        const s = f + (1 - f) * 0.12 * tp;
        const w = W * s;
        const h = H * s;
        g.globalAlpha = 0.9 * grow + 0.1;
        g.drawImage(this.c, (W - w) / 2, (H - h) / 2, w, h);
        g.strokeStyle = "#ff3e8a";
        g.lineWidth = 3;
        g.strokeRect((W - w) / 2, (H - h) / 2, w, h);
      }
      g.globalAlpha = 1;
    }

    // Glitch: stripes slip
    if (t < this.t.glitch) {
      const n = 5 + Math.floor(Math.random() * 6);
      for (let i = 0; i < n; i++) {
        const y = Math.random() * H;
        const h = 4 + Math.random() * H * 0.09;
        g.drawImage(this.c, 0, y, W, h, (Math.random() - 0.5) * W * 0.14, y, W, h);
      }
      g.globalCompositeOperation = "screen";
      g.fillStyle = "rgba(255, 62, 138, .16)";
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "source-over";
    }

    // RGB split: red and cyan drift apart
    const rp = (t - this.t.rgb) / this.t.rgbDur;
    if (rp >= 0 && rp < 1) this.split(this.t.rgbAmt * (1 - rp) * (1 - rp) + 1);

    // Negative
    if (t < this.t.invert) {
      g.globalCompositeOperation = "difference";
      g.fillStyle = "#fff";
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = "source-over";
    }

    // Flash
    const fa = this.t.flashA * Math.exp(-(t - this.t.flash) * 9);
    if (fa > 0.01) {
      g.globalAlpha = fa;
      g.fillStyle = this.t.flashColor;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }

    // Strobe: short white
    if (t - this.t.strobe >= 0 && t - this.t.strobe < 0.045) {
      g.fillStyle = "rgba(255, 255, 255, .92)";
      g.fillRect(0, 0, W, H);
    }

    // Text
    const tt = t - this.t.text;
    if (tt >= 0 && tt < 0.42 && this.t.word) this.drawWord(this.t.word, tt);

    // VHS: noise, scanlines, dark corners
    if (fx.vhs) {
      g.globalAlpha = 0.1;
      const ox = Math.floor(Math.random() * 256);
      const oy = Math.floor(Math.random() * 256);
      g.fillStyle = g.createPattern(this.grain, "repeat");
      g.translate(-ox, -oy);
      g.fillRect(ox, oy, W, H);
      g.translate(ox, oy);
      g.globalAlpha = 1;
      g.fillStyle = g.createPattern(this.lines, "repeat");
      g.fillRect(0, 0, W, H);
      vignette(g, W, H, 0.55);
    }
    g.restore();

    // Intro and outro lie on top of everything
    // (with "Again for every song" they count from the start of the song that plays)
    const rt = t - (this.songStart || 0);
    if (this.S.intro && rt >= 0 && rt < INTRO) this.drawIntro(rt);
    if (this.S.outro && this.duration > 12 && rt > this.duration - OUTRO) this.drawOutro(rt - (this.duration - OUTRO));

    if (fx.echo) {
      const p = this.prev.getContext("2d");
      p.clearRect(0, 0, W, H);
      p.drawImage(this.c, 0, 0);
    }
  }

  // Soft seams: the line between two fields is not sharp but smeared softly. Nothing overlaps – each clip stays in its own
  // field –, a band across the seam is smeared (the picture shrunk across the seam and scaled back up, cheap) and
  // blended back in: strongest right at the seam, nothing at the ends of the band.
  softSeams(slots) {
    const { W, H } = this;
    const a = Math.max(0, Math.min(1, (this.S.softAmt == null ? 50 : this.S.softAmt) / 100));
    const k = 0.004 + 0.026 * a; // half the band as a share of the picture: ~0.4 % … 3 %
    const minW = Math.min(...slots.map((x) => x.w));
    const minH = Math.min(...slots.map((x) => x.h));
    const fH = Math.round(Math.min(k * W, 0.08 * minW)); // half the width of the band across a vertical seam
    const fV = Math.round(Math.min(k * H, 0.08 * minH));
    const done = new Set();
    for (const s of slots) {
      if (s.x > 1 && fH >= 2 && !done.has("v" + s.x + ":" + s.y)) {
        done.add("v" + s.x + ":" + s.y);
        this.smear({ x: s.x - fH, y: s.y, w: 2 * fH, h: s.h }, "x");
      }
      if (s.y > 1 && fV >= 2 && !done.has("h" + s.y + ":" + s.x)) {
        done.add("h" + s.y + ":" + s.x);
        this.smear({ x: s.x, y: s.y - fV, w: s.w, h: 2 * fV }, "y");
      }
    }
  }
  smear(r, axis) {
    const { g } = this;
    const along = axis === "x" ? r.w : r.h; // the length across the seam
    const texel = Math.max(2, Math.round(along / 6));
    const sw = axis === "x" ? Math.max(2, Math.ceil(r.w / texel)) : r.w;
    const sh = axis === "y" ? Math.max(2, Math.ceil(r.h / texel)) : r.h;
    const small = this.smallBuf || (this.smallBuf = document.createElement("canvas"));
    const big = this.bigBuf || (this.bigBuf = document.createElement("canvas"));
    small.width = sw;
    small.height = sh;
    big.width = r.w;
    big.height = r.h;
    const sx = small.getContext("2d");
    const bx = big.getContext("2d");
    sx.imageSmoothingEnabled = bx.imageSmoothingEnabled = true;
    sx.imageSmoothingQuality = bx.imageSmoothingQuality = "high";
    sx.clearRect(0, 0, sw, sh);
    sx.drawImage(g.canvas, r.x, r.y, r.w, r.h, 0, 0, sw, sh); // shrunk across the seam
    bx.globalCompositeOperation = "source-over";
    bx.clearRect(0, 0, r.w, r.h);
    bx.drawImage(small, 0, 0, sw, sh, 0, 0, r.w, r.h); // …and back: smeared
    // the smear counts fully in the middle (the seam) and not at all at the ends of the band
    const gr = axis === "x" ? bx.createLinearGradient(0, 0, r.w, 0) : bx.createLinearGradient(0, 0, 0, r.h);
    for (let n = 0; n <= 8; n++) {
      const p = n / 8;
      const v = Math.sin(Math.PI * p); // 0 → 1 → 0
      gr.addColorStop(p, `rgba(0,0,0,${(v * v).toFixed(3)})`);
    }
    bx.globalCompositeOperation = "destination-in";
    bx.fillStyle = gr;
    bx.fillRect(0, 0, r.w, r.h);
    bx.globalCompositeOperation = "source-over";
    g.drawImage(big, r.x, r.y);
  }

  // Rim effect on the finished picture: a blurred copy (cheap: the picture shrunk and scaled back up) that only shows
  // towards the edges. blur = soft, motion = streaks sideways (left/right) and up/down (top/bottom), lens = bent outwards
  edgeSoft(kind, a) {
    if (a <= 0) return;
    const { g, W, H } = this;
    const f = 1 / (2 + 7 * a);
    const sw = Math.max(8, Math.round(W * f));
    const sh = Math.max(8, Math.round(H * f));
    if (!this.es) this.es = this.off(sw, sh);
    if (!this.eo) this.eo = this.off(W, H);
    if (this.es.width !== sw || this.es.height !== sh) {
      this.es.width = sw;
      this.es.height = sh;
    }
    const sx = this.es.getContext("2d");
    sx.imageSmoothingQuality = "high";
    sx.drawImage(this.c, 0, 0, sw, sh);
    const o = this.eo.getContext("2d");
    const mask = (shape) => {
      o.globalCompositeOperation = "destination-in";
      const k = 0.5 + 0.5 * a; // how far in the effect reaches: stronger = more of the rim
      let gr;
      if (shape === "x") {
        gr = o.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, "rgba(0,0,0,1)");
        gr.addColorStop(Math.max(0.02, 0.5 - 0.5 * (1 - k) - 0.12), "rgba(0,0,0,0)");
        gr.addColorStop(Math.min(0.98, 0.5 + 0.5 * (1 - k) + 0.12), "rgba(0,0,0,0)");
        gr.addColorStop(1, "rgba(0,0,0,1)");
      } else if (shape === "y") {
        gr = o.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, "rgba(0,0,0,1)");
        gr.addColorStop(Math.max(0.02, 0.5 - 0.5 * (1 - k) - 0.12), "rgba(0,0,0,0)");
        gr.addColorStop(Math.min(0.98, 0.5 + 0.5 * (1 - k) + 0.12), "rgba(0,0,0,0)");
        gr.addColorStop(1, "rgba(0,0,0,1)");
      } else {
        gr = o.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.5);
        gr.addColorStop(0, "rgba(0,0,0,0)");
        gr.addColorStop(0.35, "rgba(0,0,0,0)");
        gr.addColorStop(1, `rgba(0,0,0,${f3(0.55 + 0.4 * a)})`);
      }
      o.fillStyle = gr;
      o.fillRect(0, 0, W, H);
      o.globalCompositeOperation = "source-over";
    };
    const pass = (draw, shape) => {
      o.clearRect(0, 0, W, H);
      draw();
      mask(shape);
      g.drawImage(this.eo, 0, 0);
    };
    o.imageSmoothingEnabled = true;
    o.imageSmoothingQuality = "high";
    if (kind === "motion") {
      const n = 6;
      const reach = W * 0.03 * (0.4 + a);
      pass(() => {
        o.globalAlpha = 1 / 3;
        for (let i = 0; i < n; i++) o.drawImage(this.es, ((i / (n - 1)) - 0.5) * reach * 2, 0, W, H);
        o.globalAlpha = 1;
      }, "x");
      const reachY = H * 0.03 * (0.4 + a);
      pass(() => {
        o.globalAlpha = 1 / 3;
        for (let i = 0; i < n; i++) o.drawImage(this.es, 0, ((i / (n - 1)) - 0.5) * reachY * 2, W, H);
        o.globalAlpha = 1;
      }, "y");
    } else if (kind === "lens") {
      const z = 1 + 0.05 * a + 0.02;
      pass(() => o.drawImage(this.es, (W - W * z) / 2, (H - H * z) / 2, W * z, H * z), "r");
    } else {
      pass(() => o.drawImage(this.es, 0, 0, W, H), "r");
    }
  }

  // Intro: the title slams in on a pink hatched bar, the picture below darkened; fades out after ~3 s
  drawIntro(t) {
    const { g, W, H } = this;
    const out = t > INTRO - 0.6 ? (INTRO - t) / 0.6 : 1; // fade out
    g.save();
    g.globalAlpha = Math.max(0, out);
    g.fillStyle = `rgba(10, 3, 9, ${t < 0.25 ? 1 - t * 1.6 : 0.6})`;
    g.fillRect(0, 0, W, H);
    // The bar slides in from the left
    const bar = Math.min(1, t / 0.35);
    const bh = Math.min(W, H) * 0.3;
    g.translate(W / 2, H / 2);
    g.rotate(-0.08);
    g.fillStyle = "#ff3e8a";
    g.fillRect(-W * 0.75, -bh / 2, W * 1.5 * (1 - Math.pow(1 - bar, 3)), bh);
    g.fillStyle = "rgba(35, 15, 31, .35)";
    for (let x = -W * 0.75; x < W * 0.75 * (2 * bar - 1) + W * 0.02; x += 18) {
      g.beginPath();
      g.moveTo(x, -bh / 2);
      g.lineTo(x + 8, -bh / 2);
      g.lineTo(x + 8 - bh * 0.4, bh / 2);
      g.lineTo(x - bh * 0.4, bh / 2);
      g.fill();
    }
    g.restore();
    if (t > 0.2) {
      g.save();
      g.globalAlpha = Math.max(0, out);
      this.drawWord(this.title || "PMV", Math.min(0.29, (t - 0.2) * 0.5), 0.3, true);
      g.restore();
    }
  }

  // Outro: the picture darkens, title and details, the last second black
  drawOutro(p) {
    const { g, W, H } = this;
    const k = Math.min(1, p / (OUTRO - 1));
    g.save();
    g.fillStyle = `rgba(10, 3, 9, ${0.25 + 0.75 * k})`;
    g.fillRect(0, 0, W, H);
    g.globalAlpha = p < 0.4 ? p / 0.4 : p > OUTRO - 1.2 ? Math.max(0, (OUTRO - 0.3 - p) / 0.9) : 1;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const size = Math.min(W, H) * 0.12;
    g.font = `700 ${size}px "Bahnschrift Condensed", Bahnschrift, "Arial Narrow", Impact, sans-serif`;
    g.fillStyle = "#fbeff4";
    const title = String(this.title || "PMV").toUpperCase();
    const mw = g.measureText(title).width;
    if (mw > W * 0.86) g.font = `700 ${(size * W * 0.86) / mw}px "Bahnschrift Condensed", Bahnschrift, "Arial Narrow", Impact, sans-serif`;
    g.fillText(title, W / 2, H / 2 - size * 0.3);
    g.fillStyle = "#ff3e8a";
    g.fillRect(W / 2 - size * 1.2, H / 2 + size * 0.35, size * 2.4, Math.max(3, size * 0.06));
    g.font = `600 ${size * 0.28}px Bahnschrift, "Segoe UI", sans-serif`;
    g.fillStyle = "rgba(251, 239, 244, .75)";
    g.fillText(this.credits(), W / 2, H / 2 + size * 0.8);
    g.restore();
  }

  // Blurred, darkened border behind a fitted clip. A full-size blur(22px) per field and frame was
  // far too slow (≈10 fps without a strong GPU) – instead the clip goes into a canvas 1/16 of the
  // field's size, gets a tiny blur there and is scaled up: the upscaling does the rest of the blur.
  backdrop(i, m, s) {
    const k = 16;
    const bw = Math.max(4, Math.ceil(s.w / k));
    const bh = Math.max(4, Math.ceil(s.h / k));
    let c = this.backs[i];
    if (!c) c = this.backs[i] = document.createElement("canvas");
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
    const x = c.getContext("2d");
    const r = Math.max(bw / m.w, bh / m.h) * 1.15;
    x.filter = "blur(1.5px)";
    x.drawImage(m.el, (bw - m.w * r) / 2, (bh - m.h * r) / 2, m.w * r, m.h * r);
    x.filter = "none";
    const { g } = this;
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "medium";
    g.drawImage(c, 1, 1, bw - 2, bh - 2, s.x, s.y, s.w, s.h); // skip the soft edge pixels
    g.fillStyle = "rgba(0, 0, 0, .55)";
    g.fillRect(s.x, s.y, s.w, s.h);
    g.restore();
  }

  split(a) {
    const { g, W, H } = this;
    for (const [cv, color] of [[this.red, "#f00"], [this.cyan, "#0ff"]]) {
      const x = cv.getContext("2d");
      x.globalCompositeOperation = "source-over";
      x.drawImage(this.c, 0, 0);
      x.globalCompositeOperation = "multiply";
      x.fillStyle = color;
      x.fillRect(0, 0, W, H);
    }
    g.fillStyle = "#000";
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "lighter";
    g.drawImage(this.red, -a, 0);
    g.drawImage(this.cyan, a, 0);
    g.globalCompositeOperation = "source-over";
  }

  drawWord(word, tt, scale, hold) {
    const { g, W, H } = this;
    const text = word.toUpperCase();
    let size = Math.min(W, H) * (scale || 0.34);
    g.save();
    g.font = `700 ${size}px "Bahnschrift Condensed", Bahnschrift, "Arial Narrow", Impact, sans-serif`;
    const maxW = W * 0.86;
    const mw = g.measureText(text).width;
    if (mw > maxW) {
      size *= maxW / mw;
      g.font = `700 ${size}px "Bahnschrift Condensed", Bahnschrift, "Arial Narrow", Impact, sans-serif`;
    }
    const punch = 1 + 0.35 * Math.exp(-tt * 18);
    const fade = hold ? 1 : tt > 0.3 ? 1 - (tt - 0.3) / 0.12 : 1;
    g.globalAlpha *= Math.max(0, fade);
    g.translate(W / 2, H / 2);
    g.rotate(-0.1);
    g.transform(1, 0, -0.18, 1, 0, 0); // slanted like a sound effect
    g.scale(punch, punch);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineJoin = "round";
    g.fillStyle = "#ff3e8a";
    g.fillText(text, size * 0.05, size * 0.05);
    g.lineWidth = size * 0.1;
    g.strokeStyle = "#230f1f";
    g.strokeText(text, 0, 0);
    g.fillStyle = "#fbeff4";
    g.fillText(text, 0, 0);
    g.restore();
  }
}

// Draw media into a field (fill or fit), with mirroring, zoom and offset
const SCROLL = 0.34; // seconds a scroll cut takes
const SNAP = 1.16; // "Fit": a clip this close to the field's shape (ratio of the two aspect ratios) fills it
const INTRO = 3.2; // seconds
const OUTRO = 4.5;

function roundRect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function vignette(g, W, H, a) {
  const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, `rgba(0,0,0,${a})`);
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}

function drawIn(g, m, s, fit, zoom, ox, oy, filter, drift = true) {
  const r = fit === "contain" ? Math.min(s.w / m.w, s.h / m.h) : Math.max(s.w / m.w, s.h / m.h);
  const w = m.w * r * zoom;
  const h = m.h * r * zoom;
  g.save();
  g.beginPath();
  g.rect(s.x, s.y, s.w, s.h);
  g.clip();
  g.translate(s.x + s.w / 2 + ox, s.y + s.h / 2 + oy);
  g.scale(s.fx ? -1 : 1, s.fy ? -1 : 1);
  if (filter) g.filter = filter;
  if (m.kind === "image" && m.kb && drift) g.translate(m.kb * 18 * Math.min(1, (performance.now() - m.shownAt) / 4000), 0);
  // Smart crop: shift the picture so that its focus sits as central as possible –
  // only so far that the field stays filled (mirroring works automatically through scale())
  let sx = 0;
  let sy = 0;
  if (m.focus && fit !== "contain") {
    const rx = Math.max(0, (w - s.w) / 2);
    const ry = Math.max(0, (h - s.h) / 2);
    sx = Math.max(-rx, Math.min(rx, (0.5 - m.focus.x) * w));
    sy = Math.max(-ry, Math.min(ry, (0.5 - m.focus.y) * h));
  }
  g.drawImage(m.el, -w / 2 + sx, -h / 2 + sy, w, h);
  g.restore();
}

function makeGrain(c) {
  const x = c.getContext("2d");
  const img = x.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

function makeScanlines(c) {
  const x = c.getContext("2d");
  x.fillStyle = "rgba(0, 0, 0, .22)";
  x.fillRect(0, 0, 4, 2);
  return c;
}
