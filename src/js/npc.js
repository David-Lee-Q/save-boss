/* npc.js — humanoids, robbers with nav/combat AI, hostages, the boss. Also shared collision + raycast. */
(function (global) {
  'use strict';

  /* ============================================================== physics */
  const Phys = {};

  // circle vs level AABBs; y is feet height, h body height
  Phys.blocked = function (x, z, r) {
    const y0 = 0.25, y1 = 1.7;
    for (const c of LV.colliders) {
      if (c.y1 < y0 || c.y0 > y1) continue;
      if (x + r > c.x1 && x - r < c.x2 && z + r > c.z1 && z - r < c.z2) return c;
    }
    return null;
  };

  // move with axis separation so sliding along walls works
  Phys.move = function (p, dx, dz, r) {
    const steps = Math.max(1, Math.ceil((Math.abs(dx) + Math.abs(dz)) / 0.18));
    const sx = dx / steps, sz = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (!Phys.blocked(p.x + sx, p.z, r)) p.x += sx;
      else {
        // try tiny nudge inward to slip past corners
        if (!Phys.blocked(p.x + Math.sign(sx) * 0.02, p.z + Math.sign(sz) * 0.05, r * 0.9)) p.x += Math.sign(sx) * 0.01;
      }
      if (!Phys.blocked(p.x, p.z + sz, r)) p.z += sz;
    }
  };

  // ray vs AABB slab test; returns t or null. y range filter for walls only.
  function rayBox(ox, oy, oz, dx, dy, dz, c, out) {
    let tmin = 0, tmax = 1e9, axis = -1, sign = 1;
    const o = [ox, oy, oz], d = [dx, dy, dz];
    const lo = [c.x1, c.y0, c.z1], hi = [c.x2, c.y1, c.z2];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-8) {
        if (o[i] < lo[i] || o[i] > hi[i]) return null;
      } else {
        let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    out.t = tmin;
    out.axis = axis;
    out.sign = sign;
    return out;
  }

  const tmpHit = { t: 0, axis: 0, sign: 1 };
  Phys.rayWalls = function (origin, dir, dist) {
    let best = null;
    const o = origin, d = dir;
    for (const c of LV.colliders) {
      if (c.y0 > 2.6) continue;
      const h = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, c, tmpHit);
      if (h && h.t > 0.02 && h.t <= dist && (!best || h.t < best.t)) {
        best = { t: h.t, axis: h.axis, sign: h.sign, c: c };
      }
    }
    if (best) {
      const n = new THREE.Vector3(0, 0, 0);
      n.setComponent(best.axis, best.sign);
      best.normal = n;
      best.point = new THREE.Vector3(o.x + d.x * best.t, o.y + d.y * best.t, o.z + d.z * best.t);
    }
    return best;
  };

  // segment blocked (for AI vision): ignore low furniture
  Phys.los = function (ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.001) return true;
    const nx = dx / len, ny = dy / len, nz = dz / len;
    for (const c of LV.colliders) {
      if (c.y1 < Math.min(ay, by) - 0.2) continue;
      if (c.y0 > Math.max(ay, by)) continue;
      if (c.y1 - c.y0 < 0.9 && c.y1 < 1.1) continue;      // low desks don't block sight fully
      const h = rayBox(ax, ay, az, nx, ny, nz, c, tmpHit);
      if (h && h.t > 0.02 && h.t < len - 0.3) return false;
    }
    return true;
  };

  // ray vs vertical capsule (feet y, height, radius) → {t, head}
  Phys.rayActor = function (origin, dir, actor, maxT) {
    const feet = actor.pos.y || 0;
    // head sphere
    const hy = feet + actor.height - 0.16;
    const hx = actor.pos.x, hz = actor.pos.z;
    const sphere = raySphere(origin, dir, new THREE.Vector3(hx, hy, hz), 0.155);
    // body: use two spheres, cheap and forgiving
    let best = null;
    if (sphere && sphere < maxT) best = { t: sphere, head: true };
    const centers = [[0.55, 0.36], [1.05, 0.34], [1.38, 0.30]];
    for (const [cy, cr] of centers) {
      const t = raySphere(origin, dir, new THREE.Vector3(hx, feet + cy, hz), cr);
      if (t && t < maxT && (!best || t < best.t)) best = { t: t, head: false };
    }
    return best;
  };

  function raySphere(o, d, c, r) {
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    let t = -b - sq;
    if (t < 0.02) t = -b + sq;
    return t > 0.02 ? t : null;
  }

  /* ============================================================== rig */
  const M = {};
  function mats() {
    if (M.ready) return M;
    M.skin = new THREE.MeshStandardMaterial({ color: 0xc79a78, roughness: 0.78 });
    M.skinDark = new THREE.MeshStandardMaterial({ color: 0x8f6448, roughness: 0.8 });
    M.skinPale = new THREE.MeshStandardMaterial({ color: 0xd9b394, roughness: 0.76 });
    M.hair = new THREE.MeshStandardMaterial({ color: 0x1b1713, roughness: 0.9 });
    M.suit = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.82 });
    M.suit2 = new THREE.MeshStandardMaterial({ color: 0x353c45, roughness: 0.85 });
    M.shirt = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.8 });
    M.tie = new THREE.MeshStandardMaterial({ color: 0x6d2b28, roughness: 0.72 });
    M.black = new THREE.MeshStandardMaterial({ color: 0x14171a, roughness: 0.88 });
    M.black2 = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.8 });
    M.vest = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.75, metalness: 0.12 });
    M.accent = new THREE.MeshStandardMaterial({ color: 0xc2452a, roughness: 0.7 });
    M.steel = new THREE.MeshStandardMaterial({ color: 0x8d969c, roughness: 0.35, metalness: 0.9 });
    M.denim = new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.9 });
    M.ready = true;
    return M;
  }

  function limb(w, h, d, mat) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, -h / 2, 0);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    return m;
  }

  /* builds a humanoid; returns rig with joints */
  function buildRig(kind) {
    const m = mats();
    const orig = { kind: kind };
    const root = new THREE.Group();
    const pelvis = new THREE.Group();
    pelvis.position.y = 0.92;
    root.add(pelvis);

    const body = new THREE.Group();     // torso pivot at hips
    pelvis.add(body);

    // torso
    let torsoMat = m.suit, chestMat = m.shirt;
    if (kind === 'robber') { torsoMat = m.black; chestMat = m.vest; }
    if (kind === 'boss') { torsoMat = m.suit; chestMat = m.shirt; }
    if (kind === 'hostage') { torsoMat = m.suit2; chestMat = m.shirt; }

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.52, 0.23), torsoMat);
    torso.position.y = 0.26; torso.castShadow = true;
    body.add(torso);
    // chest panel / vest
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.06), chestMat);
    chest.position.set(0, 0.30, 0.115); chest.castShadow = true;
    body.add(chest);
    if (kind === 'robber') {
      // plate carrier straps + pouches + armband
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.25), m.black2);
      strap.position.set(0, 0.44, 0); body.add(strap);
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.06), m.black2);
        p.position.set(-0.11 + i * 0.11, 0.20, 0.15); body.add(p);
      }
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.10, 0.05), new THREE.MeshStandardMaterial({ color: 0xd8d3c6, roughness: 0.9 }));
      patch.position.set(0.11, 0.36, 0.148); body.add(patch);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.05, 0.115), m.accent);
      band.position.set(0, 0.0, 0); // placed on arm below
      orig.band = band;
    }
    if (kind === 'boss' || kind === 'hostage') {
      const shirtV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.34, 0.02), m.shirt);
      shirtV.position.set(0, 0.34, 0.15); body.add(shirtV);
      if (kind === 'boss') {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.26, 0.015), m.tie);
        tie.position.set(0, 0.28, 0.162); body.add(tie);
      }
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.06, 0.245), m.black);
      belt.position.set(0, -0.01, 0); body.add(belt);
    }
    if (kind === 'robber') {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.41, 0.07, 0.245), m.black2);
      belt.position.set(0, 0.0, 0); body.add(belt);
    }

    // neck + head
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.10), m.skin);
    neck.position.y = 0.55; body.add(neck);
    const head = new THREE.Group();
    head.position.y = 0.67;
    body.add(head);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.23, 0.20), m.skin);
    skull.position.y = 0.02; skull.castShadow = true;
    head.add(skull);
    if (kind === 'robber') {
      const mask = new THREE.Mesh(new THREE.BoxGeometry(0.196, 0.155, 0.207), m.black);
      mask.position.y = -0.005; head.add(mask);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.03, 0.21), m.black2);
      brow.position.y = 0.08; head.add(brow);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.035, 0.01), new THREE.MeshStandardMaterial({ color: 0xd8c8b4, roughness: 0.5 }));
      eye.position.set(0, 0.055, 0.102); head.add(eye);
    } else {
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.075, 0.21), kind === 'hostage' ? m.hair : m.hair);
      hair.position.y = 0.135; head.add(hair);
      if (kind === 'boss') {
        const grey = new THREE.MeshStandardMaterial({ color: 0x6b6a66, roughness: 0.9 });
        hair.material = grey;
      }
      // glasses for the boss
      if (kind === 'boss') {
        const gl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.01), new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: 0.2, metalness: 0.6 }));
        gl.position.set(0, 0.045, 0.105); head.add(gl);
      }
    }

    // arms
    function arm(side) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.245, 0.47, 0);
      body.add(shoulder);
      const upper = limb(0.10, 0.30, 0.11, kind === 'robber' ? m.black : torsoMat);
      shoulder.add(upper);
      if (kind === 'robber' && side < 0) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.045, 0.118), m.accent);
        band.position.y = -0.24; shoulder.add(band);
      }
      const elbow = new THREE.Group();
      elbow.position.y = -0.30;
      shoulder.add(elbow);
      const fore = limb(0.09, 0.28, 0.095, kind === 'robber' ? m.black : torsoMat);
      elbow.add(fore);
      // hand
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.10, 0.085), kind === 'robber' ? m.black2 : m.skin);
      hand.position.y = -0.315; hand.castShadow = true;
      elbow.add(hand);
      return { shoulder: shoulder, elbow: elbow, hand: hand };
    }
    const armL = arm(-1), armR = arm(1);

    // legs
    function leg(side) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.115, 0, 0);
      pelvis.add(hip);
      const thigh = limb(0.145, 0.42, 0.16, kind === 'robber' ? m.black2 : (kind === 'hostage' ? m.denim : m.suit));
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(knee);
      const shin = limb(0.125, 0.40, 0.14, kind === 'robber' ? m.black2 : (kind === 'hostage' ? m.denim : m.suit));
      knee.add(shin);
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.075, 0.25), m.black);
      shoe.position.set(0, -0.40, 0.04); shoe.castShadow = true;
      knee.add(shoe);
      return { hip: hip, knee: knee };
    }
    const legL = leg(-1), legR = leg(1);

    const rig = {
      root: root, pelvis: pelvis, body: body, head: head,
      armL: armL, armR: armR, legL: legL, legR: legR, kind: kind
    };

    // weapon for robbers
    if (kind === 'robber') {
      const gun = new THREE.Group();
      const gm = m.steel, gd = m.black2;
      const rec = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.075, 0.34), gd);
      gun.add(rec);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 8), gm);
      bar.rotation.x = Math.PI / 2; bar.position.set(0, 0.012, -0.28); gun.add(bar);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.13, 0.06), gd);
      mag.position.set(0, -0.09, -0.02); gun.add(mag);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.16), gd);
      stock.position.set(0, -0.005, 0.22); gun.add(stock);
      gun.position.set(0.06, -0.10, -0.12);
      armR.elbow.add(gun);
      rig.gun = gun;
      rig.muzzle = new THREE.Object3D();
      rig.muzzle.position.set(0, 0.012, -0.42);
      gun.add(rig.muzzle);
      // muzzle flash sprite
      const fm = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fm);
      f.visible = false;
      f.position.copy(rig.muzzle.position);
      gun.add(f);
      rig.flash = f;
      rig.flashMat = fm;
      // pose arms to hold it
      armR.shoulder.rotation.x = -1.25; armR.elbow.rotation.x = -0.55;
      armL.shoulder.rotation.x = -1.32; armL.shoulder.rotation.z = 0.42; armL.elbow.rotation.x = -0.75;
    }

    // boss in chair: legs down, arms behind back
    if (kind === 'boss' || kind === 'hostage') {
      armL.shoulder.rotation.x = 0.15; armL.elbow.rotation.x = -0.2;
      armR.shoulder.rotation.x = 0.15; armR.elbow.rotation.x = -0.2;
    }

    rig.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return rig;
  }

  /* ============================================================== character */
  class Character {
    constructor(scene, kind, x, z, ry) {
      this.scene = scene;
      this.kind = kind;
      this.rig = buildRig(kind);
      this.pos = new THREE.Vector3(x, 0, z);
      this.ry = ry || 0;
      this.height = 1.78;
      this.radius = 0.32;
      this.alive = true;
      this.phase = Math.random() * 6.28;
      this.walkAmt = 0;
      this.aimAmt = 0;
      this.speed = 0;
      this.flashT = 0;
      this.deadT = 0;
      this.scene.add(this.rig.root);
      this.sync(0);
    }

    setPos(x, z) { this.pos.set(x, 0, z); }

    sync(dt) {
      const r = this.rig;
      r.root.position.copy(this.pos);
      r.root.rotation.y = this.ry;
    }

    /* procedural animation: walk cycle + aim + idle breath */
    animate(dt, opts) {
      opts = opts || {};
      const r = this.rig;
      const t = (this.phase += dt * (opts.stepRate || 7));
      const walk = this.walkAmt;
      const bre = Math.sin(t * 0.7) * 0.5 + 0.5;

      if (this.kind === 'robber') {
        const aim = this.aimAmt;
        const sw = Math.sin(t) * 0.55 * walk;
        r.legL.hip.rotation.x = sw;
        r.legR.hip.rotation.x = -sw;
        r.legL.knee.rotation.x = Math.max(0, -Math.cos(t) * 0.7) * walk;
        r.legR.knee.rotation.x = Math.max(0, Math.cos(t) * 0.7) * walk;
        r.body.rotation.y = Math.sin(t) * 0.05 * walk;
        r.body.position.y = Math.abs(Math.sin(t)) * 0.028 * walk - bre * 0.006;
        // arms: idle low ready -> aim
        const idleR = [-0.75, -0.9], idleL = [-0.95, 0.4, -1.05];
        r.armR.shoulder.rotation.x = U.lerp(idleR[0], -1.33, aim) + Math.sin(t) * 0.03 * walk;
        r.armR.elbow.rotation.x = U.lerp(idleR[1], -0.62, aim);
        r.armL.shoulder.rotation.x = U.lerp(idleL[0], -1.4, aim) + Math.sin(t) * 0.03 * walk;
        r.armL.shoulder.rotation.z = U.lerp(idleL[1], 0.5, aim);
        r.armL.elbow.rotation.x = U.lerp(idleL[2], -0.8, aim);
        r.head.rotation.x = U.lerp(0.10, 0.02, aim);
        if (this.alive && this.aimAmt > 0.1) {
          // recoil jolt
          r.body.rotation.x = -this.flashT * 0.6;
          r.gun.position.z = -0.12 + this.flashT * 0.4;
        } else {
          r.body.rotation.x = 0;
          if (r.gun) r.gun.position.z = -0.12;
        }
      } else if (this.kind === 'hostage') {
        // kneeling, hands on head, trembling
        const tremble = Math.sin(t * 3.1) * 0.012;
        r.pelvis.position.y = 0.52;
        r.legL.hip.rotation.x = -1.45; r.legL.knee.rotation.x = 1.6;
        r.legR.hip.rotation.x = -1.35; r.legR.knee.rotation.x = 1.55;
        r.armL.shoulder.rotation.x = -2.5 + tremble; r.armL.shoulder.rotation.z = -0.45;
        r.armR.shoulder.rotation.x = -2.5 - tremble; r.armR.shoulder.rotation.z = 0.45;
        r.armL.elbow.rotation.x = -1.7; r.armR.elbow.rotation.x = -1.7;
        r.body.rotation.x = 0.18 + tremble * 0.5;
        r.head.rotation.x = 0.22;
        r.head.rotation.y = Math.sin(t * 0.35) * 0.25;
        if (opts.freed) {
          r.pelvis.position.y = 0.92;
          r.legL.hip.rotation.x = 0; r.legL.knee.rotation.x = 0;
          r.legR.hip.rotation.x = 0; r.legR.knee.rotation.x = 0;
          r.armL.shoulder.rotation.x = 0.1; r.armL.shoulder.rotation.z = 0.14;
          r.armR.shoulder.rotation.x = 0.1; r.armR.shoulder.rotation.z = -0.14;
          r.armL.elbow.rotation.x = -0.3; r.armR.elbow.rotation.x = -0.3;
          r.body.rotation.x = 0; r.head.rotation.x = -0.05;
        }
      } else if (this.kind === 'boss') {
        if (opts.seated) {
          r.pelvis.position.y = 0.55;
          r.legL.hip.rotation.x = -1.5; r.legL.knee.rotation.x = 1.5;
          r.legR.hip.rotation.x = -1.5; r.legR.knee.rotation.x = 1.5;
          r.armL.shoulder.rotation.x = -0.55; r.armL.shoulder.rotation.z = -0.2;
          r.armR.shoulder.rotation.x = -0.55; r.armR.shoulder.rotation.z = 0.2;
          r.armL.elbow.rotation.x = -0.5; r.armR.elbow.rotation.x = -0.5;
          r.body.rotation.x = 0.06 + Math.sin(t * 0.5) * 0.012;
          r.head.rotation.x = 0.12;
        } else {
          const sw = Math.sin(t) * 0.5 * walk;
          r.pelvis.position.y = 0.92;
          r.legL.hip.rotation.x = sw; r.legR.hip.rotation.x = -sw;
          r.legL.knee.rotation.x = Math.max(0, -Math.cos(t) * 0.6) * walk;
          r.legR.knee.rotation.x = Math.max(0, Math.cos(t) * 0.6) * walk;
          r.armL.shoulder.rotation.x = -sw * 0.7; r.armR.shoulder.rotation.x = sw * 0.7;
          r.armL.elbow.rotation.x = -0.24; r.armR.elbow.rotation.x = -0.24;
          r.body.rotation.x = 0;
          r.head.rotation.x = -0.05;
        }
      }
      if (dt) this.sync(dt);
      // muzzle flash timer
      if (this.flashT > 0) {
        this.flashT -= dt;
        if (this.rig.flash) {
          this.rig.flash.visible = this.flashT > 0;
          this.rig.flashMat.opacity = U.clamp(this.flashT / 0.07, 0, 1);
          this.rig.flash.rotation.z += dt * 22;
        }
      } else if (this.rig.flash) {
        this.rig.flash.visible = false;
      }
    }

    muzzleWorld(out) {
      if (this.rig.muzzle) return this.rig.muzzle.getWorldPosition(out);
      return out.set(this.pos.x, 1.35, this.pos.z);
    }
  }

  /* ============================================================== robber */
  const IDLE = 0, ALERT = 1, COMBAT = 2, DEAD = 3;

  class Robber extends Character {
    constructor(scene, def) {
      super(scene, 'robber', def.x, def.z, def.ry);
      this.room = def.room;
      const D = global.GAME && global.GAME.diff ? global.GAME.diff : { enemyHp: 100 };
      this.maxHp = D.enemyHp || 100;
      this.hp = this.maxHp;
      this.state = IDLE;
      this.coverCd = U.rnd(1.2, 3.0);
      this.coverT = 0;
      this.coverPath = null;
      this.coverI = 0;
      this.flankCd = U.rnd(4, 8);
      this.flankT = 0;
      this.flankPath = null;
      this.flankI = 0;
      this.path = null;
      this.pathI = 0;
      this.repathT = 0;
      this.fireT = U.rnd(0.6, 1.6);
      this.burst = 0;
      this.aimAmt = 0.25;
      this.alertT = 0;
      this.lastSeen = new THREE.Vector3();
      this.strafeDir = Math.random() < 0.5 ? 1 : -1;
      this.strafeT = U.rnd(1, 2.4);
      this.searchT = 0;
      this.moving = false;
      this.spawnX = def.x; this.spawnZ = def.z;
      this.aimTargetYaw = def.ry;
      this.patrolT = U.rnd(1, 4);
      this.patrolTarget = null;
      this.damageFlash = 0;
      this.stepAcc = 0;
      this.name = '劫匪';
      this.losTimer = 0;
    }

    get eyeY() { return 1.62; }

    alertTo(x, z, combat) {
      if (this.state === DEAD) return;
      if (this.state === IDLE) {
        this.state = ALERT;
        this.alertT = 0;
        this.lastSeen.set(x, 0, z);
        this.path = null;
      } else if (combat && this.state !== COMBAT) {
        this.state = COMBAT;
        this.alertT = 0;
      }
      if (combat) this.lastSeen.set(x, 0, z);
    }

    hit(dmg, head) {
      if (this.state === DEAD) return false;
      this.hp -= dmg;
      this.damageFlash = 0.18;
      if (this.hp <= 0) {
        this.state = DEAD;
        this.deadT = 0;
        this.path = null;
        this.aimAmt = 0;
        SFX.bodyFall();
        return true;
      }
      // getting shot flips them straight to combat, aimed at the shooter
      this.state = COMBAT;
      this.alertT = 0;
      return false;
    }

    deadCollide() { return this.state !== DEAD; }

    think(dt, G) {
      if (this.state === DEAD) return;
      const p = G.player;
      const px = p.pos.x, pz = p.pos.z;
      const dx = px - this.pos.x, dz = pz - this.pos.z;
      const dist = Math.hypot(dx, dz);

      // vision
      this.losTimer -= dt;
      if (this.losTimer <= 0) {
        this.losTimer = 0.12 + Math.random() * 0.06;
        const eye = this.pos.y + this.eyeY;
        const peye = p.pos.y + (p.eyeY || 1.63);
        const canSee = dist < 30 && Phys.los(this.pos.x, eye, this.pos.z, px, peye, pz) &&
          (this.state !== IDLE || this.canFace(px, pz, 0.62));
        this.canSee = canSee;
      }
      this.canSee = this.canSee && dist < 30;

      if (this.canSee && p.alive) {
        if (this.state !== COMBAT) {
          this.state = COMBAT;
          this.alertT = 0;
          G.onSpotted(this);
        }
        this.lastSeen.set(px, 0, pz);
        this.searchT = 5.5;
      } else if (this.state === COMBAT) {
        this.searchT -= dt;
        if (this.searchT <= 0) { this.state = ALERT; this.alertT = 0; }
      }

      const speedBase = 2.5;
      this.moving = false;

      if (this.state === COMBAT) {
        const D = G.diff || { react: 0.35, fireMul: 1 };
        this.alertT += dt;
        this.aimAmt = U.damp(this.aimAmt, 1, 6, dt);
        this.ry = U.approachAngle(this.ry, Math.atan2(px - this.pos.x, pz - this.pos.z), 7, dt);

        this.coverCd -= dt;
        this.flankCd -= dt;

        // --- cover: when hurt, break line of sight and hold for a beat
        if (this.coverT <= 0 && this.coverCd <= 0 && this.hp < this.maxHp * 0.62) {
          const c = this.chooseCover(px, pz);
          if (c) {
            const path = LV.nav.path(this.pos.x, this.pos.z, c.x, c.z, 1600);
            if (path) {
              this.coverPath = path; this.coverI = 0;
              this.coverT = U.rnd(2.6, 4.4);
              this.coverCd = U.rnd(7, 11);
            }
          }
        }
        // --- flank: sidestep the player's cover once in a while
        const teamFree = !G.flankUntil || G.time > G.flankUntil;
        if (this.coverT <= 0 && this.flankT <= 0 && this.flankCd <= 0 && this.canSee && dist > 6 && teamFree) {
          const f = this.chooseFlank(px, pz);
          if (f) {
            const path = LV.nav.path(this.pos.x, this.pos.z, f.x, f.z, 1800);
            if (path) {
              this.flankPath = path; this.flankI = 0;
              this.flankT = U.rnd(2.0, 3.2);
              this.flankCd = U.rnd(8, 13);
              G.flankUntil = G.time + 4.2;   // only one flanker at a time: the rest suppress
            }
          }
        }

        if (this.coverT > 0) {
          this.coverT -= dt;
          this.followPathCustom(dt, 3.2, 'cover');
          if (this.coverT <= 0) { this.coverPath = null; this.repathT = 0; }
        } else if (this.flankT > 0) {
          this.flankT -= dt;
          this.followPathCustom(dt, 3.0, 'flank');
          if (this.flankT <= 0) { this.flankPath = null; this.repathT = 0; }
        } else {
          // keep a standoff distance; strafe now and then
          this.strafeT -= dt;
          if (this.strafeT <= 0) { this.strafeT = U.rnd(0.9, 2.2); this.strafeDir *= -1; }
          this.repathT -= dt;
          if (this.repathT <= 0) {
            this.repathT = 0.85 + Math.random() * 0.5;
            const want = dist > 15 ? 1 : (dist < 5.5 ? -1 : 0);
            let tx = px, tz = pz;
            if (want !== 0) {
              tx = this.pos.x + dx * 0.35 * want + (this.strafeDir * 3.4);
              tz = this.pos.z + dz * 0.35 * want + (this.strafeDir * 2.6);
              const n = LV.nav.nearestFree(tx, tz);
              tx = n.x; tz = n.z;
            } else {
              const a = Math.atan2(dz, dx) + Math.PI / 2 * this.strafeDir;
              tx = this.pos.x + Math.cos(a) * 2.6;
              tz = this.pos.z + Math.sin(a) * 2.6;
              const n = LV.nav.nearestFree(tx, tz);
              tx = n.x; tz = n.z;
            }
            this.path = LV.nav.path(this.pos.x, this.pos.z, tx, tz);
            this.pathI = 0;
          }
          this.followPath(dt, speedBase * 0.82);
        }
        // always face the player
        this.ry = U.approachAngle(this.ry, Math.atan2(px - this.pos.x, pz - this.pos.z), 6, dt);

        // shooting (cover still allows snap shots if the player comes around)
        this.fireT -= dt;
        if (this.fireT <= 0 && this.canSee && p.alive && this.alertT > D.react) {
          this.fire(G, dist);
          this.fireT = (this.burst > 0 ? U.rnd(0.12, 0.2) : U.rnd(1.15, 2.2)) * (D.fireMul || 1);
        }
      } else if (this.state === ALERT) {
        this.alertT += dt;
        this.aimAmt = U.damp(this.aimAmt, 0.55, 4, dt);
        const tx = this.lastSeen.x, tz = this.lastSeen.z;
        const d = Math.hypot(tx - this.pos.x, tz - this.pos.z);
        if (d > 1.6) {
          this.repathT -= dt;
          if (this.repathT <= 0) {
            this.repathT = 1.0;
            this.path = LV.nav.path(this.pos.x, this.pos.z, tx, tz, 1400);
            this.pathI = 0;
          }
          this.followPath(dt, 2.9);
        } else {
          // scan around
          this.ry += dt * 1.1 * Math.sin(this.alertT * 1.2 + this.phase);
        }
        this.ry = U.approachAngle(this.ry, Math.atan2(tx - this.pos.x, tz - this.pos.z), 3.2, dt);
        if (this.alertT > 9) { this.state = IDLE; this.aimAmt = 0.2; this.path = null; }
      } else {
        // idle patrol around the spawn post
        this.aimAmt = U.damp(this.aimAmt, 0.22, 3, dt);
        this.patrolT -= dt;
        if (this.patrolT <= 0) {
          this.patrolT = U.rnd(2.4, 5.5);
          const a = Math.random() * 6.283, r = U.rnd(0.6, 2.8);
          this.patrolTarget = LV.nav.nearestFree(this.spawnX + Math.cos(a) * r, this.spawnZ + Math.sin(a) * r);
          this.path = LV.nav.path(this.pos.x, this.pos.z, this.patrolTarget.x, this.patrolTarget.z, 700);
          this.pathI = 0;
        }
        if (this.path) this.followPath(dt, 1.35);
        if (this.path && this.pathI >= this.path.length) this.path = null;
        if (!this.moving) this.ry += Math.sin(this.phase * 0.4) * dt * 0.22;
      }

      this.walkAmt = U.damp(this.walkAmt, this.moving ? 1 : 0, 9, dt);
      if (this.moving) {
        this.stepAcc += dt * (this.state === COMBAT ? 1.6 : 1.1);
        if (this.stepAcc > 0.52) { this.stepAcc = 0; SFX.footstep(false, 'carpet'); }
      }
    }

    canFace(x, z, halfFovCos) {
      const dx = x - this.pos.x, dz = z - this.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      const fx = Math.sin(this.ry), fz = Math.cos(this.ry);
      return (dx / len) * fx + (dz / len) * fz > halfFovCos;
    }

    chooseCover(px, pz) {
      let best = null, bestScore = -1e9;
      for (const c of LV.colliders) {
        if (c.y1 < 1.0 || c.y0 > 1.6) continue;
        const cx = (c.x1 + c.x2) / 2, cz = (c.z1 + c.z2) / 2;
        const d0 = Math.hypot(cx - this.pos.x, cz - this.pos.z);
        if (d0 > 10 || d0 < 0.8) continue;
        const off = 1.05;
        const pts = [[c.x1 - off, cz], [c.x2 + off, cz], [cx, c.z1 - off], [cx, c.z2 + off]];
        for (let p of pts) {
          p = LV.nav.nearestFree(p[0], p[1]);
          const x = p.x, z = p.z;
          if (Phys.los(px, 1.45, pz, x, 1.0, z)) continue;
          const score = -Math.hypot(x - this.pos.x, z - this.pos.z) + Math.hypot(x - px, z - pz) * 0.22;
          if (score > bestScore) { bestScore = score; best = { x, z }; }
        }
      }
      return best;
    }

    chooseFlank(px, pz) {
      const a = Math.atan2(pz - this.pos.z, px - this.pos.x);
      const side = Math.random() < 0.5 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        const ang = a + side * (Math.PI / 2 + k * 0.22);
        const r = 6 + Math.random() * 3;
        const x = px + Math.cos(ang) * r, z = pz + Math.sin(ang) * r;
        if (LV.nav.free(x, z)) return { x, z };
      }
      return null;
    }

    followPathCustom(dt, speed, which) {
      const path = which === 'cover' ? this.coverPath : this.flankPath;
      const key = which === 'cover' ? 'coverI' : 'flankI';
      if (!path || this[key] >= path.length) return;
      const wp = path[this[key]];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.45) { this[key]++; return; }
      const s = Math.min(speed * dt, d);
      Phys.move(this.pos, (dx / (d || 1)) * s, (dz / (d || 1)) * s, this.radius);
      this.moving = true;
    }

    followPath(dt, speed) {
      if (!this.path || this.pathI >= this.path.length) return;
      const wp = this.path[this.pathI];
      const dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.45) {
        this.pathI++;
        if (this.pathI >= this.path.length) { this.path = null; return; }
      }
      const s = Math.min(speed * dt, d);
      const bx = this.pos.x;
      Phys.move(this.pos, (dx / (d || 1)) * s, (dz / (d || 1)) * s, this.radius);
      this.moving = Math.hypot(this.pos.x - bx, this.pos.z - this.pos.z) > 0.0005 || Math.abs(dz) > 0.01;
      this.moving = true;
    }

    fire(G, dist) {
      this.burst++;
      if (this.burst >= 3) this.burst = 0;
      this.flashT = 0.07;
      const p = G.player;
      const muzzle = new THREE.Vector3();
      this.muzzleWorld(muzzle);
      SFX.enemyShot(dist, U.clamp((this.pos.x - p.pos.x) / 20, -0.8, 0.8));
      // aim error: harder the further away and the faster the player moves
      const D = G.diff || { acc: 0.66, enemyDmg: 1 };
      const moving = Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 6);
      let acc = (D.acc || 0.66) - dist * 0.019 - moving * 0.26 - (this.aimAmt > 0.9 ? 0 : 0.15);
      if (p.crouch) acc -= 0.06;
      acc = U.clamp(acc, 0.06, 0.72);
      const hit = Math.random() < acc;
      const target = new THREE.Vector3(p.pos.x, p.pos.y + (hit ? U.rnd(1.1, 1.55) : U.rnd(0.4, 1.9)), p.pos.z);
      if (!hit) {
        target.x += U.rnd(-1.1, 1.1); target.z += U.rnd(-1.1, 1.1); target.y += U.rnd(-0.4, 0.7);
      }
      const dir = new THREE.Vector3().subVectors(target, muzzle).normalize();
      // tracer visual
      if (G.weapon) G.weapon.tracer(muzzle, target);
      // impact / rcochet near the player when missed
      if (!hit) {
        const w = Phys.rayWalls(muzzle, dir, 40);
        if (w) {
          G.weapon.impact(w.point, w.normal, Math.random() < 0.4);
          if (Math.random() < 0.35) SFX.ricochet(0);
        }
      }
      if (hit) {
        G.damagePlayer(U.rnd(4.5, 8) * (D.enemyDmg || 1), this.pos.x, this.pos.z);
      } else {
        G.suppress(this.pos.x, this.pos.z);
      }
      // AI recoil
      this.aimAmt = 0.55;
      this.recoilT = 0.12;
    }
  }

  /* ============================================================== exports */
  global.Phys = Phys;
  global.Robber = Robber;
  global.Character = Character;
  global.NPC = { buildRig: buildRig, Character: Character, Robber: Robber };
})(window);
