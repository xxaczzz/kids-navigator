// Mini game "Тушим пожар": the fire truck stands in front of a house, Kostya points the water cannon at burning windows.
// window.FireGame.start({ say, audio, onDone })
(function () {
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const GOAL = 8, HOLD = 1.5, MAX_FIRES = 2; // 8 fires to win, 1.5 s of water puts one out, at most 2 burn at once
  // window glass in the house picture (941 x 1672): 3 columns x 3 rows
  const COLS = [[140, 326], [379, 565], [616, 802]], ROWS = [[418, 562], [661, 806], [906, 1052]];
  const WINS = []; for (const r of ROWS) for (const c of COLS) WINS.push({ x0: c[0], x1: c[1], y0: r[0], y1: r[1] });
  let st = null;
  function start(o) {
    if (st) return;
    const root = document.createElement('div');
    root.id = 'fireGame';
    root.innerHTML = '<canvas></canvas><button class="fgClose" aria-label="Закрыть">✕</button><div class="fgHint" hidden></div><button class="fgGo hidden">' + (o.goLabel || 'Поехали дальше 🚒') + '</button>';
    document.body.appendChild(root);
    const cv = root.querySelector('canvas'), g = cv.getContext('2d'), hint = root.querySelector('.fgHint');
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const pic = n => { const i = new Image(); i.src = 'img/' + n; return i; };
    const IM = { bg: pic('fire_bg.jpg'), truck: pic('fire_truck.png'), cannon: pic('fire_cannon.png'), flame: pic('fire_flame.png'), flameS: pic('fire_flame_s.png'), drop: pic('fire_i_drop.png') };
    const SAVED = [pic('fire_kid.png'), pic('fire_cat.png'), pic('fire_grandma.png')];
    const ok = i => i.complete && i.naturalWidth;
    let W = 0, H = 0, bgBox = null, truck = null;
    function layout() {
      const bw = 941, bh = 1672, kb = Math.max(W / bw, H / bh);
      bgBox = { x: (W - bw * kb) / 2, y: (H - bh * kb) / 2, w: bw * kb, h: bh * kb, k: kb };
      const tw = Math.min(W * 0.5, 260), th = tw * 554 / 480;
      truck = { w: tw, h: th, x: (W - tw) / 2, y: H - th - 6 };
    }
    const fit = () => { W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; layout(); };
    const winRect = i => { const w = WINS[i], b = bgBox; return { x: b.x + w.x0 * b.k, y: b.y + w.y0 * b.k, w: (w.x1 - w.x0) * b.k, h: (w.y1 - w.y0) * b.k }; };
    // the cannon turns on the round plate on the truck roof; its nozzle is 83% of its height above the pivot
    const pivot = () => { const ty = truck.y + (st.phase === 'arrive' ? st.slide : 0); return [truck.x + truck.w * 0.501, ty + truck.h * 0.284]; };
    const cannonH = () => truck.w * 0.62;

    st = { root, phase: 'arrive', t0: performance.now(), slide: 400, fires: [], saved: [], score: 0, spawned: 0, nextSpawn: 0, ptr: null, aim: -0.0, lastHit: performance.now(), lastNudge: 0, puffs: [], drops: [], sparks: [], pops: [] };
    const setPhase = p => { st.phase = p; hint.textContent = p; };
    setPhase('arrive');

    // ---- sounds ----
    const BUF = {};
    async function buf(name) { const a = o.audio && o.audio(); if (!a) return null; if (BUF[name] !== undefined) return BUF[name]; try { BUF[name] = await a.decodeAudioData(await (await fetch('snd/' + name + '.mp3')).arrayBuffer()); } catch (e) { BUF[name] = null; } return BUF[name]; }
    ['fire_siren', 'fire_crackle', 'fire_out', 'wash_water', 'wash_shine'].forEach(buf);
    async function once(name, vol = 0.9) { const a = o.audio && o.audio(), b = await buf(name); if (!a || !b || !st) return; const s = a.createBufferSource(), gg = a.createGain(); gg.gain.value = vol; s.buffer = b; s.connect(gg).connect(a.destination); s.start(); }
    const loops = {};
    // a looping sound that fades to the wanted volume (0 = silent)
    function loopTo(name, vol) {
      const a = o.audio && o.audio(); if (!a) return;
      let l = loops[name];
      if (!l) { if (!vol) return; const b = BUF[name]; if (!b) return; const s = a.createBufferSource(), gg = a.createGain(); s.buffer = b; s.loop = true; gg.gain.value = 0; s.connect(gg).connect(a.destination); s.start(0, Math.random() * Math.max(0, b.duration - 1)); l = loops[name] = { s, g: gg, v: 0 }; }
      if (l.v !== vol) { l.v = vol; l.g.gain.setTargetAtTime(vol, a.currentTime, 0.12); }
    }
    const stopLoops = () => { for (const k in loops) { try { loops[k].s.stop(); } catch (e) { } } };

    // the trip already started with h21 and the siren; a game opened on its own starts with them here
    if (!o.onCall) { o.say('Внимание! Выезжаем тушить пожар!', ['h21']); once('fire_siren', 0.8); }

    // ---- fires ----
    function spawn(now) {
      const busy = new Set([...st.fires.map(f => f.i), ...st.saved.map(s => s.i)]);
      const free = WINS.map((_, i) => i).filter(i => !busy.has(i)); if (!free.length) return;
      const i = free[Math.floor(Math.random() * free.length)];
      st.fires.push({ i, hp: 1, born: now }); st.spawned++;
      if (st.spawned === 1) o.say('Пожар! Надо тушить!', ['h22']);
    }
    function putOut(f, now) {
      st.fires.splice(st.fires.indexOf(f), 1); st.score++;
      once('fire_out', 1);
      const r = winRect(f.i);
      for (let k = 0; k < 14; k++) st.puffs.push({ x: r.x + r.w * Math.random(), y: r.y + r.h * (0.3 + Math.random() * 0.5), r: 10 + Math.random() * 14, vy: -40 - Math.random() * 50, vx: (Math.random() - .5) * 30, life: 1.4, steam: true });
      st.saved.push({ i: f.i, im: SAVED[(st.score - 1) % SAVED.length], t: now });
      st.pops.push({ k: st.score - 1, t: now });
      if (st.score >= GOAL) { setTimeout(win, 900); return; }
      // praise the first one and then only now and then, so it does not get boring
      if (st.score === 1 || Math.random() < 0.4) o.say('Молодец! Потушили!', ['h24']);
      st.nextSpawn = now + 1400;
    }
    function win() {
      if (!st || st.phase === 'win') return;
      setPhase('win'); loopTo('fire_crackle', 0); loopTo('wash_water', 0); st.ptr = null;
      o.say('Ура! Все пожары потушены!', ['h25']); once('wash_shine');
      root.querySelector('.fgGo').classList.remove('hidden');
      for (let i = 0; i < 140; i++) st.sparks.push({ x: W / 2, y: H * 0.35, vx: (Math.random() - .5) * 700, vy: -Math.random() * 650 - 150, r: Math.random() * 6, vr: (Math.random() - .5) * 12, col: ['#F2545B', '#FFD23F', '#5BB8F5', '#7BC96F', '#9B7BE0'][i % 5], life: 3 + Math.random() });
    }

    // ---- finger: where it touches, the water lands ----
    const down = e => { if (st.phase !== 'play') return; st.ptr = [e.clientX, e.clientY]; };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', e => { if (st.ptr) st.ptr = [e.clientX, e.clientY]; });
    const up = () => { if (!st) return; st.ptr = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);

    const close = why => { if (!st) return; stopLoops(); cancelAnimationFrame(st.raf); root.remove(); st = null; removeEventListener('resize', fit); o.onDone && o.onDone(why); };
    root.querySelector('.fgClose').onclick = () => close('close');
    root.querySelector('.fgGo').onclick = () => close('go');
    addEventListener('resize', fit); fit();

    // the water stream: an arc from the nozzle up and over onto the target
    const curve = (a, b) => { const d = Math.hypot(b[0] - a[0], b[1] - a[1]); return [a, [(a[0] + b[0]) / 2, Math.min(a[1], b[1]) - d * 0.22], b]; };
    const bez = (c, f) => { const [a, m, b] = c, u = 1 - f; return [u * u * a[0] + 2 * u * f * m[0] + f * f * b[0], u * u * a[1] + 2 * u * f * m[1] + f * f * b[1]]; };

    let last = performance.now();
    function frame(now) {
      if (!st) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      // the truck drives up from below with the siren, then the game starts
      if (st.phase === 'arrive') { st.slide = Math.max(0, st.slide - dt * 320); if (st.slide === 0 && now - st.t0 > 2600) { setPhase('play'); st.nextSpawn = now + 600; } }
      if (st.phase === 'play') {
        const want = st.score < 2 ? 1 : MAX_FIRES;
        if (st.fires.length < want && st.spawned < GOAL && now > st.nextSpawn) { spawn(now); st.nextSpawn = now + 2200; }
        // Kostya has not hit a fire for a while: say where to aim and show a hand
        if (st.fires.length && now - st.lastHit > 5000 && now - st.lastNudge > 12000) { st.lastNudge = now; o.say('Направляй воду на огонь!', ['h23']); }
      }
      loopTo('fire_crackle', st.phase === 'play' && st.fires.length ? 0.7 : 0);
      loopTo('wash_water', st.ptr ? 0.8 : 0);

      // background house
      if (ok(IM.bg)) g.drawImage(IM.bg, bgBox.x, bgBox.y, bgBox.w, bgBox.h); else { g.fillStyle = '#31B1FD'; g.fillRect(0, 0, W, H); }

      // water target and hits
      const pv = pivot(), CH = cannonH();
      let tgt = st.ptr, hitting = null;
      if (tgt) {
        for (const f of st.fires) { const r = winRect(f.i), pad = 22; if (tgt[0] > r.x - pad && tgt[0] < r.x + r.w + pad && tgt[1] > r.y - pad && tgt[1] < r.y + r.h + pad) { hitting = f; break; } }
      }
      for (const f of st.fires.slice()) {
        if (f === hitting) { f.hp -= dt / HOLD; st.lastHit = now; if (f.hp <= 0) putOut(f, now); }
        else f.hp = Math.min(1, f.hp + dt * 0.12); // a fire left alone slowly grows back
      }
      if (st.fires.length === 0) st.lastHit = now;

      // burning windows: orange glow inside the glass, flames and smoke
      for (const f of st.fires) {
        const r = winRect(f.i), fl = 0.75 + 0.25 * Math.sin(t * 9 + f.i) * Math.sin(t * 5.3 + f.i * 2);
        g.fillStyle = `rgba(255,${120 + 60 * fl | 0},40,${0.55 + 0.3 * f.hp})`; g.beginPath(); g.roundRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8, 10); g.fill();
        const big = f.hp > 0.5, im = big ? IM.flame : IM.flameS, s = (0.5 + 0.5 * f.hp) * (1 + 0.06 * Math.sin(t * 11 + f.i));
        if (ok(im)) { const w = r.w * 0.85 * s, h = w * im.naturalHeight / im.naturalWidth; g.save(); g.translate(r.x + r.w / 2, r.y + r.h - 6); g.rotate(Math.sin(t * 6 + f.i) * 0.06); g.drawImage(im, -w / 2, -h, w, h); g.restore(); }
        if (Math.random() < dt * 6 * f.hp) st.puffs.push({ x: r.x + r.w * (0.3 + Math.random() * 0.4), y: r.y, r: 8 + Math.random() * 8, vy: -50 - Math.random() * 30, vx: (Math.random() - .5) * 20, life: 1.6 });
        // a hand points at the fire when Kostya is not aiming at it
        if (st.phase === 'play' && now - st.lastHit > 5000) { g.font = '40px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('👆', r.x + r.w / 2, r.y + r.h + 30 + Math.abs(Math.sin(t * 6)) * 12); }
      }
      // rescued friends wave from the window for a moment
      for (let i = st.saved.length - 1; i >= 0; i--) {
        const s = st.saved[i], age = (now - s.t) / 1000; if (age > 2.6) { st.saved.splice(i, 1); continue; }
        const r = winRect(s.i), a = age < 0.3 ? age / 0.3 : age > 2.2 ? (2.6 - age) / 0.4 : 1;
        if (ok(s.im)) { const w = r.w * 0.82, h = w * s.im.naturalHeight / s.im.naturalWidth, rise = (1 - Math.min(1, age / 0.35)) * 30; g.save(); g.globalAlpha = a; g.beginPath(); g.rect(r.x, r.y - r.h, r.w, r.h * 2); g.clip(); g.translate(r.x + r.w / 2, r.y + r.h + rise); g.rotate(Math.sin(age * 8) * 0.07); g.drawImage(s.im, -w / 2, -h, w, h); g.restore(); }
      }
      // smoke and steam
      for (let i = st.puffs.length - 1; i >= 0; i--) { const p = st.puffs[i]; p.life -= dt; if (p.life <= 0) { st.puffs.splice(i, 1); continue; } p.x += p.vx * dt; p.y += p.vy * dt; p.r += dt * 14; g.fillStyle = p.steam ? `rgba(255,255,255,${p.life * 0.55})` : `rgba(90,90,100,${p.life * 0.3})`; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); }

      // the cannon follows the finger, otherwise slowly stands up straight
      const want = tgt ? clamp(Math.atan2(tgt[0] - pv[0], pv[1] - tgt[1]), -1.25, 1.25) : st.aim * 0.98;
      st.aim += (want - st.aim) * Math.min(1, dt * 14);
      const nz = [pv[0] + Math.sin(st.aim) * CH * 0.83, pv[1] - Math.cos(st.aim) * CH * 0.83];
      // the stream
      if (tgt) {
        const c = curve(nz, tgt);
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(60,150,240,.55)'; g.lineWidth = 16; g.beginPath(); g.moveTo(...c[0]); g.quadraticCurveTo(...c[1], ...c[2]); g.stroke();
        g.strokeStyle = 'rgba(170,225,255,.95)'; g.lineWidth = 7; g.beginPath(); g.moveTo(...c[0]); g.quadraticCurveTo(...c[1], ...c[2]); g.stroke();
        for (let q = 0; q < 16; q++) { const f = ((q / 16) + t * 2.5) % 1, [x, y] = bez(c, f); g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(x + Math.sin(t * 30 + q) * 3, y + Math.cos(t * 26 + q) * 3, 2.5 + f * 2.5, 0, TAU); g.fill(); }
        for (let k = 0; k < 3; k++) st.drops.push({ x: tgt[0], y: tgt[1], vx: (Math.random() - .5) * 280, vy: -Math.random() * 220 - 40, life: 0.55 });
      }
      // truck, beacons and the cannon on top
      const ty = truck.y + (st.phase === 'arrive' ? st.slide : 0) + (st.phase === 'arrive' && st.slide > 0 ? Math.sin(t * 30) * 1.5 : 0);
      g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.ellipse(W / 2, ty + truck.h - 4, truck.w * 0.45, 9, 0, 0, TAU); g.fill();
      if (ok(IM.truck)) g.drawImage(IM.truck, truck.x, ty, truck.w, truck.h);
      if (st.phase !== 'play' || now - st.t0 < 5000) { const on = Math.floor(now / 250) % 2; for (const [fx, col, ph] of [[0.34, '91,170,255', 0], [0.5, '255,220,60', 1], [0.66, '91,170,255', 0]]) { if ((on + ph) % 2) continue; const x = truck.x + truck.w * fx, y = ty + truck.h * 0.055, gr = g.createRadialGradient(x, y, 2, x, y, truck.w * 0.16); gr.addColorStop(0, `rgba(${col},.9)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.beginPath(); g.arc(x, y, truck.w * 0.16, 0, TAU); g.fill(); } }
      if (ok(IM.cannon)) { const ch = CH, cw = ch * IM.cannon.naturalWidth / IM.cannon.naturalHeight; g.save(); g.translate(pv[0], ty - truck.y + pv[1] - (st.phase === 'arrive' ? st.slide : 0)); g.rotate(st.aim); g.drawImage(IM.cannon, -cw / 2, -ch * 0.83, cw, ch); g.restore(); }

      for (let i = st.drops.length - 1; i >= 0; i--) { const d = st.drops[i]; d.vy += 900 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; if (d.life <= 0) { st.drops.splice(i, 1); continue; } g.fillStyle = `rgba(90,170,255,${d.life * 1.5})`; g.beginPath(); g.arc(d.x, d.y, 4, 0, TAU); g.fill(); }
      for (let i = st.sparks.length - 1; i >= 0; i--) { const c = st.sparks[i]; c.vy += 400 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.life -= dt; if (c.life <= 0) { st.sparks.splice(i, 1); continue; } g.save(); g.translate(c.x, c.y); g.rotate(c.r); g.fillStyle = c.col; g.fillRect(-5, -3, 10, 6); g.restore(); }

      // score at the top: 8 drop badges, a new one pops in for every fire put out
      const R = Math.min(19, (W - 90) / GOAL / 2 - 3), gap = 5, rowW = GOAL * 2 * R + (GOAL - 1) * gap, x0 = (W - 64 - rowW) / 2 + R, yy = 46;
      g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.roundRect(x0 - R - 8, yy - R - 7, rowW + 16, 2 * R + 14, R + 7); g.fill();
      for (let k = 0; k < GOAL; k++) {
        const x = x0 + k * (2 * R + gap), got = k < st.score, pop = st.pops.find(p => p.k === k), pa = pop ? (now - pop.t) / 400 : 1;
        const sc = got ? (pa < 1 ? 1 + 0.6 * Math.sin(pa * Math.PI) : 1) : 0.8;
        if (ok(IM.drop)) { g.save(); g.globalAlpha = got ? 1 : 0.28; g.translate(x, yy); g.scale(sc, sc); g.drawImage(IM.drop, -R, -R, 2 * R, 2 * R); g.restore(); }
      }
      st.raf = requestAnimationFrame(frame);
    }
    st.raf = requestAnimationFrame(frame);
  }
  window.FireGame = { start, get open() { return !!st; }, get fires() { return st ? st.fires.map(f => f.i) : []; }, get score() { return st ? st.score : 0; } };
})();
