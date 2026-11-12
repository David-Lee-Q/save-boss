/* util.js — small shared helpers: math, RNG, canvas textures, DOM. */
(function (global) {
  'use strict';
  const U = {};

  U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
  U.smoothstep = (e0, e1, x) => { const t = U.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  U.rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
  U.rndi = (a, b) => Math.floor(U.rnd(a, b + 1));
  U.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  U.chance = (p) => Math.random() < p;
  U.wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  U.approachAngle = (cur, target, rate, dt) => {
    const d = U.wrapAngle(target - cur);
    return cur + U.clamp(d, -rate * dt, rate * dt);
  };

  /* deterministic RNG (mulberry32) */
  U.rng = function (seed) {
    let t = seed >>> 0;
    return function () {
      t = (t + 0x6D2B79F5) >>> 0;
      let r = t;
      r = Math.imul(r ^ (r >>> 15), r | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  };

  U.fmtTime = (s) => {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60);
    return (m < 10 ? '0' : '') + m + ':' + ((s % 60) < 10 ? '0' : '') + (s % 60);
  };

  U.el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* ---- canvas / texture helpers ---- */
  U.canvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { c: c, x: c.getContext('2d') };
  };

  U.noiseFill = function (ctx, w, h, base, amount, alpha) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amount;
      d[i] = U.clamp(d[i] + n, 0, 255);
      d[i + 1] = U.clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = U.clamp(d[i + 2] + n, 0, 255);
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    if (alpha) { ctx.globalAlpha = alpha; ctx.fillStyle = base; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
  };

  U.texFrom = function (canvas, opts) {
    opts = opts || {};
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    if (opts.offset) t.offset.set(opts.offset[0], opts.offset[1]);
    if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = U.aniso || 4;
    t.needsUpdate = true;
    return t;
  };

  U.aniso = 4;

  global.U = U;
})(window);
