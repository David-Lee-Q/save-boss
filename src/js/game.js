/* game.js — boot, player controller, shooting, AI orchestration, menus, settings, loop. */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const G = {
    running: false,
    paused: false,
    booted: false,
    time: 0,
    clockT: 0,
    retries: 0,
    robberKills: 0,
    robbersLeft: 0,
    alertLevel: 0,
    objFlash: 0,
    bossFreed: false,
    roomState: {},
    focusInteract: null,
    interactT: 0,
    hurtPulse: 0,
    playerRoom: null,
    ended: false
  };
  global.GAME = G;

  /* ============================================================== boot */
  const fatal = $('fatal');
  const bootMsg = $('bootMsg');
  const bootFill = $('bootFill');
  window.__errors = [];
  window.addEventListener('error', (e) => {
    window.__errors.push(String(e.message));
    fatal.textContent = 'ERROR: ' + e.message + '\n' + (e.error && e.error.stack ? e.error.stack.split('\n').slice(0, 4).join('\n') : '');
  });

  function setBoot(pct, msg) {
    bootFill.style.width = pct + '%';
    if (msg) bootMsg.textContent = msg;
  }

  /* ============================================================== player */
  const player = {
    pos: new THREE.Vector3(LV.spawn.x, 0, LV.spawn.z),
    vel: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    hp: 100, alive: true,
    crouch: false, sprinting: false, grounded: true,
    eyeY: 1.63, eyeH: 1.63, bobT: 0, stepAcc: 0,
    footY: 0,
    recoil: 0
  };
  G.player = player;
  // face north (-Z) at spawn
  player.yaw = 0;

  const settings = {
    quality: 'high',
    sens: 1.0,
    invert: false,
    volume: 0.8,
    fov: 82,
    adsFov: 52
  };

  /* ============================================================== input */
  const input = {
    move: { x: 0, z: 0 },
    lookDX: 0, lookDY: 0,
    fire: false, ads: false, sprint: false, crouch: false,
    jump: false, reload: false, interact: false,
    moving: false, sprintHeld: false,
    pointerLocked: false
  };
  G.input = input;

  const keys = {};
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch) document.documentElement.classList.add('is-touch');

  let canvas, renderer, scene, camera, post, weapon, hud, clock;
  let robbers = [], hostages = [], boss = null;
  let pickups = [];

  /* ============================================================== init */
  function init() {
    const T0 = performance.now();
    G.bootMarks = {};
    const mark = (n) => { G.bootMarks[n] = +(performance.now() - T0).toFixed(0); };
    canvas = $('view');
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: false, powerPreference: 'high-performance',
        alpha: false, stencil: false
      });
    } catch (e) {
      fatal.textContent = 'WebGL 初始化失败：' + e.message;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x070a0e, 1);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.045, 400);
    camera.position.set(player.pos.x, player.eyeY, player.pos.z);

    mark('renderer');
    const eq = TEX.envEquirect();
    mark('equirect');
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envRT = pmrem.fromEquirectangular(eq);
    scene.environment = envRT.texture;
    scene.background = null;
    mark('pmrem');

    U.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    setBoot(38, '正在装配 42 层家具');
    LV.build(scene, renderer, eq);
    mark('level');
    setBoot(66, '正在部署劫匪');
    spawnActors();
    mark('actors');

    weapon = new Weapon(scene, camera);
    weapon.reset();
    G.weapon = weapon;

    post = new PostFX(renderer);
    post.rtScene.depthTexture = null;
    G.post = post;

    HUD.init(G);
    hud = HUD;
    mark('hud');

    G.scene = scene; G.camera = camera; G.renderer = renderer;
    G.SCENE = scene;

    resize();
    bindEvents();
    setBoot(88, '正在校准视线');

    setupMenus();
    applyQuality();
    resize();
    setBoot(100, '就绪');
    setTimeout(() => {
      $('boot').classList.add('done');
      G.booted = true;
      if (!G.running) showMenu('title');
    }, 320);
  }

  function spawnActors() {
    robbers = [];
    G.roomState = {};
    for (const r of LV.rooms) G.roomState[r.id] = { total: 0, killed: 0, cleared: false, discovered: r.id === 'lobby' };

    for (const def of LV.actors.robbers) {
      const r = new Robber(scene, def);
      scene.add(r.rig.root);
      robbers.push(r);
      if (G.roomState[def.room]) {
        G.roomState[def.room].total++;
        LV.rooms.find((x) => x.id === def.room).total++;
      }
    }
    G.robbersTotal = robbers.length;
    G.robbersLeft = robbers.length;

    hostages = [];
    for (const h of LV.actors.hostages) {
      const c = new Character(scene, 'hostage', h.x, h.z, h.ry);
      c.name = h.name; c.role = h.role; c.freed = false; c.room = h.room;
      scene.add(c.rig.root);
      hostages.push(c);
    }

    const b = LV.actors.boss;
    boss = new Character(scene, 'boss', b.x, b.z, b.ry);
    boss.name = b.name; boss.role = b.role;
    boss.freed = false;
    scene.add(boss.rig.root);

    // pickups
    pickups = [];
    const mkPickup = (kind, x, z) => {
      const g = new THREE.Group();
      if (kind === 'ammo') {
        const m = new THREE.MeshStandardMaterial({ color: 0x3d4750, roughness: 0.55, metalness: 0.35 });
        const box1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.26), m);
        box1.position.y = 0.1;
        box1.castShadow = true;
        g.add(box1);
        const t = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, 0.28), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff9a20, emissiveIntensity: 0.8, roughness: 0.6 }));
        t.position.y = 0.22; g.add(t);
        const ammo = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.2), new THREE.MeshStandardMaterial({ color: 0xb08c52, roughness: 0.4, metalness: 0.7 }));
        ammo.position.set(-0.12, 0.24, 0); g.add(ammo);
        const ammo2 = ammo.clone(); ammo2.position.x = 0.0; g.add(ammo2);
      } else {
        const m = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.6 });
        const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.22), m);
        bag.position.y = 0.11; bag.castShadow = true; g.add(bag);
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.03), new THREE.MeshStandardMaterial({ color: 0xd23a2a, emissive: 0xc02818, emissiveIntensity: 0.7, roughness: 0.5 }));
        cross.position.set(0, 0.12, 0.115); g.add(cross);
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.03), cross.material);
        cross2.position.set(0, 0.12, 0.115); g.add(cross2);
      }
      // glow ring
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.36, 24), new THREE.MeshBasicMaterial({
        color: kind === 'ammo' ? 0xffb347 : 0xe8e4da, transparent: true, opacity: 0.4,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
      g.add(ring);
      g.position.set(x, 0, z);
      scene.add(g);
      pickups.push({ kind, x, z, mesh: g, ring, taken: false, t: Math.random() * 6.28 });
    };
    for (const p of LV.pickups) mkPickup(p.kind, p.x, p.z);
    G.pickups = pickups;

    G.robbers = robbers;
    G.hostages = hostages;
    G.boss = boss;
  }

  /* ============================================================== input bind */
  function bindEvents() {
    window.addEventListener('resize', resize);

    document.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      keys[k] = true;
      if (!G.running) return;
      if (k === 'KeyR') weapon.startReload();
      if (k === 'Escape' || k === 'KeyP') { if (G.running) pauseGame(); }
      if (k === 'Space') { input.jump = true; e.preventDefault(); }
      if (k === 'KeyF') melee();
      if (k === 'KeyM') toggleMute();
    });
    document.addEventListener('keyup', (e) => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

    canvas.addEventListener('mousedown', (e) => {
      SFX.init(); SFX.resume();
      if (!G.running) return;
      if (e.button === 0) input.fire = true;
      if (e.button === 2) input.ads = true;
      if (!input.pointerLocked && canvas.requestPointerLock) {
        try { canvas.requestPointerLock(); } catch (err) { }
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) input.fire = false;
      if (e.button === 2) input.ads = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      input.pointerLocked = locked;
      if (locked) {
        G.hadLock = true;
      } else if (G.hadLock && G.running) {
        // Esc / tab switch drops the lock: never leave the player aiming blind
        G.hadLock = false;
        pauseGame();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!G.running) return;
      if (input.pointerLocked) {
        applyLook(e.movementX, e.movementY);
      } else if (e.buttons & 1 || e.buttons & 2) {
        applyLook(e.movementX, e.movementY);
      }
    });

    // touch
    if (isTouch) bindTouch();

    // wheel → weapon sway only (no weapon swap)
    canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  }

  function applyLook(dx, dy) {
    const s = 0.0022 * settings.sens * (weapon && weapon.ads > 0.5 ? 0.62 : 1);
    player.yaw -= dx * s;
    player.pitch -= dy * s * (settings.invert ? -1 : 1);
    player.pitch = U.clamp(player.pitch, -1.35, 1.35);
    input.lookDX += dx * 0.02;
    input.lookDY += dy * 0.02;
  }

  /* ============================================================== touch */
  function bindTouch() {
    $('touch').classList.add('on');
    const stick = $('stick'), nub = $('nub');
    let stickId = null, sx = 0, sy = 0;
    const R = 58;
    const start = (id, x, y) => {
      stickId = id; sx = x; sy = y;
      stick.style.left = x + 'px'; stick.style.top = y + 'px';
      stick.classList.add('on');
      nub.style.transform = 'translate(0,0)';
    };
    const move = (x, y) => {
      let dx = x - sx, dy = y - sy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      nub.style.transform = `translate(${dx}px,${dy}px)`;
      input.move.x = dx / R; input.move.z = dy / R;
    };
    const end = () => {
      stickId = null;
      stick.classList.remove('on');
      input.move.x = input.move.z = 0;
      nub.style.transform = 'translate(0,0)';
    };

    let lookId = null, lx = 0, ly = 0;
    document.addEventListener('touchstart', (e) => {
      SFX.init(); SFX.resume();
      for (const t of e.changedTouches) {
        const target = t.target;
        if (target.closest && target.closest('.t-btn')) continue;
        if (target.closest && target.closest('.menu.open, .panel')) continue;
        if (t.clientX < window.innerWidth * 0.45 && stickId == null) start(t.identifier, t.clientX, t.clientY);
        else if (lookId == null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
      }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) move(t.clientX, t.clientY);
        else if (t.identifier === lookId) {
          applyLook((t.clientX - lx) * 2.0, (t.clientY - ly) * 2.0);
          lx = t.clientX; ly = t.clientY;
        }
      }
      e.preventDefault();
    }, { passive: false });
    const tend = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === stickId) end();
        else if (t.identifier === lookId) lookId = null;
      }
    };
    document.addEventListener('touchend', tend);
    document.addEventListener('touchcancel', tend);

    document.querySelectorAll('[data-touch]').forEach((btn) => {
      const act = btn.dataset.touch;
      const on = (e) => {
        e.preventDefault();
        btn.classList.add('active');
        if (act === 'fire') input.fire = true;
        if (act === 'ads') input.ads = !input.ads;
        if (act === 'jump') input.jump = true;
        if (act === 'reload') weapon.startReload();
        if (act === 'interact') input.interact = true;
        if (act === 'pause') { if (G.running) pauseGame(); }
      };
      const off = (e) => {
        e && e.preventDefault();
        btn.classList.remove('active');
        if (act === 'fire') input.fire = false;
        if (act === 'interact') input.interact = false;
        if (act === 'ads') btn.classList.toggle('active', input.ads);
      };
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchend', off);
      btn.addEventListener('touchcancel', off);
      btn.addEventListener('mousedown', on);
      btn.addEventListener('mouseup', off);
      btn.addEventListener('mouseleave', off);
    });
  }

  /* ============================================================== resize */
  function resize() {
    if (!renderer) return;
    const w = window.innerWidth, h = window.innerHeight;
    const cap = settings.quality === 'low' ? 0.9 : settings.quality === 'medium' ? 1.3 : 2;
    const scale = post ? (post.scale || 1) : 1;
    const dpr = Math.max(0.55, Math.min(window.devicePixelRatio || 1, cap) * scale);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (post) post.resize(Math.floor(w * dpr), Math.floor(h * dpr));
  }

  /* ============================================================== player update */
  const PLAYER_R = 0.34;

  function updatePlayer(dt) {
    // grounded/crouch
    player.crouch = !!(keys.KeyC || keys.ControlLeft || keys.ControlRight || input.crouchTouch);
    const wantSprint = !!(keys.ShiftLeft || keys.ShiftRight);
    const canSprint = !input.ads && !player.crouch;
    player.sprinting = wantSprint && canSprint && (input.move.x || input.move.z);
    player.sprintHeld = wantSprint;

    // desired velocity in camera space
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz -= 1;
    if (keys.KeyS || keys.ArrowDown) fz += 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
    // touch stick
    fx += input.move.x; fz += input.move.z;
    const mag = Math.hypot(fx, fz);
    if (mag > 1) { fx /= mag; fz /= mag; }

    const base = player.crouch ? 1.7 : (player.sprinting ? 6.0 : 3.5);
    const speed = base;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    // forward = -Z rotated by yaw
    const fwdX = -sy, fwdZ = -cy;
    const rightX = cy, rightZ = -sy;
    const wishX = (fwdX * -fz + rightX * fx) * speed;
    const wishZ = (fwdZ * -fz + rightZ * fx) * speed;

    const accel = player.grounded ? 14 : 3.5;
    player.vel.x = U.damp(player.vel.x, wishX, accel, dt);
    player.vel.z = U.damp(player.vel.z, wishZ, accel, dt);

    // jump
    if ((keys.Space || input.jump) && player.grounded) {
      player.vel.y = 4.2;
      player.grounded = false;
      SFX.footstep(true, 'stone');
    }
    input.jump = false;
    if (!player.grounded) {
      player.vel.y -= 15.5 * dt;
      player.pos.y += player.vel.y * dt;
      if (player.pos.y <= 0) { player.pos.y = 0; player.vel.y = 0; player.grounded = true; }
    }

    // move with collision
    const beforeX = player.pos.x, beforeZ = player.pos.z;
    Phys.move(player.pos, player.vel.x * dt, player.vel.z * dt, PLAYER_R);
    const moved = Math.hypot(player.pos.x - beforeX, player.pos.z - beforeZ);
    const speedNow = moved / Math.max(dt, 1e-4);

    input.moving = speedNow > 0.5;
    input.sprint = player.sprinting;
    input.ads = input.ads && !player.sprinting;

    // head bob + footsteps
    const eyeTarget = player.crouch ? 1.06 : 1.63;
    player.eyeH = U.damp(player.eyeH, eyeTarget, 12, dt);
    if (player.grounded && input.moving) {
      player.bobT += dt * (player.sprinting ? 13.5 : 9.4);
      player.stepAcc += dt * (player.sprinting ? 2.0 : 1.42);
      if (player.stepAcc > 0.5) {
        player.stepAcc = 0;
        const onStone = isStoneFloor(player.pos.x, player.pos.z);
        SFX.footstep(player.sprinting, onStone ? 'stone' : 'carpet');
        if (player.sprinting) makeNoise(player.pos.x, player.pos.z, 9, 0);
      }
    } else {
      player.bobT += dt * 1.5;
    }
    const bobAmt = input.moving ? (player.sprinting ? 0.055 : 0.032) : 0.008;
    player.bobY = Math.sin(player.bobT * 2) * bobAmt;

    // camera
    camera.position.set(player.pos.x, player.pos.y + player.eyeH + player.bobY, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    // slight roll while strafing
    const rollTarget = -(input.move.x) * 0.018 - (keys.KeyD ? 0.02 : 0) + (keys.KeyA ? 0.02 : 0);
    camera.rotation.z = U.damp(camera.rotation.z, rollTarget, 6, dt);

    // fov: sprint widen + ADS zoom
    const fovTarget = U.lerp(settings.fov + (player.sprinting ? 5 : 0), WPN.adsFov, weapon.ads);
    if (Math.abs(camera.fov - fovTarget) > 0.01) {
      camera.fov = U.damp(camera.fov, fovTarget, 16, dt);
      camera.updateProjectionMatrix();
    }
    weapon.airborne = !player.grounded;
    weapon.moveAmount = U.clamp(speedNow / 6, 0, 1);

    // player room
    const room = LV.roomAt(player.pos.x, player.pos.z);
    G.playerRoom = room;
    if (room && HUD.lastLocRoom !== room.id) {
      HUD.lastLocRoom = room.id;
      onEnterRoom(room);
    } else if (!room && HUD.lastLocRoom !== 'corridor') {
      HUD.lastLocRoom = 'corridor';
      HUD.location('走廊', '42F · 几猫中心');
    }
    // track visited rooms for the debrief
    if (room) {
      G.visited[room.id] = true;
      const st = G.roomState[room.id];
      if (st) st.discovered = true;
    }
  }

  function isStoneFloor(x, z) {
    if (x > -9 && x < 12.5 && z > 12.5 && z < 22) return true;
    if (x > -26 && x < -9 && z > 12.5 && z < 22) return true;
    return false;
  }

  /* ============================================================== shooting */
  const raycaster = new THREE.Raycaster();
  let shootT = 0;

  function tryShoot(dt) {
    if (!input.fire || !G.running) return;
    if (weapon.state === 'reloading') return;
    const shot = weapon.fire();
    if (!shot) return;
    G.shotsFired = (G.shotsFired || 0) + 1;

    // aim direction from camera with spread
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const spread = shot.spread * (1 + weapon.spreadHeat * 0.4);
    // gaussian-ish
    const a = Math.random() * 6.283;
    const r = Math.sqrt(Math.random()) * spread;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();

    const origin = new THREE.Vector3().copy(camera.position);
    const maxD = 60;

    // actors first (nearest)
    let best = null;
    for (const rb of robbers) {
      if (rb.state === 3) continue;
      const h = Phys.rayActor(origin, dir, rb, maxD);
      if (h && (!best || h.t < best.t)) best = { t: h.t, head: h.head, actor: rb };
    }
    const wall = Phys.rayWalls(origin, dir, maxD);
    if (wall && (!best || wall.t < best.t)) best = { t: wall.t, wall: wall };

    const muzzleW = new THREE.Vector3();
    weapon.muzzle.getWorldPosition(muzzleW);

    if (best && best.actor) {
      const p = origin.clone().addScaledVector(dir, best.t);
      weapon.tracer(muzzleW, p);
      const dmg = WPN.damage * (best.head ? WPN.headMul : 1);
      G.shotsHit = (G.shotsHit || 0) + 1;
      const killed = best.actor.hit(dmg, best.head);
      HUD.hitMarker(killed ? 'kill' : best.head ? 'head' : 'hit');
      SFX.hitmarker(best.head);
      // blood puff
      bloodPuff(p);
      if (killed) onRobberKilled(best.actor, best.head);
      // nearby robbers hear the shot
      for (const rb of robbers) {
        if (rb === best.actor || rb.state === 3) continue;
        const d = Math.hypot(rb.pos.x - player.pos.x, rb.pos.z - player.pos.z);
        if (d < 22) rb.alertTo(player.pos.x, player.pos.z, d < 12 && rb.canSee);
      }
    } else if (best && best.wall) {
      weapon.tracer(muzzleW, best.wall.point.clone().addScaledVector(dir, -0.3));
      weapon.impact(best.wall.point, best.wall.normal, Math.random() < 0.25);
      SFX.impact(0, Math.random() < 0.3);
      if (Math.random() < 0.18) SFX.ricochet(U.rnd(-0.5, 0.5));
    } else {
      weapon.tracer(muzzleW, origin.clone().addScaledVector(dir, 40));
    }
    // alert everyone who can hear
    makeNoise(player.pos.x, player.pos.z, 26, 16);
  }

  function bloodPuff(p) {
    const g = new THREE.BufferGeometry();
    const n = 10, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = p.x + U.rnd(-0.05, 0.05);
      pos[i * 3 + 1] = p.y + U.rnd(-0.05, 0.05);
      pos[i * 3 + 2] = p.z + U.rnd(-0.05, 0.05);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0x6a1210, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false });
    const pts = new THREE.Points(g, m);
    scene.add(pts);
    const v = [];
    for (let i = 0; i < n; i++) v.push(new THREE.Vector3(U.rnd(-0.6, 0.6), U.rnd(-0.2, 0.8), U.rnd(-0.6, 0.6)));
    let t = 0;
    const tick = (dt) => { };
    puffs.push({ pts, v, t: 0, life: 0.55 });
  }
  const puffs = [];
  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.t += dt;
      const arr = p.pts.geometry.attributes.position.array;
      for (let k = 0; k < p.v.length; k++) {
        p.v[k].y -= 6 * dt;
        arr[k * 3] += p.v[k].x * dt;
        arr[k * 3 + 1] += p.v[k].y * dt;
        arr[k * 3 + 2] += p.v[k].z * dt;
      }
      p.pts.geometry.attributes.position.needsUpdate = true;
      p.pts.material.opacity = Math.max(0, 0.9 * (1 - p.t / p.life));
      if (p.t >= p.life) { scene.remove(p.pts); p.pts.geometry.dispose(); p.pts.material.dispose(); puffs.splice(i, 1); }
    }
  }

  function makeNoise(x, z, radius, combatRadius) {
    for (const rb of robbers) {
      if (rb.state === 3) continue;
      const d = Math.hypot(rb.pos.x - x, rb.pos.z - z);
      if (d < radius) rb.alertTo(x, z, d < combatRadius && rb.canSee);
    }
  }

  /* melee */
  function melee() {
    if (!G.running) return;
    if (weapon.meleeT > 0) return;
    weapon.meleeT = 0.5;
    SFX.impact(0, false);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    for (const rb of robbers) {
      if (rb.state === 3) continue;
      const dx = rb.pos.x - player.pos.x, dz = rb.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.9) {
        const dot = (dx / d) * dir.x + (dz / d) * dir.z;
        if (dot > 0.5) {
          const killed = rb.hit(55, false);
          HUD.hitMarker(killed ? 'kill' : 'hit');
          if (killed) onRobberKilled(rb, false);
          break;
        }
      }
    }
  }

  /* ============================================================== damage */
  G.damagePlayer = function (dmg, sx, sz) {
    if (!player.alive || G.ended || G.god) return;
    if (G.time < 4) return;              // grace period while the lift doors close
    player.hp -= dmg;
    G.hurtPulse = 0.5;
    HUD.damageFrom(sx, sz, G);
    SFX.hurt();
    post.hurt = Math.min(0.9, post.hurt + 0.35);
    if (player.hp <= 0) {
      player.hp = 0;
      die();
    }
  };

  G.suppress = function (sx, sz) {
    // near miss: shake + a small audio sting
    G.hurtPulse = Math.max(G.hurtPulse, 0.22);
  };

  G.onSpotted = function (rb) {
    G.alertLevel = 1;
    G.spottedT = 4.0;
    if (!G.firstSpotted) {
      G.firstSpotted = true;
      HUD.say('队长 · 无线电', '他们看见你了！别站在开阔处。');
    }
  };

  function die() {
    player.alive = false;
    G.running = false;
    SFX.lose();
    weapon.gun.visible = false;
    setTimeout(() => {
      $('dead-time').textContent = U.fmtTime(G.time);
      $('dead-kills').textContent = G.robberKills;
      showMenu('dead');
    }, 1200);
  }

  /* ============================================================== kills & rooms */
  function onRobberKilled(rb, head) {
    G.robberKills++;
    G.robbersLeft--;
    const st = G.roomState[rb.room];
    if (st) {
      st.killed++;
      if (st.killed >= st.total) st.cleared = true;
    }
    HUD.kill('劫匪', head);
    G.objFlash = 1;
    SFX.hitmarker(false);

    if (G.robbersLeft === 0) {
      setTimeout(() => {
        HUD.say('陈立群 · CEO', '外面…外面安静了？是你吗？我在 CEO 办公室！', 5.2);
        HUD.msg('所有劫匪已被清除 · 前往 CEO 办公室营救老板', 4);
      }, 700);
    } else if (st && st.cleared) {
      const room = LV.rooms.find((r) => r.id === rb.room);
      HUD.msg(`${room ? room.name : '区域'} 已清空`, 2.2);
      HUD.say('队长 · 无线电', `${room ? room.name : '区域'}清空，继续搜。`, 2.6);
    }
  }

  function onEnterRoom(room) {
    HUD.location(room.name, `${room.en} · 42F 几猫中心`);
    if (room.id === 'ceo' && G.robbersLeft > 0) {
      HUD.say('陈立群 · CEO', '别过来！他们还有人！', 3.2);
    }
    if (room.id === 'meet' && G.robbersLeft > 0) {
      HUD.say('队长 · 无线电', '会议室有动静，小心。', 2.8);
    }
  }

  /* ============================================================== interactions */
  function updateInteractions(dt) {
    const prevFocus = G.focusInteract;
    G.focusInteract = null;
    const p = player.pos;
    let best = null, bestD = 1e9;
    const consider = (x, z, radius, item) => {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < radius && d < bestD) { bestD = d; best = item; }
    };

    // boss
    if (!G.bossFreed) {
      const ready = G.robbersLeft === 0;
      consider(boss.pos.x, boss.pos.z, 2.4, {
        kind: ready ? 'boss' : 'boss-blocked',
        label: ready ? '营救老板' : '先清剿全部劫匪',
        key: 'E', hold: ready, holdTime: 2.0
      });
    }
    // hostages
    for (const h of hostages) {
      if (h.freed) continue;
      consider(h.pos.x, h.pos.z, 1.8, { kind: 'hostage', hostage: h, label: '解开束缚', key: 'E', hold: true, holdTime: 1.5 });
    }
    // pickups
    for (const pk of pickups) {
      if (pk.taken) continue;
      if (pk.kind === 'ammo' && weapon.reserve >= WPN.reserve) continue;
      if (pk.kind === 'health' && player.hp >= 100) continue;
      const d = Math.hypot(pk.x - p.x, pk.z - p.z);
      if (d < 1.35) {
        if (pk.kind === 'ammo') {
          weapon.reserve = Math.min(WPN.reserve, weapon.reserve + 60);
          SFX.pickup('ammo');
          HUD.msg('补充弹药 +60', 1.6);
        } else {
          player.hp = Math.min(100, player.hp + 35);
          SFX.pickup('health');
          HUD.msg('使用医疗包 +35', 1.6);
        }
        pk.taken = true;
        pk.mesh.visible = false;
        G.objFlash = 0;
      }
    }

    if (!best || !prevFocus || best.kind !== prevFocus.kind) { if (best) G.interactResets = (G.interactResets || 0) + 1; G.interactT = 0; }
    G.focusInteract = best;
    if (!best) return;

    const held = keys.KeyE || input.interact;
    if (best.kind === 'boss-blocked') {
      if (held && !G.prevInteract) {
        HUD.msg(`还剩 ${G.robbersLeft} 名劫匪 · 清空全层才能安全带走老板`, 2.6);
        HUD.say('陈立群 · CEO', '别管我！先把他们清干净，门口还有人！', 3.2);
      }
    } else if (best.hold) {
      if (held) {
        G.interactT += dt;
        if (G.interactT >= best.holdTime) {
          G.interactT = 0;
          doInteract(best);
        }
      } else {
        G.interactT = Math.max(0, G.interactT - dt * 2.4);
      }
    } else if (held && !G.prevInteract) {
      doInteract(best);
    }
    G.prevInteract = held;
  }

  function doInteract(it) {
    if (it.kind === 'hostage') {
      const h = it.hostage;
      h.freed = true;
      SFX.pickup('health');
      HUD.say(`${h.name} · ${h.role}`, '谢谢…他们往会议室那边去了，快救陈董！', 4.2);
      HUD.msg(`${h.name} 已获救 · 躲到安全位置`, 2.8);
      G.hostagesFreed = (G.hostagesFreed || 0) + 1;
      // walk to the lobby and despawn
      h.fleeTo = { x: 2.0, z: 19.6 };
      h.fleePath = LV.nav.path(h.pos.x, h.pos.z, h.fleeTo.x, h.fleeTo.z);
      h.fleeI = 0;
    } else if (it.kind === 'boss') {
      G.bossFreed = true;
      SFX.pickup('health');
      SFX.win();
      HUD.say('陈立群 · CEO', '干得漂亮…保险库还锁着，东西一样没丢。', 5);
      HUD.msg('老板已获救 · 任务完成', 4.5);
      boss.freed = true;
      G.objFlash = 1;
      setTimeout(() => win(), 1500);
    }
  }

  /* ============================================================== win */
  function win() {
    if (G.ended) return;
    G.ended = true;
    G.running = false;
    SFX.win();
    document.exitPointerLock && document.exitPointerLock();
    const acc = G.shotsFired ? Math.round((G.shotsHit || 0) / G.shotsFired * 100) : 0;
    $('w-time').textContent = U.fmtTime(G.time);
    $('w-acc').textContent = acc + '%';
    $('w-kills').textContent = G.robberKills;
    $('w-hosts').textContent = `${G.hostagesFreed || 0}/${hostages.length}`;
    if ($('w-retries')) $('w-retries').textContent = G.retries;
    let rating = 'C · 勉强过关';
    if (acc >= 55 && G.time < 300 && (G.hostagesFreed || 0) >= 3) rating = 'S · 干净利落';
    else if (acc >= 40 && G.time < 420) rating = 'A · 专业水准';
    else if (acc >= 25) rating = 'B · 完成任务';
    $('w-rating').textContent = rating;

    // room-by-room report
    const rr = $('w-rooms');
    rr.innerHTML = HUD.roomOrder.map((id) => {
      const room = LV.rooms.find((r) => r.id === id);
      const st = G.roomState[id];
      const done = st.cleared || st.total === 0;
      const label = st.total === 0 ? '安全' : (st.cleared ? '已清空' : st.killed + '/' + st.total);
      return `<div class="${done ? '' : 'pending'}"><span>${room.name}</span><b>${label}</b></div>`;
    }).join('');

    setTimeout(() => showMenu('complete'), 700);
  }

  /* ============================================================== enemies */
  function updateActors(dt) {
    for (const rb of robbers) {
      if (rb.state === 3) {
        rb.deadT += dt;
        // collapse
        const k = Math.min(1, rb.deadT / 0.55);
        rb.rig.pelvis.position.y = U.lerp(0.92, 0.20, k);
        rb.rig.body.rotation.x = U.lerp(0, 1.42, k);
        rb.rig.legL.hip.rotation.x = U.lerp(0, 0.4, k);
        rb.rig.legR.hip.rotation.x = U.lerp(0, -0.2, k);
        rb.rig.legL.knee.rotation.x = U.lerp(0, 1.1, k);
        rb.rig.armL.shoulder.rotation.x = U.lerp(-1.0, -0.4, k);
        rb.rig.armR.shoulder.rotation.x = U.lerp(-1.0, -2.3, k);
        rb.rig.head.rotation.x = U.lerp(0, 0.5, k);
        rb.rig.root.rotation.y = rb.ry;
        rb.rig.root.position.set(rb.pos.x, 0, rb.pos.z);
        if (rb.rig.flash) rb.rig.flash.visible = false;
        continue;
      }
      rb.think(dt, G);
      rb.animate(dt);
      // body collision push against the player
      const dx = player.pos.x - rb.pos.x, dz = player.pos.z - rb.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.75 && d > 0.001) {
        const push = (0.75 - d) * 0.5;
        Phys.move(player.pos, (dx / d) * push, (dz / d) * push, PLAYER_R);
      }
      // recoil decay
      if (rb.recoilT > 0) {
        rb.recoilT -= dt;
        if (rb.recoilT <= 0) rb.aimAmt = 1;
      }
    }

    // hostages
    for (const h of hostages) {
      if (h.fleePath) {
        const wp = h.fleePath[h.fleeI];
        if (!wp) { h.fleePath = null; }
        else {
          const dx = wp.x - h.pos.x, dz = wp.z - h.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.4) h.fleeI++;
          else {
            const s = Math.min(2.4 * dt, d);
            Phys.move(h.pos, dx / d * s, dz / d * s, 0.3);
            h.ry = Math.atan2(dx, dz);
            h.walkAmt = 1;
          }
        }
        h.animate(dt, { freed: true });
        if (h.freed && !h.arrived && Math.hypot(h.pos.x - 2.0, h.pos.z - 19.6) < 1.2) {
          h.arrived = true;
          h.rig.root.visible = false;
        }
      } else {
        h.animate(dt, { freed: h.freed });
      }
    }

    // boss
    if (boss.freed) {
      boss.animate(dt, { seated: false });
    } else {
      boss.animate(dt, { seated: true });
    }
  }

  /* ============================================================== compass */
  G.compassTargets = function () {
    const out = [];
    if (!G.bossFreed && G.robbersLeft === 0) {
      out.push({ x: boss.pos.x, z: boss.pos.z, label: '老板', cls: 'extract', sub: Math.round(Math.hypot(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z)) + 'm' });
    }
    if (G.robbersLeft > 0) {
      for (const id of HUD.roomOrder) {
        const st = G.roomState[id];
        const n = st.total - st.killed;
        if (!st.discovered || n <= 0) continue;
        const room = LV.rooms.find((r) => r.id === id);
        out.push({ x: room.cx, z: room.cz, label: room.name.slice(0, 3), sub: n + '' });
      }
    }
    return out;
  };

  /* ============================================================== pickups anim */
  function updatePickups(dt) {
    for (const p of pickups) {
      if (p.taken) continue;
      p.t += dt * 2.2;
      p.mesh.position.y = Math.sin(p.t) * 0.02;
      p.ring.material.opacity = 0.24 + Math.sin(p.t * 1.6) * 0.12;
      p.ring.scale.setScalar(1 + Math.sin(p.t * 1.2) * 0.04);
    }
  }

  /* ============================================================== main loop */
  let acc = 0, frames = 0, fpsT = 0, fps = 60, clockT = 0, lastTick = 0;
  G.fps = 60;

  function rafLoop() {
    requestAnimationFrame(rafLoop);
    tick();
  }

  function tick() {
    G.frames = (G.frames || 0) + 1;
    const now = performance.now();
    let dt = (now - (lastTick || now)) / 1000;
    lastTick = now;
    G.lastTs = now;
    if (dt < 0.0005) return;
    if (dt > 0.1) dt = 0.1;
    if (G.timeScale && G.timeScale !== 1) dt *= G.timeScale;
    clockT += dt;
    G.clockT = clockT;

    G.lastDt = dt;
    if (G.running && !G.paused) {
      G.time += dt;
      updatePlayer(dt);
      updateWeaponInput(dt);
      tryShoot(dt);
      updateActors(dt);
      updateInteractions(dt);
      updatePickups(dt);
      updatePuffs(dt);

      // alert level decay
      if (G.spottedT > 0) G.spottedT -= dt;
      const anyCombat = robbers.some((r) => r.state === 2);
      G.alertLevel = U.damp(G.alertLevel, anyCombat ? 1 : 0, 2.4, dt);
      G.hurtPulse = Math.max(0, G.hurtPulse - dt * 2);
      post.hurt = Math.max(0, post.hurt - dt * 1.6);
      if (G.hurtPulse > 0) HUD.hurtT = Math.max(HUD.hurtT, 0.2);

      // low health heartbeat
      if (player.hp <= 30 && player.alive) {
        G.hbT = (G.hbT || 0) - dt;
        if (G.hbT <= 0) { G.hbT = 1.15; SFX.heartbeat(); }
      }
    } else {
      // idle: still animate props softly
      updatePickups(dt * 0.4);
    }

    // ambient motion
    if (LV.dust) {
      LV.dust.rotation.y += dt * 0.005;
      LV.dust.position.y = Math.sin(clockT * 0.14) * 0.12;
    }
    // alarm beacon pulse when the wing is hot
    if (LV.beacon) {
      const hot = G.alertLevel;
      LV.beacon.intensity = hot * (1.6 + Math.sin(clockT * 7) * 1.4);
    }
    // shadow light follows the player loosely for crisper near shadows
    if (LV.sun) {
      LV.sun.target.position.set(player.pos.x, 0, player.pos.z);
      LV.sun.target.updateMatrixWorld();
      LV.sun.position.set(player.pos.x - 34, 30, player.pos.z + 34);
    }

    if (G.booted) HUD.update(dt, G);

    // render
    post.render(scene, camera, clockT);

    frames++;
    fpsT += dt;
    if (fpsT > 0.5) {
      fps = frames / fpsT; G.fps = fps;
      frames = 0; fpsT = 0;
      adaptQuality();
    }
  }

  function updateWeaponInput(dt) {
    weapon.update(dt, {
      ads: input.ads, fire: input.fire,
      lookDX: input.lookDX, lookDY: input.lookDY,
      moving: input.moving, sprint: input.sprinting
    });
    input.lookDX *= 0.86;
    input.lookDY *= 0.86;
    if (weapon.meleeT > 0) weapon.meleeT -= dt;
  }

  /* quality governor */
  let qT = 0, qCool = 3;
  function adaptQuality() {
    qT += 0.5;
    if (qT < qCool) return;
    if (fps < 42 && post.scale > 0.6) {
      post.scale = Math.max(0.62, post.scale - 0.12);
      resize();
    } else if (fps > 58 && post.scale < 1) {
      post.scale = Math.min(1, post.scale + 0.06);
      resize();
    }
    qT = 0;
  }

  /* ============================================================== menus */
  const MENUS = {
    title: `
    <section class="m-screen m-title" data-s="title" aria-label="抢救老板">
      <div class="m-title-main">
        <div class="m-brand">
          <div class="mark"><b>几</b></div>
          <div class="co"><b>几猫资本</b><br>JIMAO CAPITAL · 42F 危机响应</div>
        </div>
        <div class="m-eyebrow"><span class="m-tag rust">LEVEL 4</span><span>几猫中心 · 42 层</span><span class="m-dim">22:47 · 封锁中</span></div>
        <h1 class="m-word">抢救<span class="m-subtitle">老板</span></h1>
        <p class="m-premise">一伙劫匪在收盘后封锁了 42 层，老板被困在 CEO 办公室。<br>逐间清剿劫匪——清空全层后，去 CEO 办公室找到他。</p>
        <div class="m-brief">
          <div><span>区域</span><b>5 个房间 + 大堂</b></div>
          <div><span>目标物</span><b>劫匪 · 共 10 名</b></div>
          <div><span>胜 利 条 件</span><b>击败全部 + 找到老板</b></div>
          <div><span>营 救 点</span><b>CEO 办公室</b></div>
        </div>
        <div class="m-actions">
          <button class="btn primary" data-act="deploy">进入 42 层</button>
          <button class="btn" data-act="settings">设置</button>
          <button class="btn" data-act="controls">操作说明</button>
          <button class="btn" data-act="about">任务简报</button>
        </div>
        <p class="m-note">鼠标点击画面锁定视角 · 触屏设备自动启用虚拟按键</p>
      </div>
      <aside class="m-legend" aria-label="操作速览">
        <div><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动</span><span><kbd>鼠标</kbd> 视角</span><span><kbd>左键</kbd> 射击</span></div>
        <div><span><kbd>右键</kbd> 瞄准</span><span><kbd>R</kbd> 换弹</span><span><kbd>E</kbd> 营救 / 撤离</span><span><kbd>F</kbd> 近战</span></div>
        <div><span><kbd>Space</kbd> 跳跃</span><span><kbd>Shift</kbd> 冲刺</span><span><kbd>C</kbd> 蹲伏</span><span><kbd>Esc</kbd> 暂停</span></div>
        <div class="lg-touch"><em>触屏操作</em><span>左半屏滑动移动</span><span>右半屏拖动视角</span><span>按钮：开火 / 瞄准 / 换弹 / 跳跃</span></div>
      </aside>
    </section>`,
    paused: `
    <section class="m-screen m-card" data-s="paused" aria-label="已暂停">
      <div class="m-k">行动暂时中止</div>
      <h2 class="m-h">已暂停</h2>
      <p class="m-line" data-f="pause-line">42F · 劫匪仍在楼层内</p>
      <div class="m-actions col">
        <button class="btn primary" data-act="resume">继续行动</button>
        <button class="btn" data-act="settings">设置</button>
        <button class="btn" data-act="controls">操作说明</button>
        <button class="btn" data-act="restart">重新开始任务</button>
      </div>
    </section>`,
    dead: `
    <section class="m-screen m-card m-dead" data-s="dead" aria-label="行动失败">
      <div class="m-k">行动失败</div>
      <h2 class="m-h">信号中断</h2>
      <p class="m-line">老板仍在 42 层。劫匪控制了这一整层。</p>
      <dl class="m-stats">
        <div><dt>坚持时间</dt><dd id="dead-time">00:00</dd></div>
        <div><dt>击倒劫匪</dt><dd id="dead-kills">0</dd></div>
      </dl>
      <div class="m-actions col"><button class="btn primary" data-act="retry">重新进入</button></div>
    </section>`,
    complete: `
    <section class="m-screen m-card m-debrief" data-s="complete" aria-label="行动简报">
      <div class="m-k">42F · 行动简报</div>
      <h2 class="m-h">老板已安全撤离</h2>
      <div class="m-rating"><span>行动评级</span><b id="w-rating">A</b></div>
      <div class="m-rooms" id="w-rooms"></div>
      <dl class="m-stats">
        <div><dt>用时</dt><dd id="w-time">00:00</dd></div>
        <div><dt>命中率</dt><dd id="w-acc">0%</dd></div>
        <div><dt>击倒劫匪</dt><dd id="w-kills">0</dd></div>
        <div><dt>救出人质</dt><dd id="w-hosts">0/4</dd></div>
        <div><dt>重试次数</dt><dd id="w-retries">0</dd></div>
      </dl>
      <div class="m-actions col"><button class="btn primary" data-act="redeploy">再次进入</button></div>
    </section>`,
    panel: `
    <div class="panel" role="dialog" aria-modal="true" aria-label="设置与操作" tabindex="-1" hidden>
      <header class="panel-h">
        <div class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="settings" aria-selected="true">设置</button>
          <button class="tab" role="tab" data-tab="controls" aria-selected="false">操作</button>
          <button class="tab" role="tab" data-tab="about" aria-selected="false">简报</button>
        </div>
        <button class="btn small" data-act="close-panel">关闭</button>
      </header>
      <div class="panel-b about-copy" data-pane="about" hidden>
        <h3>任务简报 · 42F</h3>
        <p>22:47，五名持械人员从货梯进入 42 层，控制了前台与员工区。安保系统被切断，电梯锁定在本层。</p>
        <p>目标：<strong>清剿五处区域的劫匪</strong>（CEO 办公室、CFO 办公室、会议室、茶水间、员工办公大厅），随后进入 CEO 办公室<strong>营救老板</strong>。清空全层之前，老板不会跟你走。</p>
        <p>楼层布局：南侧是<strong>前台大堂</strong>与电梯厅；中部为<strong>员工办公大厅</strong>；北侧为<strong>会议室</strong>；东西两翼分别是<strong>CFO 办公室</strong>与<strong>CEO 办公室</strong>；西北角是<strong>茶水间</strong>。</p>
        <p>每个房间都有劫匪与人质。人质可解开束缚，他们会自行撤离；医疗包与弹药散落在楼层各处。</p>
        <p class="panel-note">难度提示：劫匪会在听到枪声后进入警戒并搜索；正面遭遇时他们会拉开距离、侧移并点射。蹲下可降低被发现概率与后坐，瞄准镜能显著提升精度。</p>
      </div>
      <div class="panel-b" data-pane="settings">
        <div class="row"><label id="l-q">画面质量</label>
          <div class="seg" role="group" aria-labelledby="l-q">
            <button data-q="low" aria-pressed="false">流畅</button>
            <button data-q="medium" aria-pressed="false">均衡</button>
            <button data-q="high" aria-pressed="true">精细</button>
          </div>
        </div>
        <div class="row"><label for="s-sens">鼠标灵敏度</label><div class="slider"><input id="s-sens" type="range" min="0.2" max="2.4" step="0.05" value="1"><output id="o-sens">1.00</output></div></div>
        <div class="row"><label id="l-inv">反转垂直视角</label><button class="toggle" data-act="invert" aria-labelledby="l-inv" aria-pressed="false"><i></i><span>关</span></button></div>
        <div class="row"><label for="s-vol">主音量</label><div class="slider"><input id="s-vol" type="range" min="0" max="1" step="0.02" value="0.8"><output id="o-vol">80%</output></div></div>
        <div class="row"><label for="s-fov">视野范围</label><div class="slider"><input id="s-fov" type="range" min="60" max="100" step="1" value="82"><output id="o-fov">82°</output></div></div>
        <p class="panel-note">画面质量会同时影响分辨率倍率与动态调光。若帧率偏低，可先切到“均衡”。</p>
      </div>
      <div class="panel-b" data-pane="controls" hidden>
        <h3>键盘 · 鼠标</h3>
        <dl class="keys">
          <div><dt>移动</dt><dd><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dd></div>
          <div><dt>视角</dt><dd>鼠标</dd></div>
          <div><dt>开火</dt><dd>鼠标左键</dd></div>
          <div><dt>瞄准</dt><dd>鼠标右键</dd></div>
          <div><dt>换弹</dt><dd><kbd>R</kbd></dd></div>
          <div><dt>营救 / 撤离</dt><dd>按住 <kbd>E</kbd></dd></div>
          <div><dt>近战</dt><dd><kbd>F</kbd></dd></div>
          <div><dt>跳跃</dt><dd><kbd>Space</kbd></dd></div>
          <div><dt>冲刺</dt><dd><kbd>Shift</kbd></dd></div>
          <div><dt>蹲伏</dt><dd><kbd>C</kbd></dd></div>
          <div><dt>静音</dt><dd><kbd>M</kbd></dd></div>
          <div><dt>暂停</dt><dd><kbd>Esc</kbd> / <kbd>P</kbd></dd></div>
        </dl>
        <p class="panel-note">若浏览器无法锁定鼠标，按住左键拖动也能转动视角（同时开火）。</p>
        <h3>触屏</h3>
        <dl class="keys">
          <div><dt>移动</dt><dd>左半屏滑动</dd></div>
          <div><dt>视角</dt><dd>右半屏拖动</dd></div>
          <div><dt>开火 / 瞄准</dt><dd>屏幕右下按钮</dd></div>
          <div><dt>换弹 / 跳跃</dt><dd>右侧按钮</dd></div>
          <div><dt>营救</dt><dd>靠近后按住“交互”</dd></div>
        </dl>
      </div>
    </div>`,
    about: `
    <section class="m-screen m-card" data-s="about" aria-label="关于">
      <div class="m-k">几猫资本 · 42 层</div>
      <h2 class="m-h">关于</h2>
      <p class="m-line">一个室内第一人称营救任务：五间办公室、十名劫匪、一位老板。</p>
      <div class="dossier"><b>提示</b> · 听声音。枪声会把整层楼的劫匪引向你；救出的人质会自己跑向电梯。</div>
      <div class="m-actions col"><button class="btn primary" data-act="close-panel">返回</button></div>
    </section>`
  };

  let menusEl, panelEl, curScreen = null;

  function setupMenus() {
    const host = $('menus');
    host.innerHTML =
      `<div class="menu" id="menu">
         <div class="m-veil"></div>
         <div class="m-bars"><i></i><i></i></div>
         ${MENUS.title}${MENUS.paused}${MENUS.dead}${MENUS.complete}
         ${MENUS.panel}
       </div>`;
    menusEl = $('menu');
    panelEl = menusEl.querySelector('.panel');

    menusEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b) { act(b.dataset.act); return; }
      const t = e.target.closest('[data-tab]');
      if (t) { tab(t.dataset.tab); return; }
      const q = e.target.closest('[data-q]');
      if (q) { setQuality(q.dataset.q); return; }
    });

    // settings wiring
    const sens = $('s-sens'), vol = $('s-vol'), fov = $('s-fov');
    sens.addEventListener('input', () => {
      settings.sens = parseFloat(sens.value);
      $('o-sens').textContent = settings.sens.toFixed(2);
    });
    vol.addEventListener('input', () => {
      settings.volume = parseFloat(vol.value);
      $('o-vol').textContent = Math.round(settings.volume * 100) + '%';
      SFX.setVolume(settings.volume);
    });
    fov.addEventListener('input', () => {
      settings.fov = parseFloat(fov.value);
      $('o-fov').textContent = Math.round(settings.fov) + '°';
      if (!player.sprinting) camera.fov = settings.fov;
      camera.updateProjectionMatrix();
    });
    SFX.setVolume(settings.volume);

    // load saved settings
    try {
      const s = JSON.parse(localStorage.getItem('rescue-boss-settings') || 'null');
      if (s) {
        Object.assign(settings, s);
        sens.value = settings.sens; $('o-sens').textContent = settings.sens.toFixed(2);
        vol.value = settings.volume; $('o-vol').textContent = Math.round(settings.volume * 100) + '%';
        fov.value = settings.fov; $('o-fov').textContent = Math.round(settings.fov) + '°';
        setQuality(settings.quality, true);
        if (camera) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
        SFX.setVolume(settings.volume);
      }
    } catch (e) { }

    // mute toggle key
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) toggleMute();
    });
  }

  function saveSettings() {
    try { localStorage.setItem('rescue-boss-settings', JSON.stringify(settings)); } catch (e) { }
  }

  function setQuality(q, silent) {
    settings.quality = q;
    menusEl.querySelectorAll('[data-q]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.q === q ? 'true' : 'false'));
    applyQuality();
    if (!silent) { saveSettings(); resize(); }
  }

  function applyQuality() {
    const q = settings.quality;
    if (post) {
      post.bloom = q !== 'low';
      post.grain = q === 'low' ? 0.02 : q === 'medium' ? 0.022 : 0.026;
    }
    if (!renderer) return;
    const shadows = q !== 'low';
    renderer.shadowMap.enabled = shadows;
    if (LV.sun) {
      LV.sun.castShadow = shadows;
      const size = q === 'high' ? 2048 : 1024;
      if (LV.sun.shadow.mapSize.x !== size) {
        LV.sun.shadow.mapSize.set(size, size);
        if (LV.sun.shadow.map) { LV.sun.shadow.map.dispose(); LV.sun.shadow.map = null; }
      }
    }
  }

  function toggleMute() {
    SFX.setMuted(!SFX.muted);
    HUD.msg(SFX.muted ? '已静音' : '声音已开启', 1.6);
  }

  function tab(name) {
    menusEl.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === name ? 'true' : 'false'));
    menusEl.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== name; });
  }

  function showMenu(screen) {
    curScreen = screen;
    menusEl.classList.add('open');
    menusEl.dataset.screen = screen;
    panelEl.hidden = true;
    if (screen === 'paused') {
      $('pause-line').textContent = `42F · 还剩 ${G.robbersLeft} 名劫匪`;
    }
    SFX.setAmbient(0.5);
  }

  function hideMenus() {
    menusEl.classList.remove('open');
    menusEl.dataset.screen = '';
    panelEl.hidden = true;
    curScreen = null;
  }

  function act(a) {
    switch (a) {
      case 'deploy':
        SFX.init(); SFX.resume();
        hideMenus(); startGame();
        break;
      case 'resume':
        hideMenus(); resumeGame();
        break;
      case 'settings': case 'controls': case 'about':
        openPanel(a);
        break;
      case 'close-panel':
        panelEl.hidden = true;
        if (curScreen === null) hideMenus();
        break;
      case 'restart': case 'retry': case 'redeploy':
        hideMenus();
        G.retries++;
        restart();
        break;
      default: break;
    }
  }

  function openPanel(tabName) {
    menusEl.classList.add('open');
    menusEl.dataset.screen = menusEl.dataset.screen || 'title';
    panelEl.hidden = false;
    tab(tabName === 'settings' || tabName === 'controls' || tabName === 'about' ? tabName : 'settings');
  }

  /* ============================================================== state */
  function startGame() {
    G.running = true;
    G.paused = false;
    G.time = 0;
    G.robberKills = 0;
    G.shotsFired = 0;
    G.shotsHit = 0;
    G.hostagesFreed = 0;
    G.visited = {};
    G.firstSpotted = false;
    G.alertLevel = 0;
    G.bossFreed = false;
    G.ended = false;
    player.hp = 100;
    player.alive = true;
    weapon.gun.visible = true;
    HUD.lastLocRoom = null;
    HUD.el.hud.classList.add('on');
    HUD.location('前台大堂', 'RECEPTION · 42F 几猫中心');
    G.graceT = 4;
    SFX.setAmbient(1);
    // request pointer lock (needs a user gesture — the deploy click counts)
    try {
      const pr = canvas.requestPointerLock();
      if (pr && pr.catch) pr.catch(() => { });
    } catch (e) { }
    setTimeout(() => {
      if (G.running && !input.pointerLocked && !isTouch) HUD.msg('点击画面锁定鼠标视角', 3);
    }, 2600);
    if (!G.introDone) {
      G.introDone = true;
      setTimeout(() => HUD.say('队长 · 无线电', '42 层被封锁了。五个房间都要过一遍，找到陈董再撤。', 5), 900);
      setTimeout(() => HUD.say('陈立群 · CEO', '……有人吗？我在 CEO 办公室……别开枪，别开枪！', 4.6), 6200);
    }
  }

  function resumeGame() {
    G.running = true;
    G.paused = false;
    try {
      const pr = canvas.requestPointerLock();
      if (pr && pr.catch) pr.catch(() => { });
    } catch (e) { }
    SFX.setAmbient(1);
  }

  function pauseGame() {
    if (!G.running) return;
    G.paused = true;
    G.running = false;
    input.fire = false; input.ads = false;
    document.exitPointerLock && document.exitPointerLock();
    showMenu('paused');
  }

  function restart() {
    // reset level actors
    for (const rb of robbers) scene.remove(rb.rig.root);
    for (const h of hostages) scene.remove(h.rig.root);
    if (boss) scene.remove(boss.rig.root);
    for (const p of pickups) scene.remove(p.mesh);
    for (const r of LV.rooms) r.total = 0;
    spawnActors();

    player.pos.set(LV.spawn.x, 0, LV.spawn.z);
    player.vel.set(0, 0, 0);
    player.yaw = 0; player.pitch = 0;
    player.hp = 100; player.alive = true; player.grounded = true; player.pos.y = 0;
    weapon.reset();
    weapon.gun.visible = true;
    post.hurt = 0;
    HUD.hurtT = 0;
    HUD.commQueue.length = 0;
    HUD.el.comms.classList.remove('on'); HUD.commT = 0;
    HUD.msgT = 0; HUD.el.msg.classList.remove('on');
    HUD.el.health.classList.remove('on');
    startGame();
  }

  /* ============================================================== go */
  function boot() {
    try {
      init();
      clock = { t: 0 };
      requestAnimationFrame(rafLoop);
      // watchdog: keep the simulation alive when rAF is throttled or occluded
      setInterval(() => {
        if (!G.lastTs || performance.now() - G.lastTs > 180) {
          try { tick(); } catch (e) { }
        }
      }, 90);
    } catch (e) {
      fatal.textContent = 'FAILED: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n');
      console.error(e);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 0);
  else window.addEventListener('DOMContentLoaded', boot);

  // debug surface for automated checks
  G.debug = {
    fps: () => G.fps,
    state: () => ({
      running: G.running, left: G.robbersLeft, hp: player.hp,
      pos: [player.pos.x, player.pos.z], rooms: JSON.parse(JSON.stringify(G.roomState)),
      errors: window.__errors, fps: Math.round(G.fps)
    }),
    teleport: (x, z) => { player.pos.set(x, 0, z); },
    probe: () => ({
      focus: G.focusInteract ? G.focusInteract.kind : null,
      t: +G.interactT.toFixed(2),
      keys: Object.keys(keys).filter(k => keys[k]),
      boss: [boss.pos.x, boss.pos.z], free: G.bossFreed,
      room: G.playerRoom ? G.playerRoom.id : null,
      pos: [+player.pos.x.toFixed(2), +player.pos.z.toFixed(2)],
      shots: G.shotsFired || 0, hits: G.shotsHit || 0, mag: weapon.mag,
      resets: G.interactResets || 0,
      frames: G.frames || 0, dtLast: +(G.lastDt || 0).toFixed(3), running: G.running
    }),
    look: (yaw, pitch) => { player.yaw = yaw; player.pitch = pitch; },
    start: () => { hideMenus(); startGame(); },
    timeScale: (k) => { G.timeScale = k; },
    press: (on) => { input.interact = !!on; },
    god: (on) => { G.god = !!on; },
    photo: (on) => {
      document.getElementById('ui').style.opacity = on ? '0' : '';
      weapon.gun.visible = !on && player.alive;
    },
    hudHide: (on) => { document.getElementById('hud').style.opacity = on ? '0' : ''; },
    aimAt: (x, y, z) => {
      const dx = x - camera.position.x, dy = y - camera.position.y, dz = z - camera.position.z;
      player.yaw = Math.atan2(-dx, -dz);
      player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    robberHead: (i) => {
      const r = robbers[i];
      return r ? [r.pos.x, r.pos.y + r.height - 0.16, r.pos.z] : null;
    },
    killAll: () => { for (const r of robbers) if (r.state !== 3) { r.hit(999, false); onRobberKilled(r, false); } }
  };
})(window);
