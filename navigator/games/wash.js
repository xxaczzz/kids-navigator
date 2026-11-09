// Mini game "Помой машинку": foam it, rinse it, dry it. Loaded only at the car wash.
// window.WashGame.start({ img, say, audio, onDone })
(function () {
  const TAU = Math.PI * 2, clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let st = null;
  function start(o) {
    if (st) return;
    const root = document.createElement('div');
    root.id = 'washGame';
    root.innerHTML = '<canvas></canvas><button class="wgClose" aria-label="Закрыть">✕</button><div class="wgHint" hidden></div><div class="wgBar" hidden><i></i></div><button class="wgGo hidden">Поехали дальше 🚗</button>';
    document.body.appendChild(root);
    const cv = root.querySelector('canvas'), g = cv.getContext('2d');
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const fit = () => { W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; layout(); };
    // car box: as big as fits, pointing up
    const im = o.img;
    // background picture, the floor line is at 72.7% of its height
    const bg = new Image(); bg.src = 'img/wash_bg.jpg'; let bgBox = null;
    const FLOOR = 0.727;
    const TOOL = {}; for (const k of ['foam', 'sponge', 'water', 'dryer']) { TOOL[k] = new Image(); TOOL[k].src = 'img/wash_t_' + k + '.png'; }
    TOOL.drop = new Image(); TOOL.drop.src = 'img/wash_i_water.png'; // the water step badge is a drop, the gun stays in the hand
    const tip = { foam: 0.47, water: 0.475 }; // nozzle x (fraction of picture width) at the top of the gun
    const STEPS = ['foam', 'scrub', 'water', 'dry'], STEP_ICON = { foam: 'foam', scrub: 'sponge', water: 'drop', dry: 'dryer' };
    let box = null;
    function layout() {
      const maxH = H * 0.5, maxW = W * 0.84, k = Math.min(maxH / im.height, maxW / im.width);
      const w = im.width * k, h = im.height * k;
      // the background covers the screen; the car's wheels stand on its floor line
      const bw = 941, bh = 1672, kb = Math.max(W / bw, H / bh);
      bgBox = { x: (W - bw * kb) / 2, y: (H - bh * kb) / 2, w: bw * kb, h: bh * kb };
      const floor = bgBox.y + bgBox.h * FLOOR;
      box = { x: (W - w) / 2, y: floor - h + h * 0.02, w, h };
    }
    // layers at picture resolution: car mask, dirt, foam
    const N = 360, k0 = N / Math.max(im.width, im.height), lw = Math.round(im.width * k0), lh = Math.round(im.height * k0);
    const mk = () => { const c = document.createElement('canvas'); c.width = lw; c.height = lh; return c; };
    const mask = mk(), mg = mask.getContext('2d'); mg.drawImage(im, 0, 0, lw, lh);
    const md = mg.getImageData(0, 0, lw, lh).data;
    const inCar = (x, y) => md[4 * (y * lw + x) + 3] > 120;
    // the foam may bulge past the car outline in round lumps of different size: a bumpy outline, never a smooth one
    const maskBig = mk(), mbg = maskBig.getContext('2d'); mbg.drawImage(mask, 0, 0); mbg.fillStyle = '#000';
    for (let y = 1; y < lh - 1; y += 3) for (let x = 1; x < lw - 1; x += 3) {
      if (!inCar(x, y)) continue;
      if (inCar(x - 2, y) && inCar(x + 2, y) && inCar(x, y - 2) && inCar(x, y + 2)) continue;
      if (Math.random() < 0.45) { mbg.beginPath(); mbg.arc(x, y, 3 + Math.random() * 9, 0, TAU); mbg.fill(); }
    }
    // bubble texture drawn over the foam: rings and little shines
    const tex = mk(), tg = tex.getContext('2d');
    for (let k = 0; k < 260; k++) { const x = Math.random() * lw, y = Math.random() * lh, r = 3 + Math.random() * 9; tg.strokeStyle = 'rgba(150,190,230,.55)'; tg.lineWidth = 1.2; tg.beginPath(); tg.arc(x, y, r, 0, TAU); tg.stroke(); tg.fillStyle = 'rgba(255,255,255,.9)'; tg.beginPath(); tg.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, TAU); tg.fill(); }
    const foamView = mk(), fvg = foamView.getContext('2d');
    const dirt = mk(), dg = dirt.getContext('2d'), foam = mk(), fg = foam.getContext('2d');
    // random mud spots, only on the car
    for (let i = 0; i < 22; i++) {
      const m = Math.min(lw, lh), x = lw * (0.1 + Math.random() * 0.8), y = lh * (0.15 + Math.random() * 0.75), r = m * (0.07 + Math.random() * 0.08);
      dg.fillStyle = ['#7A5230', '#8B6239', '#6B4526'][i % 3];
      // a round splash: a main blob of overlapping circles and a few drops around it
      for (let k = 0; k < 7; k++) { const a = Math.random() * TAU, d = Math.random() * r * 0.55; dg.beginPath(); dg.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.45 + Math.random() * 0.3), 0, TAU); dg.fill(); }
      for (let k = 0; k < 5; k++) { const a = Math.random() * TAU, d = r * (1.1 + Math.random() * 0.6); dg.beginPath(); dg.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.1 + Math.random() * 0.12), 0, TAU); dg.fill(); }
    }
    dg.globalCompositeOperation = 'destination-in'; dg.drawImage(mask, 0, 0); dg.globalCompositeOperation = 'source-over';
    // sample points on the car to measure progress
    const S = []; for (let y = 2; y < lh; y += 6) for (let x = 2; x < lw; x += 6) if (inCar(x, y)) S.push(4 * (y * lw + x));
    const cover = (c, want) => { const d = c.getContext('2d').getImageData(0, 0, lw, lh).data; let n = 0; for (const i of S) if ((d[i + 3] > 40) === want) n++; return n / S.length; };
    const GOAL = 0.85;

    st = { root, phase: 'foam', prog: 0, t0: performance.now(), sparks: [], drops: [], ptr: null, done: false };
    const hint = root.querySelector('.wgHint'), bar = root.querySelector('.wgBar i');
    const setPhase = (p) => {
      st.phase = p; st.prog = 0; st.pt = performance.now();
      hint.textContent = { foam: '🫧 Наноси пену', scrub: '🧽 Три губкой', water: '🚿 Смой пену водичкой', dry: '💨 Сушим...', win: '✨ Машинка чистая!' }[p];
      if (p === 'scrub') o.say('Трем губкой!', ['h17']);
      if (p === 'water') o.say('Теперь смываем водичкой!', ['h18']);
      if (p === 'dry') { sfx(null); once('wash_dryer'); }
      if (p === 'win') { o.say('Ура! Машинка чистая!', ['h19']); once('wash_shine'); root.querySelector('.wgGo').classList.remove('hidden'); confetti(); }
    };
    o.say('Машинка грязная! Давай помоем! Наносим пену!', ['h15', 'h16']);
    setPhase('foam');
    // the finger: a sponge in step 1, a water jet in step 2
    const toLocal = (x, y) => [(x - box.x) / box.w * lw, (y - box.y) / box.h * lh];
    let lastCheck = 0;
    // a ragged brush: a soft core and a ring of random little blobs, so edges are wavy, never straight
    function rag(c, x, y, r) {
      c.beginPath(); c.arc(x, y, r * 0.6, 0, TAU); c.fill();
      for (let k = 0; k < 9; k++) { const a = Math.random() * TAU, d = r * (0.35 + Math.random() * 0.6); c.beginPath(); c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.18 + Math.random() * 0.3), 0, TAU); c.fill(); }
    }
    function paint(x, y) {
      const [lx, ly] = toLocal(x, y), u = lw / box.w; // screen px -> layer px
      if (st.phase === 'foam') {
        for (let k = 0; k < 4; k++) {
          const bx = lx + (Math.random() - .5) * 44 * u, by = ly + (Math.random() - .5) * 44 * u, r = (18 + Math.random() * 18) * u;
          fg.fillStyle = '#FFFFFF'; fg.beginPath(); fg.arc(bx, by, r, 0, TAU); fg.fill();
          fg.strokeStyle = '#C9DDF0'; fg.lineWidth = 1.5; fg.beginPath(); fg.arc(bx, by, r * 0.55, Math.PI * 1.1, Math.PI * 1.6); fg.stroke();
        }
        fg.globalCompositeOperation = 'destination-in'; fg.drawImage(maskBig, 0, 0); fg.globalCompositeOperation = 'source-over';
        sfx('wash_foam');
      } else if (st.phase === 'scrub') {
        // the sponge dissolves the mud under the foam: the foam turns from brown to white
        dg.globalCompositeOperation = 'destination-out'; rag(dg, lx, ly, 34 * u); dg.globalCompositeOperation = 'source-over';
        sfx('wash_sponge');
      } else if (st.phase === 'water') {
        for (const c of [fg, dg]) { c.globalCompositeOperation = 'destination-out'; rag(c, lx, ly, 36 * u); c.globalCompositeOperation = 'source-over'; }
        for (let k = 0; k < 6; k++) st.drops.push({ x, y, vx: (Math.random() - .5) * 260, vy: -Math.random() * 200 - 60, life: 0.6 });
        sfx('wash_water');
      }
      const now = performance.now();
      if (now - lastCheck > 250) {
        lastCheck = now;
        if (st.phase === 'foam') { st.prog = cover(foam, true); if (st.prog >= GOAL) { fg.fillStyle = '#FFFFFF'; for (let k = 0; k < 420; k++) { fg.beginPath(); fg.arc(Math.random() * lw, Math.random() * lh, 8 + Math.random() * 14, 0, TAU); fg.fill(); } fg.globalCompositeOperation = 'destination-in'; fg.drawImage(maskBig, 0, 0); fg.globalCompositeOperation = 'source-over'; sfx(null); setPhase('scrub'); } }
        else if (st.phase === 'scrub') { st.prog = cover(dirt, false); if (st.prog >= GOAL) { dg.clearRect(0, 0, lw, lh); sfx(null); setPhase('water'); } }
        else if (st.phase === 'water') { const a = cover(foam, false); st.prog = a; if (st.prog >= GOAL) { fg.clearRect(0, 0, lw, lh); dg.clearRect(0, 0, lw, lh); setPhase('dry'); setTimeout(() => setPhase('win'), 2200); } }
      }
    }
    cv.addEventListener('pointerdown', e => { st.ptr = [e.clientX, e.clientY]; paint(e.clientX, e.clientY); });
    cv.addEventListener('pointermove', e => { if (!st.ptr) return; const [px, py] = st.ptr, d = Math.hypot(e.clientX - px, e.clientY - py), n = Math.max(1, Math.ceil(d / 10)); for (let i = 1; i <= n; i++) paint(px + (e.clientX - px) * i / n, py + (e.clientY - py) * i / n); st.ptr = [e.clientX, e.clientY]; });
    const up = () => { if (!st) return; st.ptr = null; if (loop) { const a = o.audio(); loop.g.gain.setTargetAtTime(0, a.currentTime, 0.08); } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
    // sounds: loops while the finger moves, one-shots for the dryer and the shine
    let loop = null; const BUF = {};
    async function buf(name) { const a = o.audio && o.audio(); if (!a) return null; if (BUF[name] !== undefined) return BUF[name]; try { BUF[name] = await a.decodeAudioData(await (await fetch('snd/' + name + '.mp3')).arrayBuffer()); } catch (e) { BUF[name] = null; } return BUF[name]; }
    ['wash_foam', 'wash_sponge', 'wash_water', 'wash_dryer', 'wash_shine'].forEach(buf);
    function sfx(kind) {
      const a = o.audio && o.audio(); if (!a) return;
      if (!kind) { if (loop) { const l = loop; loop = null; l.g.gain.setTargetAtTime(0, a.currentTime, 0.06); setTimeout(() => { try { l.s && l.s.stop(); } catch (e) { } }, 400); } return; }
      if (loop && loop.kind === kind) { loop.g.gain.setTargetAtTime(0.9, a.currentTime, 0.05); return; }
      sfx(null);
      const b = BUF[kind]; if (!b) return;
      const s = a.createBufferSource(), g = a.createGain(); s.buffer = b; s.loop = true; g.gain.value = 0;
      s.connect(g).connect(a.destination); s.start(0, Math.random() * Math.max(0, b.duration - 1)); g.gain.setTargetAtTime(0.9, a.currentTime, 0.05);
      loop = { s, g, kind };
    }
    async function once(name) { const a = o.audio && o.audio(), b = await buf(name); if (!a || !b) return; const s = a.createBufferSource(), g = a.createGain(); g.gain.value = 0.9; s.buffer = b; s.connect(g).connect(a.destination); s.start(); }
    const confetti = () => { for (let i = 0; i < 140; i++) st.sparks.push({ x: W / 2, y: H * 0.35, vx: (Math.random() - .5) * 700, vy: -Math.random() * 650 - 150, r: Math.random() * 6, vr: (Math.random() - .5) * 12, col: ['#F2545B', '#FFD23F', '#5BB8F5', '#7BC96F', '#9B7BE0'][i % 5], life: 3 + Math.random() }); };
    const close = () => { if (!st) return; sfx(null); cancelAnimationFrame(st.raf); root.remove(); st = null; removeEventListener('resize', fit); o.onDone && o.onDone(); };
    root.querySelector('.wgClose').onclick = close;
    root.querySelector('.wgGo').onclick = close;
    addEventListener('resize', fit); fit();
    let last = performance.now();
    function frame(now) {
      if (!st) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now, t = now / 1000;
      g.setTransform(DPR, 0, 0, DPR, 0, 0);
      // background picture (a plain wall until it loads)
      if (bg.complete && bg.naturalWidth) g.drawImage(bg, bgBox.x, bgBox.y, bgBox.w, bgBox.h);
      else { g.fillStyle = '#8FD0F7'; g.fillRect(0, 0, W, H); g.fillStyle = '#9DA3AE'; g.fillRect(0, bgBox.y + bgBox.h * FLOOR, W, H); }
      // the car with its dirt and foam
      const b = box, bob = st.phase === 'win' ? Math.sin(t * 6) * 4 : 0;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(b.x + b.w / 2, b.y + b.h, b.w * 0.46, 10, 0, 0, TAU); g.fill();
      g.drawImage(im, b.x, b.y + bob, b.w, b.h);
      if (st.phase === 'foam') { g.drawImage(dirt, b.x, b.y + bob, b.w, b.h); fvg.clearRect(0, 0, lw, lh); fvg.globalCompositeOperation = 'source-over'; fvg.drawImage(foam, 0, 0); fvg.globalCompositeOperation = 'source-atop'; fvg.drawImage(tex, 0, 0); g.drawImage(foamView, b.x, b.y + bob, b.w, b.h); g.globalAlpha = 0.4; g.drawImage(dirt, b.x, b.y + bob, b.w, b.h); g.globalAlpha = 1; }
      else { fvg.clearRect(0, 0, lw, lh); fvg.globalCompositeOperation = 'source-over'; fvg.drawImage(foam, 0, 0); fvg.globalCompositeOperation = 'source-atop'; fvg.drawImage(tex, 0, 0); g.drawImage(foamView, b.x, b.y + bob, b.w, b.h); g.globalAlpha = st.phase === 'scrub' ? 0.45 : 1; g.drawImage(dirt, b.x, b.y + bob, b.w, b.h); g.globalAlpha = 1; }
      // dryer: warm air lines from the top
      if (st.phase === 'dry') { g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3; for (let k = 0; k < 8; k++) { const x = b.x + b.w * (k + 0.5) / 8, y = ((t * 600 + k * 70) % (b.h + 80)) + b.y - 40; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 10, y + 18, x, y + 36); g.stroke(); } }
      // shine on a clean car
      if (st.phase === 'win' || st.phase === 'dry') for (let k = 0; k < 6; k++) { const ph = (t * 1.3 + k / 6) % 1, x = b.x + b.w * ((k * 37) % 10 / 10 * 0.8 + 0.1), y = b.y + b.h * ((k * 53) % 10 / 10 * 0.8 + 0.1), r = 10 * Math.sin(ph * Math.PI); g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); for (let j = 0; j < 4; j++) { const a = j * Math.PI / 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a + Math.PI / 4) * r * 0.3, y + Math.sin(a + Math.PI / 4) * r * 0.3); } g.fill(); }
      // the tools: foam gun and water gun aim at the finger from below, the sponge sits under the finger
      const tool = (k, x, y, w, rot, ax, ay) => { const T = TOOL[k]; if (!T.complete || !T.naturalWidth) return; const h = w * T.naturalHeight / T.naturalWidth; g.save(); g.translate(x, y); g.rotate(rot); g.drawImage(T, -w * ax, -h * ay, w, h); g.restore(); };
      if (st.ptr && st.phase === 'scrub') { const [x, y] = st.ptr, wob = Math.sin(t * 18) * 0.12; tool('sponge', x, y, 96, wob, 0.5, 0.55); }
      if (st.phase === 'foam' || st.phase === 'water') {
        const k = st.phase, T = TOOL[k], aim = st.ptr || [W / 2, b.y + b.h * 0.4];
        const base = k === 'foam' ? [W * 0.74, H * 0.99] : [W * 0.5, H * 0.99];
        const w = k === 'foam' ? 150 : 92, h = T.naturalWidth ? w * T.naturalHeight / T.naturalWidth : w * 2;
        const ang = Math.atan2(aim[1] - base[1], aim[0] - base[0]) + Math.PI / 2;
        // the nozzle: top of the picture, rotated with the gun
        const ax = tip[k], nx = base[0] + Math.sin(ang) * h * 0.97 + Math.cos(ang) * (ax - 0.5) * w, ny = base[1] - Math.cos(ang) * h * 0.97 + Math.sin(ang) * (ax - 0.5) * w;
        if (st.ptr) {
          // the stream from the nozzle to the finger
          const n = 14;
          for (let q = 0; q < n; q++) {
            const f = ((q / n) + t * 3) % 1, x = nx + (aim[0] - nx) * f + Math.sin(t * 30 + q) * 3, y = ny + (aim[1] - ny) * f + Math.cos(t * 26 + q) * 3;
            if (k === 'foam') { g.fillStyle = 'rgba(255,255,255,.95)'; g.strokeStyle = '#C9DDF0'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 5 + f * 9, 0, TAU); g.fill(); g.stroke(); }
            else { g.fillStyle = `rgba(120,200,255,${0.9 - f * 0.3})`; g.beginPath(); g.arc(x, y, 4 + f * 3, 0, TAU); g.fill(); }
          }
          if (k === 'water') { g.strokeStyle = 'rgba(150,215,255,.75)'; g.lineWidth = 6; g.lineCap = 'round'; g.beginPath(); g.moveTo(nx, ny); g.lineTo(aim[0], aim[1]); g.stroke(); }
        }
        tool(k, base[0], base[1], w, ang, 0.5, 1.0);
      }
      if (st.phase === 'dry') { const x = W / 2 + Math.sin(t * 2.2) * b.w * 0.3; tool('dryer', x, b.y - 30, 90, 0, 0.5, 0.9); }
      for (let i = st.drops.length - 1; i >= 0; i--) { const d = st.drops[i]; d.vy += 900 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.life -= dt; if (d.life <= 0) { st.drops.splice(i, 1); continue; } g.fillStyle = `rgba(90,170,255,${d.life * 1.4})`; g.beginPath(); g.arc(d.x, d.y, 4, 0, TAU); g.fill(); }
      for (let i = st.sparks.length - 1; i >= 0; i--) { const c = st.sparks[i]; c.vy += 400 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.life -= dt; if (c.life <= 0) { st.sparks.splice(i, 1); continue; } g.save(); g.translate(c.x, c.y); g.rotate(c.r); g.fillStyle = c.col; g.fillRect(-5, -3, 10, 6); g.restore(); }
      // steps at the top: 4 round badges with the tool icons, the current one big and glowing, done ones with a check
      const ci = STEPS.indexOf(st.phase === 'win' ? 'dry' : st.phase), R = 27, gap = 14, x0 = (W - 64) / 2 - (4 * 2 * R + 3 * gap) / 2 + R, yy = 50;
      for (let k2 = 0; k2 < 4; k2++) {
        const done = k2 < ci || st.phase === 'win', cur = k2 === ci && st.phase !== 'win', x = x0 + k2 * (2 * R + gap), sc = cur ? 1.25 + Math.sin(t * 5) * 0.05 : 1;
        if (k2 < 3) { g.strokeStyle = done ? '#4CD07A' : 'rgba(255,255,255,.7)'; g.lineWidth = 6; g.beginPath(); g.moveTo(x + R, yy); g.lineTo(x + R + gap, yy); g.stroke(); }
        g.save(); g.translate(x, yy); g.scale(sc, sc);
        if (cur) { g.fillStyle = 'rgba(255,230,120,.55)'; g.beginPath(); g.arc(0, 0, R + 9, 0, TAU); g.fill(); }
        g.fillStyle = done ? '#E6FFF0' : cur ? '#FFFFFF' : 'rgba(255,255,255,.55)'; g.strokeStyle = done ? '#2FB36A' : cur ? '#1D2A44' : 'rgba(29,42,68,.35)'; g.lineWidth = 3;
        g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); g.stroke();
        const T = TOOL[STEP_ICON[STEPS[k2]]];
        if (T.complete && T.naturalWidth) { const s2 = R * 1.45 / Math.max(T.naturalWidth, T.naturalHeight); g.globalAlpha = done || cur ? 1 : 0.45; g.drawImage(T, -T.naturalWidth * s2 / 2, -T.naturalHeight * s2 / 2, T.naturalWidth * s2, T.naturalHeight * s2); g.globalAlpha = 1; }
        if (done) { g.fillStyle = '#2FB36A'; g.beginPath(); g.arc(R * 0.7, R * 0.7, 11, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(R * 0.7 - 5, R * 0.7); g.lineTo(R * 0.7 - 1, R * 0.7 + 4); g.lineTo(R * 0.7 + 6, R * 0.7 - 4); g.stroke(); }
        g.restore();
      }
      // progress tube: fills with foam bubbles or water for the current step
      if (st.phase !== 'win' && st.phase !== 'dry') {
        const tx = W * 0.14, tw = W * 0.6, ty = yy + 46, th = 20, f = clamp(st.prog / GOAL, 0, 1);
        g.fillStyle = 'rgba(255,255,255,.85)'; g.strokeStyle = '#1D2A44'; g.lineWidth = 3; g.beginPath(); g.roundRect(tx, ty, tw, th, th / 2); g.fill(); g.stroke();
        if (f > 0.02) {
          g.save(); g.beginPath(); g.roundRect(tx + 3, ty + 3, (tw - 6) * f, th - 6, (th - 6) / 2); g.clip();
          const col = st.phase === 'water' ? ['#5BB8F5', '#2F80ED'] : st.phase === 'scrub' ? ['#FFE066', '#F5B700'] : ['#FFFFFF', '#CFE3F5'];
          const gr = g.createLinearGradient(0, ty, 0, ty + th); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]); g.fillStyle = gr; g.fillRect(tx, ty, tw, th);
          g.fillStyle = 'rgba(255,255,255,.75)'; for (let q = 0; q < 12; q++) { const bx = tx + ((q * 47 + t * 40) % tw), by = ty + th / 2 + Math.sin(t * 4 + q) * 3; g.beginPath(); g.arc(bx, by, 3, 0, TAU); g.fill(); }
          g.restore();
        }
      }
      if (false) bar.style.width = Math.round((st.phase === 'foam' ? st.prog / GOAL * 33 : st.phase === 'scrub' ? 33 + st.prog / GOAL * 33 : st.phase === 'water' ? 66 + st.prog / GOAL * 34 : 100)) + '%';
      st.raf = requestAnimationFrame(frame);
    }
    st.raf = requestAnimationFrame(frame);
  }
  window.WashGame = { start, get open() { return !!st; } };
})();
