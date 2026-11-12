/* audio.js — all sound is synthesised at runtime (no assets): weapons, steps, room tone, radio. */
(function (global) {
  'use strict';

  class Audio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = false;
      this.volume = 0.8;
      this.ambient = null;
      this.ready = false;
      this.lastStep = 0;
    }

    init() {
      if (this.ready) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { return; }
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 3.2;
      comp.attack.value = 0.004; comp.release.value = 0.24;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      // shared noise buffer
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      this.ready = true;
      this.startRoomTone();
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = this.muted ? 0 : v;
    }

    setMuted(m) {
      this.muted = m;
      if (this.master) this.master.gain.value = m ? 0 : this.volume;
    }

    noiseSrc(dur, cb) {
      if (!this.ready) return null;
      const ctx = this.ctx;
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.playbackRate.value = 0.8 + Math.random() * 0.5;
      const g = ctx.createGain();
      g.gain.value = 0;
      s.connect(g);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (pan) { g.connect(pan); pan.connect(this.master); } else g.connect(this.master);
      cb && cb(s, g, pan);
      const t = ctx.currentTime;
      s.start(t);
      s.stop(t + dur + 0.05);
      return { s: s, g: g, pan: pan };
    }

    tone(freq, dur, type, gain, slideTo, delay) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain == null ? 0.2 : gain, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }

    env(g, peak, attack, decay) {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    /* ---- weapons ---- */
    shot(pan) {
      if (!this.ready) return;
      const ctx = this.ctx;
      // crack
      const n = this.noiseSrc(0.3, (s, g, p) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 1650; bp.Q.value = 0.8;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(5200, ctx.currentTime);
        lp.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.22);
        s.connect(bp); bp.connect(lp); lp.connect(g);
        this.env(g, 0.55, 0.002, 0.24);
        if (p && pan != null) p.pan.value = pan;
      });
      // body thump
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(150, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(46, ctx.currentTime + 0.16);
      og.gain.setValueAtTime(0.34, ctx.currentTime);
      og.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
      o.connect(og); og.connect(this.master);
      o.start(); o.stop(ctx.currentTime + 0.22);
      // mechanical clack
      this.tone(2400, 0.045, 'square', 0.05, 900, 0.012);
    }

    enemyShot(dist, pan) {
      if (!this.ready) return;
      const d = U.clamp(1 - (dist || 12) / 40, 0.12, 1);
      const n = this.noiseSrc(0.34, (s, g, p) => {
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1500 + 1600 * d;
        s.connect(lp); lp.connect(g);
        this.env(g, 0.30 * d, 0.002, 0.26);
        if (p) p.pan.value = pan == null ? 0 : pan;
      });
      this.tone(120, 0.14, 'triangle', 0.10 * d, 40);
    }

    dryFire() { this.tone(1800, 0.05, 'square', 0.07, 500); }

    reload() {
      this.tone(720, 0.05, 'square', 0.06, 420);
      this.tone(1100, 0.04, 'triangle', 0.05, 700, 0.22);
      this.tone(640, 0.07, 'square', 0.07, 300, 0.55);
      this.tone(1400, 0.05, 'triangle', 0.06, 800, 0.72);
    }

    hitmarker(head) {
      this.tone(head ? 1650 : 980, head ? 0.10 : 0.06, 'triangle', 0.10, head ? 900 : 620);
      if (head) this.tone(2400, 0.12, 'sine', 0.05, 1500, 0.03);
    }

    impact(pan, metal) {
      if (!this.ready) return;
      this.noiseSrc(0.16, (s, g, p) => {
        const bp = this.ctx.createBiquadFilter();
        bp.type = metal ? 'bandpass' : 'lowpass';
        bp.frequency.value = metal ? 2800 : 900;
        bp.Q.value = metal ? 3.5 : 0.7;
        s.connect(bp); bp.connect(g);
        this.env(g, metal ? 0.14 : 0.20, 0.001, metal ? 0.16 : 0.1);
        if (p && pan != null) p.pan.value = pan;
      });
    }

    ricochet(pan) {
      this.tone(2100 + Math.random() * 900, 0.12, 'sine', 0.045, 700);
      if (this.ready) this.tone(3200, 0.08, 'triangle', 0.02, 1200, 0.03);
    }

    footstep(run, surface) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const now = ctx.currentTime;
      if (now - this.lastStep < 0.13) return;
      this.lastStep = now;
      const hard = surface === 'stone';
      this.noiseSrc(0.16, (s, g) => {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = hard ? 2400 : 900;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = hard ? 380 : 90;
        s.connect(hp); hp.connect(lp); lp.connect(g);
        this.env(g, (run ? 0.14 : 0.085) * (hard ? 1.15 : 0.8), 0.004, hard ? 0.10 : 0.14);
      });
    }

    bodyFall() {
      this.tone(90, 0.24, 'triangle', 0.2, 34);
      this.noiseSrc(0.3, (s, g) => {
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 420;
        s.connect(lp); lp.connect(g);
        this.env(g, 0.22, 0.01, 0.28);
      });
    }

    glass(pan) {
      if (!this.ready) return;
      for (let i = 0; i < 9; i++) {
        this.tone(1800 + Math.random() * 3600, 0.16 + Math.random() * 0.3, 'triangle', 0.03 + Math.random() * 0.05, 900, Math.random() * 0.1);
      }
      this.noiseSrc(0.5, (s, g, p) => {
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 2600;
        s.connect(hp); hp.connect(g);
        this.env(g, 0.18, 0.003, 0.42);
        if (p && pan != null) p.pan.value = pan;
      });
    }

    pickup(kind) {
      this.tone(kind === 'health' ? 660 : 520, 0.1, 'sine', 0.12, kind === 'health' ? 990 : 780);
      this.tone(kind === 'health' ? 990 : 780, 0.16, 'sine', 0.08, kind === 'health' ? 1320 : 1040, 0.08);
    }

    radio() {
      this.tone(1900, 0.05, 'square', 0.045, 1500);
      this.tone(1250, 0.06, 'square', 0.035, 1350, 0.06);
    }

    hurt() {
      this.tone(160, 0.28, 'triangle', 0.16, 60);
      this.noiseSrc(0.24, (s, g) => {
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 700;
        s.connect(lp); lp.connect(g);
        this.env(g, 0.2, 0.002, 0.2);
      });
    }

    heartbeat() {
      this.tone(58, 0.18, 'sine', 0.16, 40);
      this.tone(52, 0.22, 'sine', 0.11, 36, 0.19);
    }

    alarm(on) {
      if (!this.ready) return;
      if (on && !this.ambient) return;
      if (on) this.tone(680, 0.9, 'sine', 0.035, 940);
    }

    win() {
      const notes = [392, 523, 659, 784];
      notes.forEach((f, i) => this.tone(f, 0.7, 'sine', 0.10, f * 1.005, i * 0.14));
    }

    lose() {
      this.tone(220, 1.3, 'sine', 0.12, 92);
      this.tone(146, 1.6, 'triangle', 0.08, 60, 0.12);
    }

    startRoomTone() {
      if (!this.ready) return;
      const ctx = this.ctx;
      const s = ctx.createBufferSource();
      s.buffer = this.noise; s.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 320;
      const bp = ctx.createBiquadFilter();
      bp.type = 'peaking'; bp.frequency.value = 640; bp.gain.value = 6; bp.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.value = 0.035;
      // slow breathing of the HVAC
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 0.09; lg.gain.value = 0.012;
      lfo.connect(lg); lg.connect(g.gain);
      s.connect(lp); lp.connect(bp); bp.connect(g); g.connect(this.master);
      s.start(); lfo.start();
      // distant electrical hum
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 60; og.gain.value = 0.012;
      o.connect(og); og.connect(this.master);
      o.start();
      this.ambient = { s: s, g: g, o: o, lfo: lfo };
    }

    setAmbient(v) {
      if (!this.ambient) return;
      this.ambient.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.4);
    }
  }

  global.SFX = new Audio();
})(window);
