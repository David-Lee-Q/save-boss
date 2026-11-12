/* hud.js — DOM HUD: compass, objective checklist, ammo/health, prompts, damage arcs, subtitles. */
(function (global) {
  'use strict';

  const H = {};

  H.init = function (G) {
    H.G = G;
    const $ = (id) => document.getElementById(id);
    H.$ = $;
    H.el = {
      hud: $('hud'), tape: $('tape'), heading: $('heading'), cmarks: $('cmarks'),
      obj: $('obj'), objTitle: $('objTitle'), objSub: $('objSub'), rooms: $('rooms'),
      alert: $('alert'),
      cross: $('cross'), hit: $('hit'), arcs: $('arcs'),
      prompt: $('prompt'), promptArc: $('promptArc'), promptKey: $('promptKey'), promptLabel: $('promptLabel'),
      feed: $('feed'), msg: $('msg'),
      health: $('health'), hpN: $('hpN'), hpBar: $('hpBar'),
      ammo: $('ammo'), ammoN: $('ammoN'), ammoR: $('ammoR'), pips: $('pips'), cue: $('cue'),
      marks: $('marks'),
      comms: $('comms'), commsWho: $('commsWho'), commsText: $('commsText'),
      loc: $('loc'), locT: $('locT'), locS: $('locS'),
      touch: $('touch'), tInteract: $('tInteract'),
      hurt: $('hurt')
    };

    H.buildCompass();
    H.buildHealth();
    H.buildPips();
    H.buildRooms();

    H.crossPieces = [...document.querySelectorAll('#cross i')];
    H.arcPool = [];
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'h-arc';
      d.innerHTML = '<svg viewBox="0 0 200 200"><path d="M20 100 A80 80 0 0 1 180 100"/><path class="tip" d="M20 100 L28 92 M180 100 L172 92"/></svg>';
      H.el.arcs.appendChild(d);
      H.arcPool.push({ el: d, t: 0 });
    }

    H.msgT = 0;
    H.feedItems = [];
    H.commQueue = [];
    H.commT = 0;
    H.hitT = 0;
    H.hurtT = 0;
    H.objFlashT = 0;
    H.lastRoom = null;
    H.lastLocRoom = null;
  };

  /* ---------------------------------------------------------------- compass */
  H.CARD = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
  H.CARDDIR = [0, 45, 90, 135, 180, 225, 270, 315];

  H.buildCompass = function () {
    const tape = H.el.tape;
    const pxPerDeg = 6.0;
    const SPAN = 360;
    H.pxPerDeg = pxPerDeg;
    tape.style.width = (SPAN * pxPerDeg) + 'px';
    let html = '';
    for (let d = 0; d < SPAN; d += 5) {
      const x = d * pxPerDeg;
      const cls = d % 45 === 0 ? 'mj' : d % 15 === 0 ? 'md' : 'mn';
      html += `<i class="${cls}" style="left:${x}px"></i>`;
      if (d % 45 === 0) {
        const label = H.CARD[(d / 45) % 8];
        html += `<b class="card" style="left:${x}px">${label}</b>`;
        html += `<b class="num" style="left:${x}px;top:15px">${String(d).padStart(3, '0')}</b>`;
      } else if (d % 15 === 0) {
        html += `<b class="num" style="left:${x}px;top:15px">${d % 360}</b>`;
      }
    }
    tape.innerHTML = html;
  };

  /* ---------------------------------------------------------------- build */
  H.buildHealth = function () {
    let h = '';
    const N = 10;
    for (let i = 0; i < N; i++) h += '<i></i>';
    H.el.hpBar.innerHTML = h;
    H.hpSegs = [...H.el.hpBar.children];
  };

  H.buildPips = function () {
    let h = '';
    for (let i = 0; i < WPN.mag; i++) h += '<i></i>';
    H.el.pips.innerHTML = h;
    H.pipEls = [...H.el.pips.children];
  };

  H.buildRooms = function () {
    const order = ['lobby', 'open', 'meet', 'ceo', 'cfo', 'pantry'];
    H.roomOrder = order;
    H.el.rooms.innerHTML = order.map((id) => {
      const r = LV.rooms.find((x) => x.id === id);
      return `<div class="h-room" data-room="${id}"><i></i><span>${r.name}</span><b>0/0</b></div>`;
    }).join('');
    H.roomEls = {};
    for (const id of order) H.roomEls[id] = H.el.rooms.querySelector(`[data-room="${id}"]`);
  };

  /* ---------------------------------------------------------------- update */
  H.update = function (dt, G) {
    const p = G.player;
    const cam = G.camera;

    // --- compass
    let yaw = p.yaw;                   // three.js: 0 looks down -Z
    let deg = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;   // heading, 0 = north(-Z)
    H.el.tape.style.transform = `translateX(${-(deg * H.pxPerDeg) + 210}px)`;
    H.el.heading.textContent = String(Math.round(deg) % 360).padStart(3, '0');

    // objective markers projected
    H.updateMarks(dt, G);

    // --- crosshair spread
    const sp = G.weapon.currentSpread();
    const fovK = (G.camera.fov * Math.PI / 180);
    const px = (sp / fovK) * window.innerHeight;
    const gap = U.clamp(6 + px * 0.9, 4, 46);
    H.crossPieces.forEach((el, i) => {
      const off = gap;
      if (i === 0) el.style.transform = `translate3d(-50%, ${-off - 9}px, 0)`;
      if (i === 1) el.style.transform = `translate3d(-50%, ${off}px, 0)`;
      if (i === 2) el.style.transform = `translate3d(${-off - 9}px, -50%, 0)`;
      if (i === 3) el.style.transform = `translate3d(${off}px, -50%, 0)`;
    });
    H.el.cross.classList.toggle('off', G.weapon.ads > 0.75 || !G.running || G.player.alive === false);

    // --- hit marker
    if (H.hitT > 0) {
      H.hitT -= dt;
      H.el.hit.style.opacity = U.clamp(H.hitT / 0.14, 0, 1);
      const s = 0.8 + (1 - U.clamp(H.hitT / 0.14, 0, 1)) * 0.6;
      H.el.hit.style.transform = `translate(-50%,-50%) scale(${s})`;
      if (H.hitT <= 0) H.el.hit.style.opacity = 0;
    }

    // --- damage arcs
    for (const a of H.arcPool) {
      if (a.t > 0) {
        a.t -= dt;
        a.el.style.opacity = U.clamp(a.t / 1.1, 0, 1);
        if (a.t <= 0) a.el.style.opacity = 0;
      }
    }

    // --- health
    const hp = Math.max(0, Math.round(p.hp));
    H.el.health.classList.toggle('on', hp < 100 || G.hurtPulse > 0.05);
    H.el.hpN.textContent = hp;
    const segs = Math.ceil(hp / 10);
    H.hpSegs.forEach((s, i) => s.classList.toggle('off', i >= segs));
    H.el.health.classList.toggle('crit', hp <= 30 && hp > 0);

    // --- hurt vignette
    H.hurtT = Math.max(0, H.hurtT - dt);
    H.el.hurt.classList.toggle('on', H.hurtT > 0 || hp <= 30);

    // --- ammo
    const w = G.weapon;
    H.el.ammoN.textContent = w.mag;
    H.el.ammoR.textContent = w.reserve;
    H.el.ammo.classList.toggle('low', w.mag <= 8);
    for (let i = 0; i < H.pipEls.length; i++) H.pipEls[i].classList.toggle('off', i >= w.mag);
    let cue = '';
    if (w.state === 'reloading') cue = '换弹中';
    else if (w.mag === 0) cue = '弹匣已空 · 按 R';
    else if (w.mag <= 8) cue = '按 R 换弹';
    H.el.cue.textContent = cue;
    H.el.cue.classList.toggle('on', !!cue);
    H.el.cue.classList.toggle('urgent', w.mag === 0);

    // --- prompt
    H.updatePrompt(G);

    // --- msg
    if (H.msgT > 0) {
      H.msgT -= dt;
      if (H.msgT <= 0) H.el.msg.classList.remove('on');
    }

    // --- feed
    for (let i = H.feedItems.length - 1; i >= 0; i--) {
      const f = H.feedItems[i];
      f.t -= dt;
      if (f.t <= 0) { f.el.classList.add('out'); if (f.t < -0.55) { f.el.remove(); H.feedItems.splice(i, 1); } }
    }

    // --- comms
    if (H.commT > 0) {
      H.commT -= dt;
      if (H.commT <= 0) {
        H.el.comms.classList.remove('on');
        if (H.commQueue.length) setTimeout(() => H.sayNext(), 260);
      }
    }

    // --- alert banner
    H.el.alert.classList.toggle('on', G.alertLevel > 0.5);

    // --- objective panel
    H.refreshObjectives(G);
  };

  H.updatePrompt = function (G) {
    const it = G.focusInteract;
    if (!it || !G.running) {
      H.el.prompt.classList.remove('on');
      H.el.tInteract.classList.remove('on');
      return;
    }
    H.el.prompt.classList.add('on');
    H.el.tInteract.classList.add('on');
    H.el.promptLabel.textContent = it.label || '交互';
    H.el.promptKey.textContent = it.key || 'E';
    H.el.promptKey.classList.toggle('wide', (it.key || 'E').length > 2);
    const k = it.hold ? U.clamp(G.interactT / (it.holdTime || 1.2), 0, 1) : 1;
    H.el.promptArc.setAttribute('stroke-dashoffset', String(125.6 * (1 - k)));
    H.el.prompt.classList.toggle('busy', k > 0.02 && k < 0.999);
  };

  H.refreshObjectives = function (G) {
    // rooms
    for (const id of H.roomOrder) {
      const room = LV.rooms.find((r) => r.id === id);
      const st = G.roomState[id];
      const el = H.roomEls[id];
      const known = st.discovered;
      el.classList.toggle('clear', known && (st.cleared || st.total === 0));
      el.classList.toggle('here', G.playerRoom && G.playerRoom.id === id);
      el.classList.toggle('unknown', !known);
      const b = el.querySelector('b');
      const txt = !known ? '未搜索' : st.total === 0 ? '安全' : `${st.killed}/${st.total}`;
      if (b.textContent !== txt) b.textContent = txt;
    }
    const left = G.robbersLeft;
    const allDown = left === 0;
    H.el.objSub.textContent = allDown
      ? (G.bossFreed ? '目标完成 · 与老板一同撤离' : '劫匪已全部清除 · 立即寻找老板')
      : `还剩 ${left} 名劫匪 · 老板下落不明`;
    H.el.objTitle.textContent = allDown ? '营救老板' : '清剿劫匪';
    H.el.obj.classList.add('has');
    if (G.objFlash > 0) {
      G.objFlash -= 1;
      H.el.obj.classList.remove('flash');
      void H.el.obj.offsetWidth;
      H.el.obj.classList.add('flash');
    }
  };

  H.updateMarks = function (dt, G) {
    // objective markers: rooms with robbers + the boss
    const p = G.player;
    const cam = G.camera;
    const v = new THREE.Vector3();
    const items = [];
    if (!G.bossFreed) {
      items.push({ x: LV.actors.boss.x, z: LV.actors.boss.z, label: '老板', cls: 'extract', y: 1.4 });
    } else {
      // extraction: the elevator
      items.push({ x: 1.75, z: 20.6, label: '撤离', cls: 'extract', y: 1.4 });
    }
    if (G.robbersLeft > 0) {
      for (const id of H.roomOrder) {
        const st = G.roomState[id];
        if (st.total - st.killed <= 0) continue;
        const room = LV.rooms.find((r) => r.id === id);
        items.push({ x: room.cx, z: room.cz, label: room.name.slice(0, 4), cls: '', y: 1.6, count: st.total - st.killed });
      }
    }

    // reuse DOM nodes
    if (!H.markEls) H.markEls = [];
    while (H.markEls.length < items.length) {
      const d = document.createElement('div');
      d.className = 'h-wm';
      d.innerHTML = '<i></i><b></b><span></span>';
      H.el.marks.appendChild(d);
      H.markEls.push(d);
    }
    H.markEls.forEach((el, i) => {
      const it = items[i];
      if (!it) { el.style.display = 'none'; return; }
      el.style.display = '';
      v.set(it.x, it.y, it.z);
      const dist = v.distanceTo(cam.position);
      v.project(cam);
      let sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      let sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      const behind = v.z > 1;
      let off = behind;
      if (behind) { sx = window.innerWidth - sx; sy = window.innerHeight - sy; }
      const m = 54;
      if (sx < m || sx > window.innerWidth - m || sy < m || sy > window.innerHeight - m) off = true;
      sx = U.clamp(sx, m, window.innerWidth - m);
      sy = U.clamp(sy, m, window.innerHeight - m);
      el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      el.className = 'h-wm' + (it.cls ? ' ' + it.cls : '') + (off ? ' offscreen' : '') + (dist < 3.2 ? ' near' : '') + (dist > 16 ? ' dim' : '');
      el.querySelector('b').textContent = it.label;
      el.querySelector('span').textContent = it.count ? it.count + ' 名' : Math.round(dist) + 'm';
    });
    // compass markers
    const cm = G.compassTargets();
    if (!H.cmEls) H.cmEls = [];
    while (H.cmEls.length < cm.length) {
      const d = document.createElement('div');
      d.className = 'h-cm';
      d.innerHTML = '<i></i><b></b><span></span>';
      H.el.cmarks.appendChild(d);
      H.cmEls.push(d);
    }
    H.cmEls.forEach((el, i) => {
      const t = cm[i];
      if (!t) { el.style.display = 'none'; return; }
      el.style.display = '';
      let deg = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
      let tb = ((Math.atan2(t.x - p.pos.x, -(t.z - p.pos.z)) * 180 / Math.PI) % 360 + 360) % 360;
      let rel = tb - deg;
      while (rel > 180) rel -= 360;
      while (rel < -180) rel += 360;
      const x = rel * H.pxPerDeg;
      const edge = Math.abs(rel) > 44;
      el.className = 'h-cm' + (t.cls ? ' ' + t.cls : '') + (edge ? ' edge' : '');
      el.style.transform = `translateX(${x}px)`;
      el.querySelector('b').textContent = t.label;
      el.querySelector('span').textContent = t.sub || '';
    });
  };

  /* ---------------------------------------------------------------- events */
  H.hitMarker = function (kind) {
    H.hitT = 0.14;
    H.el.hit.className = 'h-hit' + (kind === 'kill' ? ' kill' : kind === 'head' ? ' weak' : '');
    H.el.hit.style.opacity = 1;
  };

  H.damageFrom = function (x, z, G) {
    const p = G.player;
    const ang = Math.atan2(x - p.pos.x, -(z - p.pos.z)) * 180 / Math.PI;
    const deg = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
    let rel = ang - deg;
    while (rel > 180) rel -= 360;
    while (rel < -180) rel += 360;
    const a = H.arcPool.find((x2) => x2.t <= 0.2) || H.arcPool[0];
    a.t = 1.1;
    a.el.style.opacity = 1;
    a.el.style.transform = `translate(-50%,-50%) rotate(${rel}deg)`;
    H.hurtT = 0.42;
  };

  H.kill = function (name, head) {
    const d = document.createElement('div');
    d.className = 'h-fl';
    d.innerHTML = `你 <em>${head ? '爆头' : '击倒'}</em> ${name || '劫匪'}`;
    H.el.feed.appendChild(d);
    H.feedItems.push({ el: d, t: 4.2 });
    while (H.feedItems.length > 4) { const f = H.feedItems.shift(); f.el.remove(); }
  };

  H.msg = function (text, dur) {
    H.el.msg.textContent = text;
    H.el.msg.classList.add('on');
    H.msgT = dur || 2.6;
  };

  H.say = function (who, text, dur) {
    H.commQueue.push({ who, text, dur: dur || Math.max(2.6, text.length * 0.16) });
    if (H.commT <= 0) H.sayNext();
  };

  H.sayNext = function () {
    const n = H.commQueue.shift();
    if (!n) return;
    H.el.commsWho.textContent = n.who;
    H.el.commsText.textContent = n.text;
    H.el.comms.classList.add('on');
    H.commT = n.dur;
    SFX.radio();
  };

  H.location = function (title, sub) {
    H.el.locT.textContent = title;
    H.el.locS.textContent = sub;
    H.el.loc.classList.remove('on');
    void H.el.loc.offsetWidth;
    H.el.loc.classList.add('on');
    setTimeout(() => H.el.loc.classList.remove('on'), 4200);
  };

  global.HUD = H;
})(window);
