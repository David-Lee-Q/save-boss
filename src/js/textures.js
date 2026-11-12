/* textures.js — every surface in the wing is painted procedurally: no external assets. */
(function (global) {
  'use strict';
  const T = {};
  const A = (U.aniso = 4);

  function mk(w, h, draw, opts) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    draw(x, w, h);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = A;
    if (opts && opts.srgb === false) t.colorSpace = THREE.NoColorSpace;
    else t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  function grain(x, w, h, amt, alpha) {
    const img = x.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amt;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    x.putImageData(img, 0, 0);
  }

  function fbmCanvas(w, h, oct, freq, seed) {
    // returns a Float32 field 0..1, tileable by wrapping the lattice
    const rnd = U.rng(seed || 7);
    const out = new Float32Array(w * h);
    const layers = [];
    for (let o = 0; o < oct; o++) {
      const f = Math.max(2, Math.round(freq * Math.pow(2, o)));
      const g = new Float32Array(f * f);
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      layers.push({ f: f, g: g, amp: Math.pow(0.5, o) });
    }
    let norm = 0;
    for (const L of layers) norm += L.amp;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (const L of layers) {
          const fx = (x / w) * L.f, fy = (y / h) * L.f;
          const x0 = Math.floor(fx) % L.f, y0 = Math.floor(fy) % L.f;
          const x1 = (x0 + 1) % L.f, y1 = (y0 + 1) % L.f;
          let tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          const a = L.g[y0 * L.f + x0], b = L.g[y0 * L.f + x1];
          const c = L.g[y1 * L.f + x0], d = L.g[y1 * L.f + x1];
          const top = a + (b - a) * tx, bot = c + (d - c) * tx;
          v += (top + (bot - top) * ty) * L.amp;
        }
        out[y * w + x] = v / norm;
      }
    }
    return out;
  }

  /* ---------------------------------------------------------------- carpet */
  T.carpet = function (tint) {
    tint = tint || [38, 44, 58];
    return mk(512, 512, (x, w, h) => {
      x.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
      x.fillRect(0, 0, w, h);
      // loop pile: short random strokes in a slightly lighter/darker tone
      for (let i = 0; i < 26000; i++) {
        const px = Math.random() * w, py = Math.random() * h;
        const l = 1 + Math.random() * 2.6;
        const v = (Math.random() - 0.45) * 26;
        x.strokeStyle = `rgba(${U.clamp(tint[0] + v, 0, 255)},${U.clamp(tint[1] + v, 0, 255)},${U.clamp(tint[2] + v, 0, 255)},.75)`;
        x.lineWidth = 1;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 1.4, py + l); x.stroke();
      }
      // broad mottling from wear
      const f = fbmCanvas(64, 64, 3, 4, 21);
      for (let y = 0; y < 64; y++) for (let xx = 0; xx < 64; xx++) {
        const v = f[y * 64 + xx];
        x.fillStyle = `rgba(0,0,0,${Math.max(0, (v - 0.5)) * 0.18})`;
        x.fillRect(xx * 8, y * 8, 8, 8);
      }
    });
  };

  T.carpetRough = function () {
    return mk(256, 256, (x, w, h) => {
      x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const g = 150 + Math.random() * 90;
        x.fillStyle = `rgb(${g},${g},${g})`;
        x.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
      }
    }, { srgb: false });
  };

  /* ---------------------------------------------------------------- stone */
  T.marble = function (base, vein) {
    base = base || [214, 210, 200]; vein = vein || [86, 84, 80];
    const f = fbmCanvas(512, 512, 6, 3, 91);
    const f2 = fbmCanvas(512, 512, 4, 9, 41);
    return mk(512, 512, (x, w, h) => {
      const img = x.createImageData(w, h), d = img.data;
      for (let i = 0; i < w * h; i++) {
        const a = f[i], b = f2[i];
        let v = Math.pow(Math.abs(a - 0.5) * 2, 0.55);
        v = 1 - Math.min(1, v * 2.6);
        const swirl = Math.sin((a * 6 + b * 3) * Math.PI) * 0.5 + 0.5;
        const k = U.clamp(v * 0.85 + (1 - swirl) * 0.12, 0, 1);
        const g0 = 0.90 + (b - 0.5) * 0.14;
        for (let c = 0; c < 3; c++) d[i * 4 + c] = (base[c] * g0) * (1 - k * 0.78) + vein[c] * k * 0.78;
        d[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      grain(x, w, h, 7);
    });
  };

  T.concrete = function (tint) {
    tint = tint || [96, 98, 100];
    const f = fbmCanvas(256, 256, 4, 5, 5);
    return mk(256, 256, (x, w, h) => {
      const img = x.createImageData(w, h), d = img.data;
      for (let i = 0; i < w * h; i++) {
        const v = 0.85 + f[i] * 0.3;
        for (let c = 0; c < 3; c++) d[i * 4 + c] = U.clamp(tint[c] * v, 0, 255);
        d[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      grain(x, w, h, 12);
    });
  };

  /* ---------------------------------------------------------------- plaster */
  T.plaster = function (tint) {
    tint = tint || [206, 203, 195];
    const f = fbmCanvas(256, 256, 5, 6, 31);
    return mk(256, 256, (x, w, h) => {
      const img = x.createImageData(w, h), d = img.data;
      for (let i = 0; i < w * h; i++) {
        const v = 0.94 + f[i] * 0.1;
        for (let c = 0; c < 3; c++) d[i * 4 + c] = U.clamp(tint[c] * v, 0, 255);
        d[i * 4 + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      grain(x, w, h, 8);
    });
  };

  /* ---------------------------------------------------------------- ceiling tile */
  T.ceiling = function () {
    return mk(512, 512, (x, w, h) => {
      x.fillStyle = '#d8d5cc'; x.fillRect(0, 0, w, h);
      // mineral fibre pinholes
      for (let i = 0; i < 24000; i++) {
        const g = 150 + Math.random() * 70;
        x.fillStyle = `rgba(${g},${g - 2},${g - 8},.5)`;
        x.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
      }
      // panel bevel + T-bar shadow
      x.strokeStyle = 'rgba(120,118,110,.55)'; x.lineWidth = 3;
      x.strokeRect(2, 2, w - 4, h - 4);
      x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1;
      x.strokeRect(8, 8, w - 16, h - 16);
      x.fillStyle = 'rgba(60,60,58,.20)';
      x.fillRect(0, 0, w, 5); x.fillRect(0, h - 5, w, 5);
      grain(x, w, h, 6);
    });
  };

  /* ---------------------------------------------------------------- wood */
  T.wood = function (dark) {
    const c0 = dark ? [58, 38, 26] : [122, 84, 52];
    const c1 = dark ? [30, 20, 15] : [78, 50, 30];
    const f = fbmCanvas(512, 512, 3, 3, 13);
    return mk(512, 512, (x, w, h) => {
      const img = x.createImageData(w, h), d = img.data;
      for (let y = 0; y < h; y++) {
        for (let xx = 0; xx < w; xx++) {
          const i = y * w + xx;
          const warp = f[i] * 26;
          const rings = Math.sin((xx * 0.075) + warp * 0.55 + Math.sin(y * 0.006) * 2.0);
          let v = 0.55 + rings * 0.16 + (f[i] - 0.5) * 0.35;
          v += Math.sin(y * 0.7 + f[i] * 12) * 0.035;
          v = U.clamp(v, 0, 1);
          const k = v * v * 0.9;
          for (let c = 0; c < 3; c++) d[i * 4 + c] = c0[c] * (1 - k) + c1[c] * k;
          d[i * 4 + 3] = 255;
        }
      }
      x.putImageData(img, 0, 0);
      grain(x, w, h, 8);
    });
  };

  /* ---------------------------------------------------------------- metal */
  T.metal = function (tint) {
    tint = tint || [150, 152, 154];
    return mk(256, 256, (x, w, h) => {
      x.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 2800; i++) {
        const y = Math.random() * h, l = Math.random() * 240;
        const v = (Math.random() - 0.5) * 30;
        x.strokeStyle = `rgba(${U.clamp(tint[0] + v, 0, 255)},${U.clamp(tint[1] + v, 0, 255)},${U.clamp(tint[2] + v, 0, 255)},.5)`;
        x.lineWidth = Math.random() < 0.8 ? 1 : 2;
        x.beginPath(); x.moveTo(Math.random() * w, y); x.lineTo(Math.random() * w + l, y); x.stroke();
      }
      grain(x, w, h, 10);
    });
  };

  T.metalRough = function (base) {
    base = base == null ? 0.32 : base;
    return mk(256, 256, (x, w, h) => {
      const g = Math.round(base * 255);
      x.fillStyle = `rgb(${g},${g},${g})`; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 3000; i++) {
        const v = g + (Math.random() - 0.5) * 60;
        x.strokeStyle = `rgba(${v},${v},${v},.5)`;
        x.lineWidth = 1;
        const y = Math.random() * h;
        x.beginPath(); x.moveTo(Math.random() * w, y); x.lineTo(Math.random() * w, y); x.stroke();
      }
      grain(x, w, h, 22);
    }, { srgb: false });
  };

  /* ---------------------------------------------------------------- glass */
  T.glassStreak = function () {
    return mk(256, 256, (x, w, h) => {
      x.fillStyle = 'rgba(255,255,255,1)'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const px = Math.random() * w;
        const grad = x.createLinearGradient(px, 0, px + 30, h);
        grad.addColorStop(0, 'rgba(255,255,255,0)');
        grad.addColorStop(0.4 + Math.random() * 0.3, 'rgba(255,255,255,' + (0.05 + Math.random() * 0.12) + ')');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = grad;
        x.fillRect(px, 0, 12 + Math.random() * 40, h);
      }
      grain(x, w, h, 5);
    });
  };

  /* ---------------------------------------------------------------- signage */
  T.sign = function (title, sub, opts) {
    opts = opts || {};
    return mk(768, 320, (x, w, h) => {
      x.fillStyle = opts.dark ? '#0d1013' : '#111417';
      x.fillRect(0, 0, w, h);
      if (!opts.plain) {
        x.strokeStyle = 'rgba(232,228,218,.18)'; x.lineWidth = 2;
        x.strokeRect(14, 14, w - 28, h - 28);
      }
      x.fillStyle = opts.accent || '#ffb347';
      x.fillRect(46, 66, 5, h - 132);
      x.textBaseline = 'alphabetic';
      x.fillStyle = '#f2eee4';
      x.font = '700 80px "PingFang SC","Microsoft YaHei",sans-serif';
      x.fillText(title, 76, h * 0.52);
      if (sub) {
        x.fillStyle = 'rgba(232,228,218,.62)';
        x.font = '500 30px "PingFang SC","Microsoft YaHei",sans-serif';
        x.letterSpacing = '6px';
        x.fillText(sub, 78, h * 0.52 + 52);
      }
      grain(x, w, h, 5);
    });
  };

  T.plate = function (txt, sub) {
    return mk(512, 200, (x, w, h) => {
      x.fillStyle = '#14181b'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(232,228,218,.28)'; x.lineWidth = 3; x.strokeRect(8, 8, w - 16, h - 16);
      x.fillStyle = '#e8e4da'; x.font = '700 66px "PingFang SC","Microsoft YaHei",sans-serif';
      x.textAlign = 'center'; x.fillText(txt, w / 2, h * 0.56);
      if (sub) {
        x.fillStyle = 'rgba(232,228,218,.55)'; x.font = '500 28px "PingFang SC",sans-serif';
        x.fillText(sub, w / 2, h * 0.82);
      }
    });
  };

  /* ---------------------------------------------------------------- screens */
  T.screen = function (seed) {
    const rng = U.rng(seed || 3);
    return mk(512, 320, (x, w, h) => {
      x.fillStyle = '#0a0f14'; x.fillRect(0, 0, w, h);
      if (rng() < 0.5) {
        // trading / metrics dashboard
        x.fillStyle = '#0d1a22'; x.fillRect(0, 0, w, 42);
        x.fillStyle = '#6ee7c2'; x.font = '600 18px ui-monospace,monospace';
        x.fillText('Q4  REVENUE  ▲ 12.4%', 16, 27);
        x.strokeStyle = 'rgba(110,231,194,.25)'; x.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
          const y = 70 + i * 40;
          x.beginPath(); x.moveTo(16, y); x.lineTo(w - 16, y); x.stroke();
        }
        x.strokeStyle = '#6ee7c2'; x.lineWidth = 2.5; x.beginPath();
        for (let i = 0; i <= 60; i++) {
          const px = 16 + (i / 60) * (w - 32);
          const py = 250 - (Math.sin(i * 0.28 + seed) * 26 + i * 1.5 + rng() * 14);
          i ? x.lineTo(px, py) : x.moveTo(px, py);
        }
        x.stroke();
        for (let i = 0; i < 4; i++) {
          x.fillStyle = ['#ffb347', '#5aa9ff', '#6ee7c2', '#d96b4a'][i];
          x.fillRect(20 + i * 74, 292, 60, 10);
        }
      } else if (rng() < 0.55) {
        // spreadsheet
        x.fillStyle = '#101418'; x.fillRect(0, 0, w, h);
        x.fillStyle = '#1b2127'; x.fillRect(0, 0, w, 34);
        x.fillStyle = '#8fa0ad'; x.font = '13px ui-monospace,monospace';
        x.fillText('预算 / FY26 运 营 成 本', 12, 22);
        for (let r = 0; r < 9; r++) for (let c = 0; c < 7; c++) {
          x.fillStyle = (r === 0) ? '#232b32' : '#151b21';
          x.fillRect(10 + c * 70 + 2, 44 + r * 26 + 2, 66, 22);
          if (r > 0 && c > 0 && rng() < 0.7) {
            x.fillStyle = 'rgba(200,210,220,.5)'; x.fillRect(16 + c * 70, 52 + r * 26, 12 + rng() * 40, 5);
          }
        }
      } else {
        // presentation slide
        x.fillStyle = '#141a20'; x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgba(255,179,71,.9)'; x.fillRect(30, 30, 90, 6);
        x.fillStyle = '#e6e2d8'; x.font = '700 34px "PingFang SC",sans-serif';
        x.fillText('几猫中心 · 42F', 30, 88);
        x.fillStyle = 'rgba(230,226,216,.55)'; x.font = '17px "PingFang SC",sans-serif';
        x.fillText('年度战略回顾   CONFIDENTIAL', 30, 120);
        for (let i = 0; i < 4; i++) {
          x.fillStyle = 'rgba(255,255,255,.06)'; x.fillRect(30 + i * 118, 150, 100, 120);
          x.fillStyle = ['#5aa9ff', '#6ee7c2', '#ffb347', '#d96b4a'][i];
          const bh = 20 + rng() * 80;
          x.fillRect(30 + i * 118 + 12, 258 - bh, 76, bh);
        }
      }
      // scanline + glass sheen
      x.fillStyle = 'rgba(255,255,255,.03)';
      for (let y = 0; y < h; y += 3) x.fillRect(0, y, w, 1);
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(255,255,255,.10)'); g.addColorStop(0.35, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
  };

  /* ---------------------------------------------------------------- city at night */
  T.city = function (seed) {
    const rng = U.rng(seed || 11);
    const W = 2048, H = 1024;
    return mk(W, H, (x, w, h) => {
      const sky = x.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#05070c');
      sky.addColorStop(0.42, '#0a1019');
      sky.addColorStop(0.66, '#152232');
      sky.addColorStop(0.84, '#2b3a48');
      sky.addColorStop(1, '#1a232c');
      x.fillStyle = sky; x.fillRect(0, 0, w, h);

      // faint cloud deck lit from below by the city
      for (let i = 0; i < 60; i++) {
        const cx = rng() * w, cy = h * 0.18 + rng() * h * 0.3;
        const rw = 90 + rng() * 380, rh = 18 + rng() * 60;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, rw);
        g.addColorStop(0, 'rgba(120,140,165,.10)');
        g.addColorStop(1, 'rgba(120,140,165,0)');
        x.fillStyle = g;
        x.save(); x.translate(cx, cy); x.scale(1, rh / rw); x.translate(-cx, -cy);
        x.beginPath(); x.arc(cx, cy, rw, 0, 6.2832); x.fill(); x.restore();
      }

      // distant skyline: three depth bands
      const bands = [
        { base: h * 0.60, lo: 60, hi: 210, alpha: 0.55, col: '18,26,36', win: 0.30, wcol: '120,150,180' },
        { base: h * 0.70, lo: 90, hi: 300, alpha: 0.75, col: '12,18,26', win: 0.42, wcol: '168,190,210' },
        { base: h * 0.80, lo: 120, hi: 380, alpha: 0.95, col: '8,12,18', win: 0.55, wcol: '198,208,215' }
      ];
      for (let bi = 0; bi < bands.length; bi++) {
        const b = bands[bi];
        let px = -40;
        while (px < w + 40) {
          const bw = 34 + rng() * 110 * (1 + bi * 0.4);
          const bh = b.lo + rng() * (b.hi - b.lo);
          const top = b.base - bh;
          x.fillStyle = `rgba(${b.col},${b.alpha})`;
          x.fillRect(px, top, bw, h - top);
          // lit windows
          const cols = Math.max(2, Math.floor(bw / 13));
          const rows = Math.max(4, Math.floor(bh / 15));
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              if (rng() > b.win) continue;
              const wx = px + 5 + c * (bw - 8) / cols;
              const wy = top + 8 + r * (bh - 10) / rows;
              const k = 0.25 + rng() * 0.75;
              x.fillStyle = `rgba(${b.wcol},${k})`;
              x.fillRect(wx, wy, 2.6 + rng() * 1.6, 3.4 + rng() * 1.4);
            }
          }
          // roof details
          if (rng() < 0.4) {
            x.fillStyle = `rgba(${b.col},${b.alpha})`;
            x.fillRect(px + bw * 0.3, top - 14 - rng() * 20, 5, 34);
            x.fillStyle = 'rgba(255,60,50,.75)';
            x.fillRect(px + bw * 0.3 + 1.4, top - 17 - rng() * 20, 2, 2);
          }
          px += bw + 3 + rng() * 14;
        }
      }

      // near foreground towers (cropped, very dark)
      for (let i = 0; i < 9; i++) {
        const bw = 160 + rng() * 300;
        const px = rng() * w;
        const top = h * 0.1 + rng() * h * 0.25;
        x.fillStyle = 'rgba(4,6,9,.96)';
        x.fillRect(px, top, bw, h - top);
        for (let r = 0; r < 26; r++) for (let c = 0; c < 12; c++) {
          if (rng() < 0.62) continue;
          x.fillStyle = `rgba(210,175,120,${0.12 + rng() * 0.5})`;
          x.fillRect(px + 10 + c * (bw - 20) / 12, top + 14 + r * 30, 7 + rng() * 5, 9);
        }
      }

      // atmospheric haze near the horizon
      const hz = x.createLinearGradient(0, h * 0.55, 0, h);
      hz.addColorStop(0, 'rgba(40,58,78,0)');
      hz.addColorStop(0.55, 'rgba(48,66,84,.26)');
      hz.addColorStop(1, 'rgba(20,28,38,.5)');
      x.fillStyle = hz; x.fillRect(0, h * 0.5, w, h * 0.5);
      grain(x, w, h, 10);
    });
  };

  /* ---------------------------------------------------------------- art / decor */
  T.art = function (seed, palette) {
    const rng = U.rng(seed || 5);
    const pal = palette || ['#1e2a35', '#2d3c48', '#b0773c', '#d9cbb6', '#7f8c95'];
    return mk(384, 480, (x, w, h) => {
      x.fillStyle = pal[0]; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        x.globalAlpha = 0.25 + rng() * 0.6;
        x.fillStyle = pal[(rng() * pal.length) | 0];
        if (rng() < 0.5) {
          x.beginPath();
          x.ellipse(rng() * w, rng() * h, 20 + rng() * 130, 14 + rng() * 160, rng() * 3, 0, 6.28);
          x.fill();
        } else {
          x.fillRect(rng() * w, rng() * h, 6 + rng() * 150, 3 + rng() * 90);
        }
      }
      x.globalAlpha = 1;
      // canvas weave
      for (let y = 0; y < h; y += 2) { x.fillStyle = 'rgba(0,0,0,.035)'; x.fillRect(0, y, w, 1); }
      grain(x, w, h, 12);
    });
  };

  T.whiteboard = function (seed) {
    const rng = U.rng(seed || 9);
    return mk(768, 384, (x, w, h) => {
      x.fillStyle = '#e9e9e4'; x.fillRect(0, 0, w, h);
      x.strokeStyle = '#14181b'; x.lineWidth = 2.5;
      x.strokeRect(28, 30, 300, 150);
      x.strokeRect(360, 30, 360, 150);
      x.fillStyle = '#1b2026'; x.font = '600 20px "PingFang SC",sans-serif';
      x.fillText('Q4 目标', 42, 60);
      x.fillText('风险 / 时间线', 374, 60);
      x.strokeStyle = '#2c5f8a'; x.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        x.beginPath(); x.moveTo(44, 84 + i * 20); x.lineTo(44 + 100 + rng() * 150, 84 + i * 20); x.stroke();
      }
      x.strokeStyle = '#a8442c';
      for (let i = 0; i < 4; i++) {
        x.beginPath(); x.moveTo(378, 84 + i * 24); x.lineTo(378 + 80 + rng() * 250, 84 + i * 24); x.stroke();
      }
      // sticky notes
      for (let i = 0; i < 7; i++) {
        x.save();
        x.translate(60 + rng() * 620, 210 + rng() * 120);
        x.rotate((rng() - 0.5) * 0.14);
        x.fillStyle = ['#f2d38a', '#f0a9a0', '#a9d8c5', '#a9c2e0'][i % 4];
        x.fillRect(-30, -24, 60, 48);
        x.fillStyle = 'rgba(30,30,30,.45)';
        x.fillRect(-20, -8, 40, 3); x.fillRect(-20, 2, 28, 3);
        x.restore();
      }
      x.fillStyle = 'rgba(20,24,28,.5)'; x.font = '600 26px "PingFang SC",sans-serif';
      x.fillText('陈董 · 周五 09:00 复盘', 400, 340);
      grain(x, w, h, 6);
    });
  };

  T.paper = function () {
    return mk(256, 256, (x, w, h) => {
      x.fillStyle = '#efece3'; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(40,44,50,.55)';
      for (let i = 0; i < 22; i++) x.fillRect(22, 40 + i * 9, 40 + Math.random() * 170, 2);
      x.fillStyle = 'rgba(40,44,50,.75)'; x.fillRect(22, 24, 100, 6);
      grain(x, w, h, 5);
    });
  };

  T.fabric = function (tint) {
    tint = tint || [46, 50, 56];
    return mk(128, 128, (x, w, h) => {
      x.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 5000; i++) {
        const v = (Math.random() - 0.5) * 22;
        x.fillStyle = `rgba(${U.clamp(tint[0] + v, 0, 255)},${U.clamp(tint[1] + v, 0, 255)},${U.clamp(tint[2] + v, 0, 255)},.7)`;
        x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      x.strokeStyle = 'rgba(0,0,0,.10)';
      for (let y = 0; y < h; y += 4) { x.beginPath(); x.moveTo(0, y); x.lineTo(w, y); x.stroke(); }
      x.strokeStyle = 'rgba(255,255,255,.035)';
      for (let xx = 0; xx < w; xx += 4) { x.beginPath(); x.moveTo(xx, 0); x.lineTo(xx, h); x.stroke(); }
    });
  };

  T.poster = function (title, sub, color) {
    return mk(512, 720, (x, w, h) => {
      x.fillStyle = color || '#101418'; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(255,255,255,.06)';
      for (let i = 0; i < 7; i++) x.fillRect(40, 90 + i * 74, w - 80, 2);
      x.fillStyle = '#f0ece2'; x.font = '900 92px "PingFang SC",sans-serif';
      x.fillText(title, 46, 170);
      x.fillStyle = '#ffb347'; x.font = '600 30px "PingFang SC",sans-serif';
      x.fillText(sub, 48, 220);
      x.fillStyle = 'rgba(240,236,226,.35)'; x.font = '500 20px ui-monospace,monospace';
      x.fillText('JIMAO TOWER · 42F', 48, h - 54);
      grain(x, w, h, 10);
    });
  };

  T.noise = function () {
    const W = 256, H = 256;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const img = x.createImageData(W, H), d = img.data;
    for (let i = 0; i < W * H; i++) {
      const v = 128 + (Math.random() - 0.5) * 130;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };

  /* equirect environment: dark room with warm strips and cold windows */
  T.envEquirect = function () {
    const W = 1024, H = 512;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0d11');
    g.addColorStop(0.45, '#1a222b');
    g.addColorStop(0.52, '#2c3946');
    g.addColorStop(0.62, '#12171d');
    g.addColorStop(1, '#07090c');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // window band (cool)
    for (let i = 0; i < 9; i++) {
      x.fillStyle = 'rgba(120,170,235,.55)';
      x.fillRect(i * 118 + 14, 150, 88, 96);
      x.fillStyle = 'rgba(20,26,34,.9)';
      x.fillRect(i * 118 + 58, 150, 5, 96);
    }
    // warm ceiling strips
    for (let i = 0; i < 14; i++) {
      x.fillStyle = 'rgba(255,190,120,.85)';
      x.fillRect(i * 74 + 8, 48, 54, 8);
    }
    // floor bounce
    x.fillStyle = 'rgba(90,72,52,.18)';
    x.fillRect(0, 400, W, 112);
    const t = new THREE.CanvasTexture(cv);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  global.TEX = T;
})(window);
