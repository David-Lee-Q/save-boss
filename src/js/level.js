/* level.js — 42F office wing: shell, five rooms, lobby, furniture, lights, nav grid. */
(function (global) {
  'use strict';

  const H = 3.7;      // standard ceiling
  const HL = 5.2;     // lobby / reception volume
  const T = 0.24;     // partition thickness
  const PT = 0.42;    // perimeter thickness
  const DOOR = 2.45;

  const ROOM_DEFS = [
    { id: 'lobby', name: '前台大堂', en: 'RECEPTION', rect: { x1: -9, x2: 12.5, z1: 12.5, z2: 22 } },
    { id: 'open', name: '员工办公大厅', en: 'OPEN OFFICE', rect: { x1: -9, x2: 9, z1: -9, z2: 9 } },
    { id: 'meet', name: '会议室', en: 'BOARDROOM', rect: { x1: -12.5, x2: 12.5, z1: -22, z2: -12.5 } },
    { id: 'ceo', name: 'CEO 办公室', en: 'CHIEF EXECUTIVE', rect: { x1: 12.5, x2: 26, z1: -9, z2: 9 } },
    { id: 'cfo', name: 'CFO 办公室', en: 'FINANCE', rect: { x1: -26, x2: -12.5, z1: -9, z2: 9 } },
    { id: 'pantry', name: '茶水间', en: 'PANTRY', rect: { x1: -26, x2: -9, z1: 12.5, z2: 22 } }
  ];

  const LV = {
    H, HL, ROOM_DEFS,
    rooms: [], colliders: [], spawn: { x: 0.4, z: 19.0, yaw: 0 },
    actors: { robbers: [], hostages: [], boss: null },
    pickups: [], interactables: []
  };

  /* ============================================================== batcher */
  const Batch = (function () {
    function merge(list) {
      let vc = 0, ic = 0;
      for (const g of list) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
      const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
      const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
      let vo = 0, io = 0;
      for (const g of list) {
        const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array;
        pos.set(p, vo * 3); nor.set(n, vo * 3); uv.set(u, vo * 2);
        if (g.index) {
          const gi = g.index.array;
          for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
          io += gi.length;
        } else {
          for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = i + vo;
          io += g.attributes.position.count;
        }
        vo += g.attributes.position.count;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.setIndex(new THREE.BufferAttribute(idx, 1));
      out.computeBoundingSphere();
      return out;
    }

    class B {
      constructor() { this.groups = new Map(); }
      add(key, geo) {
        let g = this.groups.get(key);
        if (!g) { g = []; this.groups.set(key, g); }
        g.push(geo);
      }
      finish(scene, registry) {
        const made = [];
        for (const [key, list] of this.groups) {
          const r = registry[key];
          if (!r) { console.warn('no material', key); continue; }
          const mesh = new THREE.Mesh(merge(list), r.mat);
          mesh.castShadow = r.shadow !== false;
          mesh.receiveShadow = r.receive !== false;
          mesh.frustumCulled = false;
          mesh.name = 'batch:' + key;
          scene.add(mesh);
          made.push(mesh);
        }
        this.groups.clear();
        return made;
      }
    }
    return B;
  })();

  /* per-face UV scaling so nothing stretches */
  const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
  const BOX_UV = UNIT_BOX.attributes.uv.array.slice();

  function boxGeo(w, h, d, tile) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (tile) {
      const uv = g.attributes.uv;
      const a = uv.array;
      // faces: px nx py ny pz nz  (4 verts each)
      const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) {
        const sx = sizes[f][0] / tile, sy = sizes[f][1] / tile;
        for (let v = 0; v < 4; v++) {
          const i = (f * 4 + v) * 2;
          a[i] *= sx; a[i + 1] *= sy;
        }
      }
      uv.needsUpdate = true;
    }
    return g;
  }

  /* ============================================================== materials */
  function makeMaterials(scene, env) {
    const R = {};
    const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ envMapIntensity: 0.7 }, o));

    const carpet = TEX.carpet([36, 42, 56]);
    const carpetWarm = TEX.carpet([44, 38, 34]);
    R.carpet = { mat: std({ map: carpet, roughness: 0.95, metalness: 0.0, color: 0xffffff }), tile: 2.2 };
    R.carpetWarm = { mat: std({ map: carpetWarm, roughness: 0.95 }), tile: 2.0 };
    R.marble = { mat: std({ map: TEX.marble([210, 206, 196]), roughness: 0.22, metalness: 0.05, envMapIntensity: 1.0 }), tile: 1.9 };
    R.marbleDark = { mat: std({ map: TEX.marble([84, 84, 86], [30, 30, 32]), roughness: 0.25, metalness: 0.1 }), tile: 1.9 };
    R.plaster = { mat: std({ map: TEX.plaster([200, 197, 189]), roughness: 0.92 }), tile: 3.0 };
    R.plasterDark = { mat: std({ map: TEX.plaster([78, 82, 86]), roughness: 0.9 }), tile: 3.0 };
    R.ceil = { mat: std({ map: TEX.ceiling(), roughness: 0.94, color: 0xdfdbd2 }), tile: 0.62 };
    R.wood = { mat: std({ map: TEX.wood(false), roughness: 0.55, metalness: 0.02 }), tile: 1.4 };
    R.woodDark = { mat: std({ map: TEX.wood(true), roughness: 0.45 }), tile: 1.5 };
    R.metal = { mat: std({ map: TEX.metal([150, 152, 154]), roughness: 0.42, metalness: 0.82 }), tile: 1.0 };
    R.metalDark = { mat: std({ map: TEX.metal([62, 66, 70]), roughness: 0.5, metalness: 0.7 }), tile: 1.0 };
    R.chrome = { mat: std({ color: 0xc7ccd2, roughness: 0.18, metalness: 1.0, envMapIntensity: 1.3 }), tile: 1 };
    R.white = { mat: std({ color: 0xe4e1d8, roughness: 0.62 }), tile: 1 };
    R.dark = { mat: std({ color: 0x1b2024, roughness: 0.7 }), tile: 1 };
    R.paper = { mat: std({ map: TEX.paper(), roughness: 0.92 }), tile: 0.4 };
    R.stone = { mat: std({ map: TEX.concrete([104, 106, 106]), roughness: 0.66 }), tile: 1.6 };
    R.concrete = { mat: std({ map: TEX.concrete([74, 76, 78]), roughness: 0.94 }), tile: 2.0 };
    R.fabric = { mat: std({ map: TEX.fabric([52, 56, 64]), roughness: 0.98 }), tile: 0.7 };
    R.fabricWarm = { mat: std({ map: TEX.fabric([74, 58, 46]), roughness: 0.98 }), tile: 0.7 };
    R.glass = {
      mat: new THREE.MeshStandardMaterial({
        color: 0xa9c4d4, metalness: 0.0, roughness: 0.06, transparent: true, opacity: 0.17,
        envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false
      }),
      tile: 1, shadow: false
    };
    R.glassDark = {
      mat: new THREE.MeshStandardMaterial({
        color: 0x1a252c, metalness: 0.1, roughness: 0.08, transparent: true, opacity: 0.55,
        envMapIntensity: 1.2, side: THREE.DoubleSide
      }),
      tile: 1, shadow: false
    };
    R.light = {
      mat: new THREE.MeshStandardMaterial({ color: 0xfff0d8, emissive: 0xffd9a3, emissiveIntensity: 3.2, roughness: 1, toneMapped: true }),
      tile: 1, shadow: false, receive: false
    };
    R.lightCool = {
      mat: new THREE.MeshStandardMaterial({ color: 0xdff0ff, emissive: 0x9fd4ff, emissiveIntensity: 2.2, roughness: 1 }),
      tile: 1, shadow: false, receive: false
    };
    R.screen = { mat: std({ color: 0x0d1418, emissive: 0x223300, emissiveIntensity: 0.0, roughness: 0.4 }), tile: 1 };
    R.exitSign = {
      mat: new THREE.MeshStandardMaterial({ color: 0x0b2a1c, emissive: 0x3bff8a, emissiveIntensity: 2.4, roughness: 1 }),
      tile: 1, shadow: false
    };
    R.alarm = {
      mat: new THREE.MeshStandardMaterial({ color: 0x2a0a06, emissive: 0xff3a20, emissiveIntensity: 1.6, roughness: 1 }),
      tile: 1, shadow: false
    };
    for (const k in R) if (R[k].mat && env) R[k].mat.envMap = env;
    return R;
  }

  /* ============================================================== build */
  LV.build = function (scene, renderer, env) {
    const R = makeMaterials(scene, env);
    const B = new Batch();
    const cols = LV.colliders;

    scene.fog = new THREE.FogExp2(0x0b1116, 0.0075);

    /* ---------- helpers ---------- */
    function collider(x1, z1, x2, z2, y0, y1) {
      cols.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), z1: Math.min(z1, z2), z2: Math.max(z1, z2), y0: y0 || 0, y1: y1 == null ? H : y1 });
    }
    function bx(key, w, h, d, x, y, z, ry) {
      const g = boxGeo(w, h, d, R[key] && R[key].tile);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      B.add(key, g);
    }
    function pl(key, w, d, x, y, z, rx, ry) {
      const g = new THREE.PlaneGeometry(w, d);
      if (R[key] && R[key].tile) {
        const uv = g.attributes.uv.array;
        for (let i = 0; i < uv.length; i += 2) { uv[i] *= w / R[key].tile; uv[i + 1] *= d / R[key].tile; }
      }
      if (rx) g.rotateX(rx);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      B.add(key, g);
    }
    function cyl(key, r, h, x, y, z, seg) {
      const g = new THREE.CylinderGeometry(r, r, h, seg || 12, 1, false);
      g.translate(x, y, z);
      B.add(key, g);
    }
    function boxC(key, w, h, d, x, y, z, ry) { bx(key, w, h, d, x, y, z, ry); collider(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y - h / 2, y + h / 2); }

    /* wall run along X at z, with door holes */
    function runX(z, x1, x2, holes, opt) {
      opt = opt || {};
      const t = opt.t || T, h = opt.h || H, mat = opt.mat || 'plaster';
      const list = (holes || []).slice().sort((a, b) => a[0] - b[0]);
      let cur = x1;
      for (const [a, b] of list) {
        if (a > cur + 0.001) {
          bx(mat, a - cur, h, t, (cur + a) / 2, h / 2, z);
          bx('woodDark', a - cur, 0.09, t + 0.03, (cur + a) / 2, 0.045, z);
          collider(cur, z - t / 2, a, z + t / 2);
        }
        // header over the opening + jambs
        bx(mat, b - a, h - DOOR, t, (a + b) / 2, DOOR + (h - DOOR) / 2, z);
        bx('metalDark', 0.07, DOOR, t + 0.03, a + 0.035, DOOR / 2, z);
        bx('metalDark', 0.07, DOOR, t + 0.03, b - 0.035, DOOR / 2, z);
        cur = b;
      }
      if (x2 > cur + 0.001) {
        bx(mat, x2 - cur, h, t, (cur + x2) / 2, h / 2, z);
        bx('woodDark', x2 - cur, 0.09, t + 0.03, (cur + x2) / 2, 0.045, z);
        collider(cur, z - t / 2, x2, z + t / 2);
      }
    }
    /* wall run along Z at x */
    function runZ(x, z1, z2, holes, opt) {
      opt = opt || {};
      const t = opt.t || T, h = opt.h || H, mat = opt.mat || 'plaster';
      const list = (holes || []).slice().sort((a, b) => a[0] - b[0]);
      let cur = z1;
      for (const [a, b] of list) {
        if (a > cur + 0.001) {
          bx(mat, t, h, a - cur, x, h / 2, (cur + a) / 2);
          bx('woodDark', t + 0.03, 0.09, a - cur, x, 0.045, (cur + a) / 2);
          collider(x - t / 2, cur, x + t / 2, a);
        }
        bx(mat, t, h - DOOR, b - a, x, DOOR + (h - DOOR) / 2, (a + b) / 2);
        bx('metalDark', t + 0.03, DOOR, 0.07, x, DOOR / 2, a + 0.035);
        bx('metalDark', t + 0.03, DOOR, 0.07, x, DOOR / 2, b - 0.035);
        cur = b;
      }
      if (z2 > cur + 0.001) {
        bx(mat, t, h, z2 - cur, x, h / 2, (cur + z2) / 2);
        bx('woodDark', t + 0.03, 0.09, z2 - cur, x, 0.045, (cur + z2) / 2);
        collider(x - t / 2, cur, x + t / 2, z2);
      }
    }
    /* glass partition: frame + pane, solid to walk into */
    function glassX(x, z1, z2, h) {
      h = h || H;
      const d = z2 - z1;
      bx('glass', 0.04, h - 0.1, d - 0.06, x, h / 2, (z1 + z2) / 2);
      bx('metalDark', 0.1, 0.1, d, x, 0.05, (z1 + z2) / 2);
      bx('metalDark', 0.1, 0.1, d, x, h - 0.05, (z1 + z2) / 2);
      bx('metalDark', 0.09, h, 0.09, x, h / 2, z1 + 0.04);
      bx('metalDark', 0.09, h, 0.09, x, h / 2, z2 - 0.04);
      collider(x - 0.06, z1, x + 0.06, z2);
    }
    function glassZ(z, x1, x2, h) {
      h = h || H;
      const w = x2 - x1;
      bx('glass', w - 0.06, h - 0.1, 0.04, (x1 + x2) / 2, h / 2, z);
      bx('metalDark', w, 0.1, 0.1, (x1 + x2) / 2, 0.05, z);
      bx('metalDark', w, 0.1, 0.1, (x1 + x2) / 2, h - 0.05, z);
      bx('metalDark', 0.09, h, 0.09, x1 + 0.04, h / 2, z);
      bx('metalDark', 0.09, h, 0.09, x2 - 0.04, h / 2, z);
      collider(x1, z - 0.06, x2, z + 0.06);
    }

    /* curtain wall: sill, glass, spandrel, mullions */
    function curtain(axis, fixed, a1, a2, h) {
      const len = a2 - a1;
      const steps = Math.max(1, Math.round(len / 3.1));
      for (let i = 0; i < steps; i++) {
        const s = a1 + (len / steps) * i, e = a1 + (len / steps) * (i + 1);
        if (axis === 'x') {
          bx('stone', e - s, 0.14, 0.3, (s + e) / 2, 0.07, fixed);
          bx('glass', e - s - 0.14, h - 0.55, 0.05, (s + e) / 2, (0.14 + h - 0.4) / 2, fixed);
          bx('metalDark', e - s, 0.22, 0.26, (s + e) / 2, h - 0.4, fixed);
          bx('metalDark', 0.1, h, 0.28, s + 0.05, h / 2, fixed);
        } else {
          bx('stone', 0.3, 0.14, e - s, fixed, 0.07, (s + e) / 2);
          bx('glass', 0.05, h - 0.55, e - s - 0.14, fixed, (0.14 + h - 0.4) / 2, (s + e) / 2);
          bx('metalDark', 0.26, 0.22, e - s, fixed, h - 0.4, (s + e) / 2);
          bx('metalDark', 0.28, h, 0.1, fixed, h / 2, s + 0.05);
        }
      }
      if (axis === 'x') collider(a1, fixed - 0.2, a2, fixed + 0.2);
      else collider(fixed - 0.2, a1, fixed + 0.2, a2);
    }

    /* ============================================ floors & ceilings */
    function floorRect(rect, key) {
      const w = rect.x2 - rect.x1, d = rect.z2 - rect.z1;
      pl(key, w, d, (rect.x1 + rect.x2) / 2, 0.001, (rect.z1 + rect.z2) / 2, -Math.PI / 2, 0);
    }
    function ceilRect(rect, key, y) {
      const w = rect.x2 - rect.x1, d = rect.z2 - rect.z1;
      pl(key, w, d, (rect.x1 + rect.x2) / 2, y, (rect.z1 + rect.z2) / 2, Math.PI / 2, 0);
    }

    // base slab under everything (so no holes show at doorways)
    pl('concrete', 54, 46, 0, -0.02, 0, -Math.PI / 2, 0);

    floorRect({ x1: -26, x2: 26, z1: -22, z2: -12.5 }, 'carpet');       // north band base
    floorRect({ x1: -26, x2: 26, z1: -12.5, z2: 12.5 }, 'carpet');
    floorRect({ x1: -26, x2: 26, z1: 12.5, z2: 22 }, 'carpet');

    // specific floors
    floorRect({ x1: -9, x2: 12.5, z1: 12.5, z2: 22 }, 'marble');          // lobby
    floorRect({ x1: -26, x2: -9, z1: 12.5, z2: 22 }, 'stone');            // pantry
    floorRect({ x1: -12.5, x2: 12.5, z1: -22, z2: -12.5 }, 'carpetWarm'); // meeting
    floorRect({ x1: 12.5, x2: 26, z1: -9, z2: 9 }, 'wood');               // ceo
    floorRect({ x1: -26, x2: -12.5, z1: -9, z2: 9 }, 'wood');             // cfo

    // ceilings
    ceilRect({ x1: -26, x2: 26, z1: -22, z2: -12.5 }, 'ceil', H);
    ceilRect({ x1: -26, x2: 26, z1: -12.5, z2: 12.5 }, 'ceil', H);
    ceilRect({ x1: -26, x2: -9, z1: 12.5, z2: 22 }, 'ceil', H);
    ceilRect({ x1: 12.5, x2: 26, z1: 12.5, z2: 22 }, 'ceil', H);
    ceilRect({ x1: -9, x2: 12.5, z1: 12.5, z2: 22 }, 'concrete', HL);      // lobby void
    // lobby feature: slatted baffle + skylight glow
    for (let i = 0; i < 22; i++) {
      bx('woodDark', 0.14, 0.34, 8.6, -8.4 + i * 0.98, HL - 0.75, 17.4);
    }
    bx('light', 20.6, 0.06, 0.5, 2.0, HL - 0.5, 17.4);
    bx('light', 20.6, 0.06, 0.5, 2.0, HL - 0.5, 14.0);
    // open-office exposed slab + ducts
    ceilRect({ x1: -9, x2: 9, z1: -9, z2: 9 }, 'concrete', H);

    /* ============================================ perimeter */
    // south: solid elevator core at the lobby, glass elsewhere
    curtain('x', 22, -26, -9, H);
    curtain('x', 22, 12.5, 26, H);
    // north glass (meeting room + plant rooms)
    curtain('x', -22, -26, 26, H);
    // east / west glass
    curtain('z', 26, -22, 22, H);
    curtain('z', -26, -22, 22, H);

    // solid stone core behind the reception (south wall of lobby)
    bx('marbleDark', 21.5, HL, PT, 1.75, HL / 2, 22 - PT / 2);
    collider(-9, 22 - PT, 12.5, 22);
    bx('marbleDark', 21.5, HL, 0.3, 1.75, HL / 2, 22 - PT - 0.16);
    // elevator doors
    for (let i = 0; i < 3; i++) {
      const ex = -3.2 + i * 5.2;
      bx('metal', 2.1, 2.4, 0.1, ex, 1.2, 21.42);
      bx('chrome', 2.3, 2.6, 0.06, ex, 1.3, 21.48);
      bx('metal', 2.1, 2.4, 0.06, ex, 1.2, 21.4);
      bx('alarm', 0.16, 0.16, 0.06, ex, 2.78, 21.42);
      bx('metalDark', 0.06, 2.4, 0.12, ex, 1.2, 21.44);
    }
    // elevator call panel + floor indicator
    bx('metal', 0.24, 1.2, 0.08, 8.7, 1.35, 21.44);

    // lobby partitions
    runX(12.5, -9, 12.5, [[-7.4, -3.4]], { h: HL });
    runZ(-9, 12.5, 22, [], { h: HL });
    glassZ(12.5, 12.5, 26);      // phone booths (sealed)
    glassX(12.5, 12.5, 22);

    /* ============================================ interior partitions */
    // core (open office) walls with four openings
    runX(-9, -9, 9, [[-2.4, 2.4]]);
    runX(9, -9, 9, [[2.6, 6.6]]);
    runZ(-9, -9, 9, [[-1.8, 1.8]]);
    runZ(9, -9, 9, [[-1.8, 1.8]]);

    // meeting room south wall
    runX(-12.5, -12.5, 12.5, [[-1.4, 1.4]]);
    runZ(-12.5, -22, -12.5, []);
    runZ(12.5, -22, -12.5, []);
    // plant rooms beyond
    runX(-12.5, -26, -12.5, []);
    runX(-12.5, 12.5, 26, []);

    // CEO / CFO walls
    runZ(12.5, -9, 9, [[3.4, 5.6]]);
    runZ(-12.5, -9, 9, [[3.4, 5.6]]);
    runX(-9, 12.5, 26, []);
    runX(9, 12.5, 26, []);
    runX(-9, -26, -12.5, []);
    runX(9, -26, -12.5, []);

    // pantry north wall + door
    runX(12.5, -26, -9, [[-14.6, -11.9]]);
    // phone-booth north wall (glass)
    glassZ(12.5, 12.5, 26);

    /* ============================================ ceiling lights */
    function stripX(x1, x2, z, y) {
      bx('light', Math.abs(x2 - x1), 0.07, 0.16, (x1 + x2) / 2, y == null ? H - 0.07 : y, z);
    }
    function stripZ(x, z1, z2, y) {
      bx('light', 0.16, 0.07, Math.abs(z2 - z1), x, y == null ? H - 0.07 : y, (z1 + z2) / 2);
    }
    // open office: 4 long runs
    for (let i = 0; i < 4; i++) {
      const z = -6.4 + i * 4.3;
      stripX(-7.4, 7.4, z, H - 0.09);
      bx('metalDark', 15.4, 0.12, 0.42, 0, H - 0.16, z);
    }
    // corridors
    stripX(-11.6, 11.6, -10.7, H - 0.07);
    stripX(-11.6, 11.6, 10.7, H - 0.07);
    stripZ(10.7, -12.2, 12.2, H - 0.07);
    stripZ(-10.7, -12.2, 12.2, H - 0.07);
    // meeting
    for (let i = 0; i < 3; i++) bx('light', 8.6, 0.06, 0.18, 0, H - 0.08, -18.6 + i * 4.6);
    // ceo / cfo downlights
    for (let x = 15; x <= 24; x += 3) for (let z = -6; z <= 6; z += 4) {
      bx('lightCool', 0.34, 0.05, 0.34, x, H - 0.05, z);
      bx('lightCool', 0.34, 0.05, 0.34, -x, H - 0.05, z);
    }
    // pantry
    for (let i = 0; i < 3; i++) stripX(-24.5, -10.5, 14.4 + i * 3.1, H - 0.07);

    /* ============================================ reception dressing */
    // backlit logo wall
    bx('marbleDark', 0.16, 2.4, 7.2, 0.2, 2.1, 17.2);
    bx('light', 0.06, 0.44, 6.0, 0.3, 3.45, 17.2);
    const logo = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 1.6),
      new THREE.MeshBasicMaterial({ map: TEX.sign('几猫中心', 'JIMAO TOWER · 42F', { dark: true, plain: true }), transparent: true, toneMapped: false })
    );
    logo.position.set(0.32, 2.5, 17.2); logo.rotation.y = Math.PI / 2;
    scene.add(logo);
    // reception counter
    boxC('marbleDark', 0.9, 1.08, 6.2, 3.4, 0.54, 17.6);
    bx('marble', 1.1, 0.1, 6.4, 3.4, 1.13, 17.6);
    bx('woodDark', 0.5, 0.8, 5.8, 3.85, 0.42, 17.6);
    // brand mark on the front of the desk
    const dm = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.52),
      new THREE.MeshBasicMaterial({ map: TEX.plate('几猫', 'JIMAO'), transparent: true, toneMapped: false }));
    dm.position.set(2.94, 0.62, 17.6); dm.rotation.y = -Math.PI / 2;
    scene.add(dm);

    /* ============================================ signs above doors */
    function doorSign(x, z, ry, title, sub) {
      const g = new THREE.PlaneGeometry(2.5, 1.04);
      const m = new THREE.MeshBasicMaterial({ map: TEX.sign(title, sub), toneMapped: false });
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, 3.05, z); mesh.rotation.y = ry;
      scene.add(mesh);
      const frame = boxGeo(2.66, 1.2, 0.06, 0);
      frame.rotateY(ry); frame.translate(x, 3.05, z + (ry === 0 ? -0.03 : 0.03));
      B.add('metalDark', frame);
    }
    doorSign(0, -12.35, 0, '会议室', 'BOARDROOM · 42F');
    doorSign(12.36, 4.5, -Math.PI / 2, 'CEO 办公室', 'CHIEF EXECUTIVE');
    doorSign(-12.36, 4.5, Math.PI / 2, 'CFO 办公室', 'FINANCE');
    doorSign(-13.3, 12.36, Math.PI, '茶水间', 'PANTRY');
    doorSign(-5.4, 12.36, Math.PI, '员工办公大厅', 'OPEN OFFICE');
    doorSign(2.0, 12.36, Math.PI, '42F · 大堂', 'RECEPTION');

    /* ============================================ props */
    function bench(x, z) {
      bx('fabric', 2.0, 0.12, 0.52, x, 0.46, z);
      bx('metalDark', 0.08, 0.44, 0.5, x - 0.86, 0.22, z);
      bx('metalDark', 0.08, 0.44, 0.5, x + 0.86, 0.22, z);
      contact(x, z, 2.4, 0.9);
      collider(x - 1.0, z - 0.3, x + 1.0, z + 0.3, 0, 0.5);
    }
    function contact(x, z, sx, sz, y) {
      const key = 'contact';
      if (!contactTex) return;
      const g = new THREE.PlaneGeometry(sx, sz);
      g.rotateX(-Math.PI / 2);
      g.translate(x, (y == null ? 0.012 : y), z);
      B.add(key, g);
    }
    const contactTex = (function () {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      return t;
    })();
    R.contact = {
      mat: new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false,
        map: contactTex, alphaMap: contactTex, blending: THREE.NormalBlending
      }),
      tile: 1, shadow: false, receive: false
    };

    function desk(x, z, ry, w, d) {
      w = w || 1.8; d = d || 0.8;
      const c = Math.cos(ry), s = Math.sin(ry);
      bx('wood', w, 0.06, d, x, 0.74, z, ry);
      bx('metalDark', 0.06, 0.72, d - 0.1, x - c * (w / 2 - 0.12), 0.36, z + s * (w / 2 - 0.12), ry);
      bx('metalDark', 0.06, 0.72, d - 0.1, x + c * (w / 2 - 0.12), 0.36, z - s * (w / 2 - 0.12), ry);
      bx('metalDark', w - 0.3, 0.1, 0.05, x, 0.42, z + s * (d / 2 - 0.1), ry);
      // monitor
      const mx = x - s * 0.16, mz = z - c * 0.16;
      bx('dark', 0.5, 0.31, 0.04, mx, 1.06, mz, ry);
      const sg = new THREE.PlaneGeometry(0.46, 0.27);
      sg.rotateY(ry); sg.translate(mx + s * 0.03, 1.06, mz + c * 0.03);
      B.add('screen', sg);
      bx('metalDark', 0.06, 0.2, 0.06, mx, 0.86, mz, ry);
      bx('metalDark', 0.24, 0.02, 0.16, mx, 0.77, mz, ry);
      // keyboard + clutter
      bx('dark', 0.42, 0.03, 0.14, x + s * 0.1, 0.785, z + c * 0.1, ry);
      bx('white', 0.09, 0.1, 0.09, x + c * 0.55 + s * 0.1, 0.82, z - s * 0.55 + c * 0.1, ry);
      bx('white', 0.21, 0.012, 0.29, x - c * 0.5, 0.777, z + s * 0.5, ry + 0.3);
      contact(x, z, w + 0.5, d + 1.0);
      collider(x - w / 2 - 0.02, z - d / 2 - 0.02, x + w / 2 + 0.02, z + d / 2 + 0.02, 0, 0.78);
    }

    function chair(x, z, ry, kind) {
      const seat = kind === 'exec' ? 0.52 : 0.46;
      bx('fabric', seat, 0.11, seat, x, 0.47, z, ry);
      bx('fabric', seat, 0.52, 0.12, x - Math.sin(ry) * (seat / 2 - 0.03), 0.75, z - Math.cos(ry) * (seat / 2 - 0.03), ry);
      if (kind === 'exec') {
        bx('fabric', 0.1, 0.34, seat * 0.8, x + Math.cos(ry) * (seat / 2 - 0.03), 0.7, z - Math.sin(ry) * (seat / 2 - 0.03), ry);
        cyl('metalDark', 0.05, 0.34, x, 0.24, z, 8);
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.4;
          bx('metalDark', 0.32, 0.05, 0.05, x + Math.cos(a) * 0.16, 0.06, z + Math.sin(a) * 0.16, -a);
        }
      } else {
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const lx = x + Math.cos(ry) * dx * (seat / 2 - 0.06) - Math.sin(ry) * dz * (seat / 2 - 0.06);
          const lz = z - Math.sin(ry) * dx * (seat / 2 - 0.06) - Math.cos(ry) * dz * (seat / 2 - 0.06);
          bx('metalDark', 0.035, 0.42, 0.035, lx, 0.21, lz, 0);
        }
      }
      contact(x, z, 0.9, 0.9);
    }

    function plant(x, z, scale) {
      scale = scale || 1;
      cyl('dark', 0.34 * scale, 0.62 * scale, x, 0.31 * scale, z, 14);
      cyl('metalDark', 0.36 * scale, 0.06, x, 0.62 * scale, z, 14);
      const rng = U.rng((x * 91 + z * 37) | 0);
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2, r = rng() * 0.42 * scale;
        const hh = (0.5 + rng() * 1.15) * scale;
        const g = new THREE.BoxGeometry(0.14 * scale, hh, 0.03);
        g.rotateZ((rng() - 0.5) * 0.9);
        g.rotateY(a);
        g.translate(x + Math.cos(a) * r, 0.62 * scale + hh * 0.45, z + Math.sin(a) * r);
        B.add('fabric', g);
      }
      contact(x, z, 1.2 * scale, 1.2 * scale);
      collider(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 0, 1.4);
    }

    function cabinet(x, z, ry, w, h, d) {
      w = w || 1.0; h = h || 1.5; d = d || 0.44;
      bx('woodDark', w, h, d, x, h / 2, z, ry);
      bx('metalDark', w * 0.9, 0.02, d + 0.02, x, h * 0.66, z, ry);
      bx('metalDark', w * 0.9, 0.02, d + 0.02, x, h * 0.33, z, ry);
      bx('chrome', 0.16, 0.02, 0.03, x, h * 0.5, z + Math.cos(ry) * (d / 2 + 0.02), ry);
      contact(x, z, w + 0.4, d + 0.5);
      collider(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, h);
    }

    function sofa(x, z, ry, len) {
      len = len || 2.2;
      bx('fabricWarm', len, 0.4, 0.92, x, 0.24, z, ry);
      bx('fabricWarm', len, 0.52, 0.22, x - Math.sin(ry) * 0.36, 0.62, z - Math.cos(ry) * 0.36, ry);
      bx('fabricWarm', 0.2, 0.3, 0.92, x + Math.cos(ry) * (len / 2 - 0.1), 0.54, z - Math.sin(ry) * (len / 2 - 0.1), ry);
      bx('fabricWarm', 0.2, 0.3, 0.92, x - Math.cos(ry) * (len / 2 - 0.1), 0.54, z + Math.sin(ry) * (len / 2 - 0.1), ry);
      for (let i = 0; i < 2; i++) bx('fabricWarm', 0.12, 0.34, 0.3, x + Math.cos(ry) * (i ? 0.6 : -0.6), 0.62, z - Math.sin(ry) * (i ? 0.6 : -0.6), ry + 0.2);
      contact(x, z, len + 0.6, 1.4);
      collider(x - len / 2, z - 0.5, x + len / 2, z + 0.5, 0, 0.9);
    }

    function table(x, z, ry, w, d, h) {
      w = w || 1.2; d = d || 0.6; h = h || 0.74;
      bx('woodDark', w, 0.05, d, x, h, z, ry);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        bx('metalDark', 0.05, h, 0.05,
          x + Math.cos(ry) * dx * (w / 2 - 0.08) - Math.sin(ry) * dz * (d / 2 - 0.08), h / 2,
          z - Math.sin(ry) * dx * (w / 2 - 0.08) - Math.cos(ry) * dz * (d / 2 - 0.08), ry);
      }
      contact(x, z, w + 0.4, d + 0.4);
      collider(x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, h + 0.05);
    }

    function art(x, y, z, ry, w, h, seed, pal) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
        map: TEX.art(seed, pal), roughness: 0.85, metalness: 0
      }));
      mesh.position.set(x, y, z); mesh.rotation.y = ry;
      mesh.castShadow = false; mesh.receiveShadow = true;
      scene.add(mesh);
      const fr = boxGeo(0.06, h + 0.12, 0.06, 0);
      fr.translate(x - Math.sin(ry) * (w / 2 + 0.03), y, z - Math.cos(ry) * (w / 2 + 0.03));
      B.add('metalDark', fr);
    }

    /* ---- open office ---- */
    const blocks = [
      [-7.4, -3.0, -7.4, -5.6], [-7.4, -3.0, -1.0, 0.8],
      [3.0, 7.4, -7.4, -5.6], [3.0, 7.4, -1.0, 0.8],
      [-7.4, -3.0, 4.4, 6.8], [3.0, 7.4, 4.4, 6.8]
    ];
    for (const [x1, x2, z1, z2] of blocks) {
      for (let z = z1; z <= z2 + 0.01; z += 2.7) {
        for (let x = x1; x <= x2 + 0.01; x += 2.2) {
          desk(x, z, 0);
          chair(x, z - 1.02, Math.PI, 'task');
          chair(x, z + 1.02, 0, 'task');
        }
      }
    }
    // low storage spine between desk clusters
    bx('woodDark', 0.5, 1.0, 8.2, 0, 0.5, 0.3);
    bx('marble', 0.62, 0.06, 8.4, 0, 1.03, 0.3);
    collider(-0.31, -3.8, 0.31, 4.4, 0, 1.06);
    for (let i = 0; i < 4; i++) plant(0, -2.9 + i * 2.1, 0.55);
    // side credenzas
    cabinet(-8.4, -7.4, Math.PI / 2, 2.0, 1.1, 0.5);
    cabinet(8.4, -7.4, -Math.PI / 2, 2.0, 1.1, 0.5);
    // big planters in the corners
    plant(-8.0, 7.6, 1.5); plant(8.0, 7.6, 1.5);
    plant(-8.0, -7.6, 1.2); plant(8.0, -7.6, 1.2);
    // printer / copier
    bx('white', 0.9, 1.1, 0.7, 7.6, 0.55, -2.6);
    bx('dark', 0.8, 0.16, 0.5, 7.6, 1.18, -2.6);
    bx('screen', 0.24, 0.16, 0.02, 7.6, 1.28, -2.94);
    collider(7.15, -2.95, 8.05, -2.25, 0, 1.3);
    // whiteboard on the core wall
    const wb = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), new THREE.MeshStandardMaterial({ map: TEX.whiteboard(4), roughness: 0.35, metalness: 0.05 }));
    wb.position.set(0, 1.95, -8.84); wb.receiveShadow = true;
    scene.add(wb);
    // scattered papers
    for (let i = 0; i < 26; i++) {
      const a = U.rnd(0, 6.28), r = U.rnd(0.6, 7.2);
      const g = new THREE.PlaneGeometry(0.21, 0.29);
      g.rotateY(U.rnd(0, 3.14)); g.rotateX(-Math.PI / 2 + U.rnd(-0.08, 0.08));
      g.translate(Math.cos(a) * r, 0.006, Math.sin(a) * r);
      B.add('white', g);
    }

    /* ---- meeting room ---- */
    bx('woodDark', 9.6, 0.08, 2.5, 0, 0.75, -17.2);
    bx('metalDark', 8.6, 0.1, 1.5, 0, 0.68, -17.2);
    for (const dx of [-3.6, 0, 3.6]) {
      bx('metalDark', 0.5, 0.7, 1.4, dx, 0.35, -17.2);
    }
    contact(0, -17.2, 11, 4.2);
    collider(-4.9, -18.5, 4.9, -15.9, 0, 0.8);
    for (let i = 0; i < 5; i++) {
      const x = -3.6 + i * 1.8;
      chair(x, -18.75, 0, 'task');
      chair(x, -15.65, Math.PI, 'task');
    }
    chair(-5.7, -17.2, -Math.PI / 2, 'exec');
    chair(5.7, -17.2, Math.PI / 2, 'exec');
    // screen + credenza on the west wall
    bx('dark', 0.08, 1.5, 2.6, -12.28, 2.0, -17.2);
    pl('screen', 2.4, 1.34, -12.22, 2.0, -17.2, 0, Math.PI / 2);
    cabinet(-11.7, -20.4, 0, 2.6, 1.0, 0.5);
    cabinet(11.7, -20.4, 0, 2.6, 1.0, 0.5);
    // water bottles / papers on the table
    for (let i = 0; i < 7; i++) {
      const x = -3.9 + i * 1.3;
      cyl('white', 0.035, 0.2, x, 0.89, -17.2 + U.rnd(-0.4, 0.4), 8);
      bx('paper', 0.22, 0.008, 0.3, x + 0.2, 0.79, -17.0);
    }
    // overturned chair — sign of the robbery
    (function () {
      const x = -2.2, z = -14.6;
      bx('fabric', 0.46, 0.11, 0.46, x, 0.14, z, 0.9);
      bx('fabric', 0.46, 0.5, 0.1, x + 0.26, 0.3, z + 0.28, 1.3);
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx('metalDark', 0.035, 0.5, 0.035, x + dx * 0.16, 0.26, z + dz * 0.16, 0.8);
      contact(x, z, 1.0, 1.0);
    })();
    art(-12.34, 2.2, -14.6, Math.PI / 2, 1.7, 2.1, 12, ['#20262b', '#3b4a54', '#a8763f', '#d8cfbf']);
    // pendant lights over the table
    for (let i = 0; i < 3; i++) {
      const x = -3 + i * 3;
      bx('metalDark', 0.02, 0.7, 0.02, x, H - 0.35, -17.2);
      cyl('metalDark', 0.22, 0.16, x, H - 0.76, -17.2, 14);
      bx('light', 0.3, 0.03, 0.3, x, H - 0.85, -17.2);
    }

    /* ---- CEO office ---- */
    // rug
    pl('fabricWarm', 6.4, 5.2, 19.2, 0.012, 2.2, -Math.PI / 2, 0);
    bx('woodDark', 2.9, 0.07, 1.3, 18.6, 0.76, 4.6);
    bx('woodDark', 2.7, 0.3, 1.1, 18.6, 0.6, 4.6);
    bx('woodDark', 0.6, 0.72, 0.9, 17.55, 0.36, 4.6);
    bx('woodDark', 0.6, 0.72, 0.9, 19.65, 0.36, 4.6);
    bx('chrome', 0.3, 0.03, 0.2, 17.2, 0.8, 4.9);
    contact(18.6, 4.6, 3.6, 2.2);
    collider(17.1, 3.9, 20.1, 5.3, 0, 0.82);
    // boss chair (occupied)
    chair(21.0, 4.6, -Math.PI / 2, 'exec');
    // visitor chairs
    chair(17.4, 6.5, Math.PI / 2, 'exec');
    chair(17.4, 2.7, Math.PI / 2, 'exec');
    // sofa + coffee table
    sofa(19.4, -3.4, 0, 2.6);
    table(19.4, -5.0, 0, 1.7, 0.8, 0.42);
    // bookshelf along the north wall
    bx('woodDark', 5.0, 2.5, 0.4, 17.6, 1.25, -8.68);
    for (let i = 0; i < 5; i++) bx('metalDark', 5.0, 0.04, 0.42, 17.6, 0.4 + i * 0.5, -8.66);
    for (let i = 0; i < 44; i++) {
      const x = 15.3 + U.rnd(0, 4.6), y = 0.44 + Math.floor(U.rnd(0, 4)) * 0.5 + 0.14;
      bx(['white', 'fabricWarm', 'metalDark', 'wood'][i % 4], 0.035 + U.rnd(0, 0.03), 0.26, 0.2, x, y, -8.7);
    }
    collider(15.1, -8.9, 20.1, -8.45, 0, 2.5);
    // safe behind a panel
    bx('metalDark', 0.86, 0.9, 0.8, 24.8, 0.45, 7.6);
    cyl('chrome', 0.1, 0.04, 24.8, 0.55, 7.18, 12);
    collider(24.3, 7.15, 25.3, 8.05, 0, 0.92);
    // art + floor lamp
    art(25.72, 2.1, 1.0, -Math.PI / 2, 2.2, 1.6, 22, ['#141a20', '#3a4753', '#c08a4a', '#e6dfd0', '#5c6a72']);
    art(20.4, 2.3, 8.72, Math.PI, 1.6, 2.0, 27, ['#1a1e24', '#4a3b32', '#b98a54', '#ded3bf']);
    cyl('metalDark', 0.03, 1.5, 23.9, 0.75, -6.6, 8);
    cyl('metalDark', 0.26, 0.02, 23.9, 0.02, -6.6, 12);
    cyl('light', 0.22, 0.26, 23.9, 1.55, -6.6, 12);
    // loot bags
    for (let i = 0; i < 3; i++) {
      const x = 14.0 + i * 0.62, z = 6.4 + (i % 2) * 0.5;
      const g = new THREE.SphereGeometry(0.26, 10, 8);
      g.scale(1, 0.85, 0.9); g.translate(x, 0.24, z);
      B.add('fabricWarm', g);
      contact(x, z, 0.7, 0.7);
    }

    /* ---- CFO office ---- */
    pl('fabric', 5.4, 4.4, -19.0, 0.012, 1.6, -Math.PI / 2, 0);
    bx('woodDark', 2.6, 0.07, 1.2, -19.0, 0.76, 4.4);
    bx('woodDark', 2.4, 0.3, 1.0, -19.0, 0.6, 4.4);
    bx('metalDark', 0.5, 0.72, 0.9, -20.1, 0.36, 4.4);
    bx('metalDark', 0.5, 0.72, 0.9, -17.9, 0.36, 4.4);
    contact(-19.0, 4.4, 3.2, 2.0);
    collider(-20.4, 3.75, -17.6, 5.05, 0, 0.82);
    chair(-19.0, 5.6, 0, 'exec');
    chair(-19.0, 3.1, Math.PI, 'task');
    // dual monitors on the desk
    bx('dark', 0.52, 0.33, 0.04, -19.5, 1.1, 4.5);
    bx('screen', 0.48, 0.29, 0.02, -19.5, 1.1, 4.47);
    bx('dark', 0.52, 0.33, 0.04, -18.6, 1.1, 4.5);
    bx('screen', 0.48, 0.29, 0.02, -18.6, 1.1, 4.47);
    // filing wall
    for (let i = 0; i < 4; i++) cabinet(-25.4, -7.0 + i * 1.0, Math.PI / 2, 0.94, 1.5, 0.46);
    bx('white', 1.4, 0.9, 0.6, -23.6, 0.45, 7.6);   // shredder
    bx('dark', 0.5, 0.14, 0.42, -23.6, 0.95, 7.6);
    collider(-24.3, 7.3, -22.9, 7.9, 0, 1.0);
    // safe + open door
    bx('metalDark', 0.9, 1.0, 0.9, -16.0, 0.5, -7.6);
    bx('metalDark', 0.06, 0.9, 0.86, -15.5, 0.5, -7.3);
    bx('metal', 0.5, 0.4, 0.4, -15.4, 0.4, -6.2);
    collider(-16.5, -8.1, -15.5, -7.1, 0, 1.05);
    // corkboard
    const cb = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), new THREE.MeshStandardMaterial({ map: TEX.whiteboard(11), roughness: 0.9 }));
    cb.position.set(-25.72, 2.05, 0.6); cb.rotation.y = Math.PI / 2;
    scene.add(cb);
    art(-20.8, 2.3, 8.72, Math.PI, 1.8, 2.2, 31, ['#161a1f', '#2f3a42', '#8c6a44', '#cfc4ae']);
    sofa(-22.8, -3.2, Math.PI / 2, 2.2);
    table(-21.2, -3.2, 0, 0.8, 0.7, 0.4);

    /* ---- pantry ---- */
    // counter run along the south wall
    bx('marbleDark', 14.0, 0.9, 0.72, -18.0, 0.45, 21.4);
    bx('marble', 14.2, 0.08, 0.8, -18.0, 0.94, 21.4);
    bx('metalDark', 14.0, 0.12, 0.1, -18.0, 0.06, 21.06);
    collider(-25.1, 21.0, -10.9, 21.85, 0, 1.0);
    // upper cabinets
    bx('woodDark', 12.0, 0.9, 0.4, -18.0, 2.75, 21.55);
    bx('light', 11.6, 0.04, 0.1, -18.0, 2.28, 21.35);
    // sink
    bx('chrome', 0.7, 0.06, 0.44, -22.0, 0.96, 21.36);
    cyl('chrome', 0.03, 0.34, -22.0, 1.14, 21.7, 8);
    bx('chrome', 0.2, 0.03, 0.03, -21.9, 1.3, 21.55);
    // coffee machine
    bx('metal', 0.6, 0.66, 0.5, -15.4, 1.31, 21.4);
    bx('dark', 0.46, 0.16, 0.06, -15.4, 1.42, 21.13);
    bx('alarm', 0.05, 0.05, 0.03, -15.55, 1.58, 21.12);
    cyl('white', 0.045, 0.11, -15.4, 1.02, 21.16, 10);
    // microwave + kettle
    bx('metal', 0.56, 0.34, 0.42, -12.6, 1.15, 21.4);
    bx('screen', 0.2, 0.14, 0.02, -12.6, 1.15, 21.18);
    // fridge
    bx('metal', 0.86, 1.95, 0.74, -25.4, 0.98, 18.4);
    bx('metal', 0.86, 0.5, 0.74, -25.4, 0.25, 18.4);
    bx('chrome', 0.04, 0.5, 0.04, -25.02, 1.35, 18.4);
    collider(-25.85, 18.0, -24.9, 18.8, 0, 2.0);
    // island + stools
    bx('marbleDark', 4.2, 0.9, 1.4, -17.6, 0.45, 17.3);
    bx('marble', 4.4, 0.08, 1.55, -17.6, 0.94, 17.3);
    contact(-17.6, 17.3, 5.0, 2.2);
    collider(-19.75, 16.55, -15.45, 18.05, 0, 1.0);
    for (let i = 0; i < 4; i++) {
      const x = -19.2 + i * 1.1;
      cyl('metalDark', 0.05, 0.62, x, 0.31, 15.7, 10);
      cyl('fabricWarm', 0.22, 0.08, x, 0.66, 15.7, 12);
      contact(x, 15.7, 0.7, 0.7);
      collider(x - 0.24, 15.46, x + 0.24, 15.94, 0, 0.7);
    }
    // water cooler
    cyl('white', 0.26, 1.0, -10.2, 0.5, 19.8, 12);
    cyl('glass', 0.2, 0.4, -10.2, 1.25, 19.8, 12);
    collider(-10.5, 19.5, -9.9, 20.1, 0, 1.45);
    // bar tables
    table(-13.4, 18.4, 0, 1.0, 1.0, 1.06);
    table(-11.2, 15.4, 0, 1.0, 1.0, 1.06);
    // chalkboard
    const ck = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.3), new THREE.MeshStandardMaterial({ map: TEX.whiteboard(17), roughness: 0.9 }));
    ck.position.set(-9.14, 1.85, 15.6); ck.rotation.y = -Math.PI / 2;
    scene.add(ck);
    plant(-24.6, 13.4, 1.2); plant(-9.8, 13.2, 0.9);

    /* ---- lobby dressing ---- */
    sofa(8.4, 18.6, Math.PI / 2, 2.4);
    table(8.4, 16.6, 0, 1.4, 0.7, 0.4);
    chair(8.4, 15.4, Math.PI, 'exec');
    plant(-7.8, 13.4, 1.5); plant(-7.8, 21.0, 1.3); plant(11.4, 13.4, 1.2);
    // directory board
    const dir = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), new THREE.MeshStandardMaterial({ map: TEX.sign('楼层索引', '42F · 几猫资本 / 43F · 董事会', { dark: false }), roughness: 0.5 }));
    dir.position.set(-8.86, 1.85, 17.4); dir.rotation.y = Math.PI / 2;
    scene.add(dir);
    // magazines + dropped laptop
    for (let i = 0; i < 5; i++) bx('white', 0.2, 0.012, 0.28, 7.9 + U.rnd(-0.2, 0.2), 0.44, 16.4 + i * 0.02);
    bx('metalDark', 0.36, 0.03, 0.26, 5.6, 0.03, 19.4, 0.7);
    bx('metalDark', 0.36, 0.02, 0.26, 5.9, 0.05, 19.3, 0.55);
    // toppled trolley
    bx('metal', 0.5, 0.9, 0.8, -6.2, 0.32, 19.8, 0.5);
    for (const [dx, dz] of [[-0.18, -0.3], [0.18, -0.3], [-0.18, 0.3], [0.18, 0.3]]) cyl('metalDark', 0.06, 0.06, -6.2 + dx, 0.06, 19.8 + dz, 8);
    // turnstile / security gate
    bx('metalDark', 0.3, 1.0, 1.4, 10.6, 0.5, 19.4);
    bx('chrome', 0.34, 0.06, 1.5, 10.6, 1.02, 19.4);
    bx('alarm', 0.05, 0.05, 0.05, 10.6, 1.1, 19.0);
    collider(10.4, 18.65, 10.8, 20.15, 0, 1.05);
    // marble inlay at the entry, with the floor number stencilled on it
    pl('marbleDark', 5.6, 3.4, 1.0, 0.014, 15.2, -Math.PI / 2, 0);
    const numTex = (function () {
      const c = document.createElement('canvas'); c.width = 512; c.height = 512;
      const x = c.getContext('2d');
      x.clearRect(0, 0, 512, 512);
      x.fillStyle = 'rgba(255,197,122,.30)';
      x.font = '900 300px "PingFang SC","Microsoft YaHei",sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('42F', 256, 236);
      x.font = '600 44px "Microsoft YaHei",sans-serif';
      x.fillStyle = 'rgba(255,197,122,.22)';
      x.fillText('JIMAO TOWER', 256, 396);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const num = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4), new THREE.MeshBasicMaterial({
      map: numTex, transparent: true, depthWrite: false, opacity: 0.9, toneMapped: true
    }));
    num.rotation.x = -Math.PI / 2; num.rotation.z = 0.22;
    num.position.set(1.0, 0.02, 15.2);
    scene.add(num);

    /* ---- corridors ---- */
    const corridorArt = [
      [12.36, -6, -Math.PI / 2, 1.2], [-12.36, -6, Math.PI / 2, 1.2],
      [12.36, 6, -Math.PI / 2, 1.2], [-12.36, 6, Math.PI / 2, 1.2],
      [6, -12.36, 0, 1.4], [-6, -12.36, 0, 1.4]
    ];
    corridorArt.forEach((a, i) => art(a[0], 2.15, a[1], a[2], a[3], 1.7, 40 + i, ['#191d22', '#39434c', '#9a7448', '#d6ccb8']));
    plant(-11.6, -11.4, 1.0); plant(11.6, -11.4, 1.0);
    plant(-11.6, 11.4, 1.0); plant(11.6, 11.4, 1.0);
    plant(11.4, 2.6, 0.9); plant(-11.4, 2.6, 0.9);
    // fire equipment + exit signs
    bx('alarm', 0.24, 0.6, 0.2, 8.72, 1.2, -10.4);
    bx('alarm', 0.24, 0.6, 0.2, -8.72, 1.2, 10.4);
    bx('exitSign', 0.9, 0.28, 0.06, 0, 2.9, -12.4);
    bx('exitSign', 0.9, 0.28, 0.06, -1.8, 2.9, 12.4);
    bx('exitSign', 0.9, 0.28, 0.06, 10.4, 2.9, 9.2);
    // east alcove: a plant and a bench so the dead end reads as a rest nook
    bench(20.0, 10.9);
    plant(24.4, 10.6, 1.1);
    // benches
    bx('fabric', 2.4, 0.42, 0.5, -4.5, 0.24, -10.7);
    bx('fabric', 2.4, 0.42, 0.5, 4.5, 0.24, 10.7);
    collider(-5.7, -10.95, -3.3, -10.45, 0, 0.5);
    collider(3.3, 10.45, 5.7, 10.95, 0, 0.5);

    /* ---- sealed rooms (atmosphere) ---- */
    // archive: roller shutter
    for (let i = 0; i < 14; i++) bx('metal', 10.6, 0.11, 0.06, -19.2, 0.25 + i * 0.14, -12.34);
    bx('metalDark', 11.0, 0.3, 0.16, -19.2, 2.4, -12.34);
    // server room: glass with racks inside
    glassX(12.5, -22, -12.5, H);
    for (let i = 0; i < 4; i++) {
      bx('dark', 0.6, 2.0, 1.0, 14.4 + i * 1.2, 1.0, -19.6);
      bx('lightCool', 0.02, 0.05, 0.9, 14.72, 1.6, -19.6);
      bx('alarm', 0.02, 0.03, 0.03, 14.72, 1.3, -19.3);
    }
    collider(13.5, -21.5, 19.0, -17.6, 0, 2.0);
    // phone booths
    for (let i = 0; i < 3; i++) {
      const x = 15.2 + i * 1.6;
      bx('woodDark', 1.2, 2.2, 0.9, x, 1.1, 20.4);
      bx('glass', 1.0, 1.8, 0.02, x, 1.3, 19.94);
      bx('light', 0.5, 0.02, 0.02, x, 2.15, 19.96);
      collider(x - 0.62, 19.9, x + 0.62, 20.9, 0, 2.2);
    }

    /* ---- city view ---- */
    const cityTex = TEX.city(7);
    cityTex.wrapS = THREE.RepeatWrapping;
    cityTex.repeat.set(3, 1);
    const city = new THREE.Mesh(
      new THREE.CylinderGeometry(150, 150, 120, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: cityTex, side: THREE.BackSide, fog: false, toneMapped: true })
    );
    city.position.y = 34;
    city.rotation.y = 0.7;
    scene.add(city);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(260, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0x070b12, side: THREE.BackSide, fog: false })
    );
    scene.add(sky);

    // ground far below (so looking down through glass reads as height)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ color: 0x080c11, fog: false }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -42;
    scene.add(ground);
    // distant traffic light dots
    const dotGeo = new THREE.BufferGeometry();
    const N = 420, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const rl = TEX.noise();
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.283, r = 60 + Math.random() * 90;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = -30 + Math.random() * 8; pos[i * 3 + 2] = Math.sin(a) * r;
      const warm = Math.random() < 0.75;
      col[i * 3] = warm ? 1 : 0.7; col[i * 3 + 1] = warm ? 0.72 : 0.85; col[i * 3 + 2] = warm ? 0.42 : 1;
    }
    dotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dotGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.75, fog: false, sizeAttenuation: true, depthWrite: false }));
    scene.add(dots);

    /* ---- dust motes in the shafts ---- */
    (function () {
      const N = 520, g = new THREE.BufferGeometry();
      const p = new Float32Array(N * 3), s = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        p[i * 3] = U.rnd(-24, 24); p[i * 3 + 1] = U.rnd(0.2, 3.6); p[i * 3 + 2] = U.rnd(-20, 20);
        s[i] = U.rnd(0.5, 1.6);
      }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('aScale', new THREE.BufferAttribute(s, 1));
      const m = new THREE.PointsMaterial({ color: 0xffe6c4, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      scene.add(pts);
      LV.dust = pts;
    })();

    /* ============================================ lights */
    const hemi = new THREE.HemisphereLight(0x93aec9, 0x2a231d, 0.85);
    scene.add(hemi);
    const amb = new THREE.AmbientLight(0x5a6674, 0.55);
    scene.add(amb);

    const moon = new THREE.DirectionalLight(0xa8c6ea, 1.5);
    moon.position.set(-42, 34, 46);
    moon.target.position.set(0, 0, 0);
    scene.add(moon); scene.add(moon.target);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    const sc = moon.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 130;
    moon.shadow.bias = -0.0009;
    moon.shadow.normalBias = 0.03;
    LV.sun = moon;

    function warm(x, y, z, intensity, dist, color) {
      const l = new THREE.PointLight(color || 0xffcf9a, intensity, dist, 2);
      l.position.set(x, y, z);
      scene.add(l);
      return l;
    }
    warm(1.6, 3.0, 17.2, 55, 26, 0xffd7a8);    // lobby
    warm(0, 3.2, 0, 70, 30, 0xffe0bb);         // open office
    warm(0, 3.2, -17.2, 50, 20, 0xffd2a2);     // meeting
    warm(19, 3.2, 2.0, 42, 18, 0xffd9b0);       // ceo
    warm(-19, 3.2, 2.0, 38, 18, 0xffd9b0);      // cfo
    warm(-17.6, 3.0, 17.6, 42, 16, 0xffe3c0);   // pantry
    // corridors are lit by their emissive ceiling runs plus the room spill

    // alarm beacons in the corridors (pulse in game.js)
    const beacon = warm(-4.5, 3.3, -11.8, 0, 9, 0xff3a20);
    LV.beacon = beacon;

    /* ---- finalize batches ---- */
    B.finish(scene, R);

    // fill room bookkeeping
    LV.rooms = ROOM_DEFS.map((r) => ({
      id: r.id, name: r.name, en: r.en, rect: r.rect,
      cx: (r.rect.x1 + r.rect.x2) / 2, cz: (r.rect.z1 + r.rect.z2) / 2,
      total: 0, cleared: false
    }));
    // register material key used by decals
    LV.R = R;

    /* ============================================ actors & pickups */
    LV.actors = {
      robbers: [
        { room: 'meet', x: -6.4, z: -16.2, ry: 1.2 },
        { room: 'meet', x: 5.2, z: -19.4, ry: -2.1 },
        { room: 'open', x: -5.2, z: -3.4, ry: 0.6 },
        { room: 'open', x: 4.6, z: 2.2, ry: -1.8 },
        { room: 'open', x: 6.0, z: -6.4, ry: 2.4 },
        { room: 'ceo', x: 18.2, z: -1.2, ry: 0.2 },
        { room: 'ceo', x: 21.4, z: 6.6, ry: -2.4 },
        { room: 'cfo', x: -18.6, z: -0.6, ry: -0.3 },
        { room: 'cfo', x: -21.4, z: 6.4, ry: 2.6 },
        { room: 'pantry', x: -15.6, z: 14.9, ry: 2.9 }
      ],
      hostages: [
        { room: 'meet', x: -3.0, z: -20.6, ry: 0.4, name: '周敏', role: '项目经理' },
        { room: 'open', x: 1.2, z: 6.6, ry: 0.9, name: '林小满', role: '前台' },
        { room: 'cfo', x: -23.4, z: 1.2, ry: -0.8, name: '高维', role: '财务总监' },
        { room: 'pantry', x: -14.2, z: 19.6, ry: -0.5, name: '许安', role: '实习生' }
      ],
      boss: { room: 'ceo', x: 21.0, z: 4.6, ry: -1.57, name: '陈立群', role: '创始人 / CEO' }
    };
    LV.pickups = [
      { kind: 'ammo', x: -10.6, z: -10.6 },
      { kind: 'ammo', x: 10.6, z: 10.6 },
      { kind: 'ammo', x: 7.4, z: 1.2 },
      { kind: 'health', x: -7.6, z: 14.2 },
      { kind: 'health', x: 12.0, z: -11.0 },
      { kind: 'health', x: 23.6, z: -7.2 }
    ];

    /* ============================================ nav grid */
    LV.nav = buildNav();

    return LV;
  };

  /* ============================================================== nav */
  function buildNav() {
    const x0 = -26, z0 = -22, cell = 0.7;
    const W = Math.ceil(52 / cell), D = Math.ceil(44 / cell);
    const blocked = new Uint8Array(W * D);
    const inflate = 0.34;
    for (const c of LV.colliders) {
      if (c.y1 < 0.55) continue;
      const ax = Math.floor((c.x1 - inflate - x0) / cell), bx2 = Math.ceil((c.x2 + inflate - x0) / cell);
      const az = Math.floor((c.z1 - inflate - z0) / cell), bz = Math.ceil((c.z2 + inflate - z0) / cell);
      for (let z = Math.max(0, az); z < Math.min(D, bz); z++)
        for (let x = Math.max(0, ax); x < Math.min(W, bx2); x++) blocked[z * W + x] = 1;
    }
    // also block the sealed rooms / exterior
    const nav = {
      x0, z0, cell, W, D, blocked,
      idx(x, z) {
        const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
        if (i < 0 || j < 0 || i >= W || j >= D) return -1;
        return j * W + i;
      },
      free(x, z) {
        const i = this.idx(x, z);
        return i >= 0 && !blocked[i];
      },
      toWorld(i, j) { return { x: x0 + (i + 0.5) * cell, z: z0 + (j + 0.5) * cell }; },
      nearestFree(x, z) {
        const i0 = Math.floor((x - x0) / cell), j0 = Math.floor((z - z0) / cell);
        for (let r = 0; r < 12; r++) {
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const i = i0 + dx, j = j0 + dz;
            if (i < 0 || j < 0 || i >= W || j >= D) continue;
            if (!blocked[j * W + i]) return this.toWorld(i, j);
          }
        }
        return { x, z };
      }
    };
    // A*
    const open = [], seen = new Int32Array(W * D), came = new Int32Array(W * D), cost = new Float32Array(W * D);
    nav.path = function (sx, sz, tx, tz, limit) {
      let s = nav.idx(sx, sz), t = nav.idx(tx, tz);
      if (s < 0 || t < 0) return null;
      // if an endpoint sits inside furniture, step out to the nearest walkable cell
      if (blocked[t]) {
        const n = nav.nearestFree(tx, tz);
        tx = n.x; tz = n.z; t = nav.idx(tx, tz);
      }
      if (s !== t && blocked[s]) {
        const n = nav.nearestFree(sx, sz);
        sx = n.x; sz = n.z; s = nav.idx(sx, sz);
      }
      if (s < 0 || t < 0) return null;
      if (s === t) return [];
      seen.fill(0); came.fill(-1); cost.fill(Infinity);
      open.length = 0;
      const si = s % W, sj = (s / W) | 0, ti = t % W, tj = (t / W) | 0;
      const h = (i, j) => Math.hypot(i - ti, j - tj);
      cost[s] = 0; seen[s] = 1;
      open.push({ i: s, f: h(si, sj) });
      let guard = 0;
      const maxNodes = limit || 2600;
      while (open.length && guard++ < maxNodes) {
        let bi = 0;
        for (let k = 1; k < open.length; k++) if (open[k].f < open[bi].f) bi = k;
        const cur = open.splice(bi, 1)[0];
        const ci = cur.i % W, cj = (cur.i / W) | 0;
        if (cur.i === t) {
          const out = [];
          let n = t;
          while (n >= 0 && n !== s) { out.push(nav.toWorld(n % W, (n / W) | 0)); n = came[n]; }
          out.reverse();
          return out;
        }
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const ni = ci + dx, nj = cj + dz;
          if (ni < 0 || nj < 0 || ni >= W || nj >= D) continue;
          const n = nj * W + ni;
          if (blocked[n]) continue;
          if (dx && dz) {
            if (blocked[cj * W + ni] || blocked[nj * W + ci]) continue;
          }
          const nc = cost[cur.i] + (dx && dz ? 1.414 : 1);
          if (nc < cost[n]) {
            cost[n] = nc; came[n] = cur.i; seen[n] = 1;
            const f = nc + h(ni, nj) * 1.05;
            let found = false;
            for (const o of open) if (o.i === n) { o.f = f; found = true; break; }
            if (!found) open.push({ i: n, f: f });
          }
        }
      }
      return null;
    };
    return nav;
  }

  LV.roomAt = function (x, z) {
    for (const r of LV.rooms) {
      const q = r.rect;
      if (x >= q.x1 && x <= q.x2 && z >= q.z1 && z <= q.z2) return r;
    }
    return null;
  };
  LV.roomNameAt = function (x, z) {
    const r = LV.roomAt(x, z);
    if (r) return r.name;
    return '走廊';
  };

  global.LV = LV;
})(window);
