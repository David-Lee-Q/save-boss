/* weapon.js — viewmodel carbine, muzzle flash, tracers, impacts. */
(function (global) {
  'use strict';

  const W = {
    mag: 30, reserve: 210, rpm: 640, damage: 34, headMul: 2.6,
    spread: { hip: 0.016, ads: 0.0035, move: 0.012, air: 0.04 },
    recoil: { kick: 0.012, climb: 0.0055, side: 0.0032, recover: 9 },
    reloadTime: 1.85,
    adsFov: 52
  };
  const WP = W; // alias used below

  function box(w, h, d, mat, x, y, z, rx, ry, rz) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    return m;
  }
  function cylm(r, h, mat, x, y, z, rx, seg) {
    const g = new THREE.CylinderGeometry(r, r, h, seg || 12);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    if (rx) m.rotation.x = rx;
    return m;
  }

  class Weapon {
    constructor(scene, camera) {
      this.scene = scene;
      this.camera = camera;
      this.state = 'idle';        // idle | reloading
      this.cooldown = 0;
      this.reloadT = 0;
      this.ads = 0;               // 0..1
      this.adsWanted = false;
      this.swayX = 0; this.swayY = 0;
      this.recoilPos = new THREE.Vector3();
      this.recoilRot = new THREE.Vector3();
      this.spreadHeat = 0;
      this.shots = 0;
      this.hits = 0;
      this.kicks = [];
      this.build();
    }

    build() {
      const root = new THREE.Group();
      this.root = root;

      const matBody = new THREE.MeshStandardMaterial({ color: 0x2b3034, roughness: 0.5, metalness: 0.45 });
      const matDark = new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.62, metalness: 0.35 });
      const matPoly = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.85, metalness: 0.05 });
      const matSteel = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.28, metalness: 0.95 });
      const matTape = new THREE.MeshStandardMaterial({ color: 0xb8834a, roughness: 0.95, metalness: 0 });

      // receiver
      const g = new THREE.Group();
      g.add(box(0.075, 0.085, 0.30, matBody, 0, 0, -0.02));
      g.add(box(0.070, 0.030, 0.26, matSteel, 0, 0.055, -0.02));
      g.add(box(0.062, 0.058, 0.20, matDark, 0, 0.085, -0.05));      // cheek/rail housing
      // rail
      for (let i = 0; i < 9; i++) g.add(box(0.052, 0.008, 0.014, matSteel, 0, 0.117, -0.14 + i * 0.026));
      // handguard
      g.add(box(0.062, 0.062, 0.26, matPoly, 0, 0.005, -0.27));
      for (let i = 0; i < 7; i++) g.add(box(0.068, 0.010, 0.012, matDark, 0, 0.005, -0.18 - i * 0.034));
      // barrel + muzzle
      g.add(cylm(0.013, 0.16, matSteel, 0, 0.012, -0.40, Math.PI / 2, 10));
      g.add(cylm(0.019, 0.05, matDark, 0, 0.012, -0.475, Math.PI / 2, 12));
      // stock
      g.add(box(0.058, 0.075, 0.16, matPoly, 0, -0.005, 0.19));
      g.add(box(0.05, 0.10, 0.05, matDark, 0, 0.0, 0.27));
      // pistol grip
      g.add(box(0.045, 0.13, 0.06, matPoly, 0, -0.09, 0.055, -0.20));
      // magazine
      this.magMesh = box(0.042, 0.155, 0.075, matDark, 0, -0.115, -0.045, 0.06);
      g.add(this.magMesh);
      // trigger guard
      g.add(box(0.02, 0.008, 0.06, matDark, 0, -0.05, 0.02));
      // optic: housing + glass
      g.add(box(0.058, 0.052, 0.11, matDark, 0, 0.155, -0.04));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.044, 0.040), new THREE.MeshStandardMaterial({
        color: 0x2f6f74, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.45,
        emissive: 0x14363a, emissiveIntensity: 0.6
      }));
      glass.position.set(0, 0.157, -0.096);
      g.add(glass);
      const reticle = new THREE.Mesh(new THREE.PlaneGeometry(0.006, 0.006), new THREE.MeshBasicMaterial({ color: 0xff5a30, toneMapped: false }));
      reticle.position.set(0, 0.157, -0.0965);
      g.add(reticle);
      // handguard tape + sling loop
      g.add(box(0.066, 0.02, 0.05, matTape, 0, 0.035, -0.29));
      g.add(cylm(0.008, 0.02, matSteel, 0.038, 0.0, -0.32, Math.PI / 2, 6));
      // glove holding it
      const glove = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.95 });
      g.add(box(0.075, 0.075, 0.09, glove, 0.012, -0.075, -0.05, 0, 0, -0.1));
      g.add(box(0.06, 0.06, 0.10, glove, 0.01, -0.03, -0.24, 0.18));
      this.muzzle = new THREE.Object3D();
      this.muzzle.position.set(0, 0.012, -0.50);
      g.add(this.muzzle);

      g.position.set(0.145, -0.135, -0.30);
      g.rotation.set(0.015, 0.055, 0.0);
      root.add(g);
      this.gun = g;

      this.camera.add(root);
      this.scene.add(this.camera);

      // muzzle flash: two crossed additive planes + a light
      const flashMat = new THREE.MeshBasicMaterial({
        color: 0xffd6a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: true, side: THREE.DoubleSide
      });
      this.flash = new THREE.Group();
      const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), flashMat);
      const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.13), flashMat);
      p2.rotation.z = Math.PI / 2;
      const p3 = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), flashMat);
      p3.rotation.z = Math.PI / 4;
      this.flash.add(p1, p2, p3);
      this.flash.position.copy(this.muzzle.position);
      this.flash.visible = false;
      g.add(this.flash);
      this.flashMat = flashMat;

      this.flashLight = new THREE.PointLight(0xffb066, 0, 9, 2);
      this.flashLight.position.set(0.1, -0.1, -0.7);
      this.camera.add(this.flashLight);

      this.flashT = 0;

      // tracers
      this.tracers = [];
      const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: true });
      for (let i = 0; i < 8; i++) {
        const geo = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
        const m = new THREE.Mesh(geo, tracerMat.clone());
        m.visible = false;
        m.frustumCulled = false;
        this.scene.add(m);
        this.tracers.push({ mesh: m, t: 0, life: 0 });
      }
      // impact decals pool (bullet holes)
      this.holes = [];
      const holeTex = this.makeHoleTex();
      for (let i = 0; i < 40; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), new THREE.MeshBasicMaterial({
          map: holeTex, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: true
        }));
        m.visible = false;
        this.scene.add(m);
        this.holes.push(m);
      }
      this.holeIdx = 0;

      // spark burst pool
      this.sparks = [];
      const sg = new THREE.BufferGeometry();
      const N = 12, sp = new Float32Array(N * 3), sv = new Float32Array(N * 3);
      sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      this.sparkCount = N;
      for (let i = 0; i < 10; i++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
        const mat = new THREE.PointsMaterial({ color: 0xffc078, size: 0.035, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
        const pts = new THREE.Points(geo, mat);
        pts.visible = false;
        pts.frustumCulled = false;
        this.scene.add(pts);
        this.sparks.push({ pts: pts, vel: new Float32Array(36), t: 0, life: 0.36 });
      }
      this.sparkIdx = 0;
    }

    makeHoleTex() {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 30);
      g.addColorStop(0, 'rgba(6,5,4,.95)');
      g.addColorStop(0.35, 'rgba(10,9,8,.8)');
      g.addColorStop(0.62, 'rgba(30,28,26,.42)');
      g.addColorStop(1, 'rgba(40,38,34,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(32, 32, 31, 0, 6.283); x.fill();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    reset() {
      this.mag = WP.mag;
      this.reserve = WP.reserve;
      this.state = 'idle';
      this.reloadT = 0;
      this.cooldown = 0;
      this.ads = 0;
      this.shots = 0;
      this.hits = 0;
      this.spreadHeat = 0;
      this.recoilPos.set(0, 0, 0);
      this.recoilRot.set(0, 0, 0);
    }

    startReload() {
      if (this.state === 'reloading') return false;
      if (this.mag >= WP.mag || this.reserve <= 0) return false;
      this.state = 'reloading';
      this.reloadT = WP.reloadTime;
      SFX.reload();
      return true;
    }

    canFire() {
      return this.state !== 'reloading' && this.cooldown <= 0 && this.mag > 0;
    }

    /* returns shot descriptor or null */
    fire(now) {
      if (this.state === 'reloading') return null;
      if (this.mag <= 0) {
        if (this.cooldown <= 0) { SFX.dryFire(); this.cooldown = 0.28; }
        return null;
      }
      if (this.cooldown > 0) return null;
      this.mag--;
      this.shots++;
      this.cooldown = 60 / WP.rpm;
      this.spreadHeat = Math.min(1, this.spreadHeat + 0.16);
      // recoil
      this.recoilRot.x -= WP.recoil.climb * (1 + this.spreadHeat * 0.5);
      this.recoilRot.y += (Math.random() - 0.5) * WP.recoil.side;
      this.recoilPos.z += WP.recoil.kick * 1.6;
      this.flashT = 0.055;
      this.flash.visible = true;
      this.flash.rotation.z = Math.random() * 6.283;
      this.flash.scale.setScalar(0.75 + Math.random() * 0.6);
      this.flashLight.intensity = 16;
      SFX.shot(U.rnd(-0.15, 0.15));
      this.recoilRot.z += (Math.random() - 0.5) * 0.004;
      // brass
      return { spread: this.currentSpread() };
    }

    currentSpread() {
      const moving = this.moveAmount || 0;
      const air = this.airborne ? 1 : 0;
      const base = U.lerp(WP.spread.hip, WP.spread.ads, this.ads);
      return base + WP.spread.move * moving + WP.spread.air * air + this.spreadHeat * 0.020 * (1 - this.ads * 0.6);
    }

    update(dt, input) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      this.spreadHeat = Math.max(0, this.spreadHeat - dt * 1.5);

      // ADS blend
      this.adsWanted = !!input.ads && this.state !== 'reloading';
      const target = this.adsWanted ? 1 : 0;
      this.ads = U.damp(this.ads, target, 13, dt);

      // reload
      if (this.state === 'reloading') {
        this.reloadT -= dt;
        if (this.reloadT <= 0) {
          const need = WP.mag - this.mag;
          const take = Math.min(need, this.reserve);
          this.mag += take; this.reserve -= take;
          this.state = 'idle';
        }
      }

      // flash decay
      if (this.flashT > 0) {
        this.flashT -= dt;
        if (this.flashT <= 0) this.flash.visible = false;
      }
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 220);

      // recoil recovery
      const rec = WP.recoil.recover;
      this.recoilRot.multiplyScalar(Math.max(0, 1 - rec * dt));
      this.recoilPos.multiplyScalar(Math.max(0, 1 - rec * 1.4 * dt));

      // sway from look
      this.swayX = U.damp(this.swayX, U.clamp(-(input.lookDX || 0) * 0.9, -0.05, 0.05), 8, dt);
      this.swayY = U.damp(this.swayY, U.clamp((input.lookDY || 0) * 0.9, -0.05, 0.05), 8, dt);

      const bobSpeed = input.sprint ? 12 : 8;
      const bobAmt = (input.moving ? (input.sprint ? 0.011 : 0.007) : 0.0016) * (1 - this.ads * 0.75);
      this.bobT = (this.bobT || 0) + dt * bobSpeed;
      const bx = Math.sin(this.bobT) * bobAmt;
      const by = Math.abs(Math.cos(this.bobT)) * bobAmt;

      const hipPos = new THREE.Vector3(0.145, -0.135, -0.30);
      const adsPos = new THREE.Vector3(0.0, -0.052, -0.205);
      const p = hipPos.lerp(adsPos, this.ads);
      p.x += bx + this.swayX * (1 - this.ads * 0.8);
      p.y += by + this.swayY * (1 - this.ads * 0.8);
      // reload dip
      if (this.state === 'reloading') {
        const k = Math.sin(Math.min(1, (WP.reloadTime - this.reloadT) / WP.reloadTime) * Math.PI);
        p.y -= k * 0.10; p.z += k * 0.02;
        this.gun.rotation.z = k * 0.5;
      } else {
        this.gun.rotation.z = U.damp(this.gun.rotation.z, 0, 10, dt);
      }
      this.gun.position.copy(p).add(this.recoilPos);
      const hipRot = new THREE.Euler(0.015, 0.055, 0);
      this.gun.rotation.x = U.lerp(hipRot.x, 0, this.ads) + this.recoilRot.x + this.swayY * 0.8;
      this.gun.rotation.y = U.lerp(hipRot.y, 0, this.ads) + this.recoilRot.y + this.swayX * 0.8;
      this.gun.rotation.z += this.recoilRot.z;

      // magazine drop during reload
      this.magMesh.visible = !(this.state === 'reloading' && this.reloadT < WP.reloadTime * 0.55 && this.reloadT > WP.reloadTime * 0.18);

      // tracers
      for (const t of this.tracers) {
        if (t.life > 0) {
          t.life -= dt;
          const k = 1 - t.life / 0.07;
          t.mesh.material.opacity = Math.max(0, 0.85 * (1 - k));
          if (t.life <= 0) t.mesh.visible = false;
        }
      }
      // sparks
      for (const s of this.sparks) {
        if (s.life > 0) {
          s.t += dt;
          const pos = s.pts.geometry.attributes.position;
          for (let i = 0; i < 12; i++) {
            s.vel[i * 3 + 1] -= 9.8 * dt;
            pos.array[i * 3] += s.vel[i * 3] * dt;
            pos.array[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
            pos.array[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
          }
          pos.needsUpdate = true;
          s.pts.material.opacity = Math.max(0, 1 - s.t / s.life);
          if (s.t >= s.life) { s.life = 0; s.pts.visible = false; }
        }
      }
    }

    tracer(from, to) {
      const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      t.mesh.visible = true;
      t.mesh.position.copy(from).addScaledVector(dir, 0.5);
      t.mesh.scale.set(1, len, 1);
      t.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      t.mesh.material.opacity = 0.85;
      t.life = 0.07;
    }

    impact(point, normal, metal) {
      const h = this.holes[this.holeIdx++ % this.holes.length];
      h.visible = true;
      h.position.copy(point).addScaledVector(normal, 0.012);
      h.lookAt(point.clone().add(normal));
      h.rotation.z = Math.random() * 6.28;
      h.scale.setScalar(0.7 + Math.random() * 0.6);

      const s = this.sparks[this.sparkIdx++ % this.sparks.length];
      s.pts.visible = true;
      s.t = 0; s.life = metal ? 0.42 : 0.26;
      s.pts.material.color.setHex(metal ? 0xffd9a0 : 0x8a7f70);
      const pos = s.pts.geometry.attributes.position;
      for (let i = 0; i < 12; i++) {
        pos.array[i * 3] = point.x; pos.array[i * 3 + 1] = point.y; pos.array[i * 3 + 2] = point.z;
        const sp = metal ? 3.4 : 1.6;
        s.vel[i * 3] = (Math.random() - 0.5) * sp + normal.x * sp * 0.6;
        s.vel[i * 3 + 1] = (Math.random() - 0.2) * sp + normal.y * sp * 0.6;
        s.vel[i * 3 + 2] = (Math.random() - 0.5) * sp + normal.z * sp * 0.6;
      }
      pos.needsUpdate = true;
      s.pts.material.opacity = 1;
    }
  }

  WP.model = WP;
  global.Weapon = Weapon;
  global.WPN = WP;
})(window);
