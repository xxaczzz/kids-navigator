'use strict';
/* Kids navigator toy. All map data is fake. 1 world unit = 1 meter. */

// ---------- utils ----------
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function catmull(points, step = 12) {
  // smooth curve through all points
  const p = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const [p0, p1, p2, p3] = [p[i - 1], p[i], p[i + 1], p[i + 2]];
    const n = Math.max(2, Math.ceil(dist(p1, p2) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(j => 0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(points[points.length - 1].slice());
  return out;
}
function bezier(p0, p1, p2, p3, n = 24) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([0, 1].map(j => u * u * u * p0[j] + 3 * u * u * t * p1[j] + 3 * u * t * t * p2[j] + t * t * t * p3[j]));
  }
  return out;
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2, 0, 1);
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// ---------- road types ----------
const RT = {
  street:  { w: 80,  lane: 20, v: 60,  casing: '#ECE6D6', cw: 98,  color: '#7C828E', mark: 'dash' },
  avenue:  { w: 124, lane: 40, v: 80,  casing: '#ECE6D6', cw: 142, color: '#737985', mark: 'median' },
  highway: { w: 136, lane: 44, v: 120, casing: '#D6D0C2', cw: 156, color: '#686E7A', mark: 'highway' },
  ramp:    { w: 66,  lane: 16, v: 60,  casing: '#D6D0C2', cw: 80,  color: '#686E7A', mark: 'none' },
  ring:    { w: 66,  lane: 16, v: 36,  casing: '#ECE6D6', cw: 84,  color: '#7C828E', mark: 'none' },
  ringBig: { w: 100, lane: 26, v: 45,  casing: '#D6D0C2', cw: 118, color: '#6E7480', mark: 'none' },
  country: { w: 66,  lane: 16, v: 75,  casing: '#D9C99B', cw: 80,  color: '#8A909A', mark: 'dash' },
};

// ---------- graph ----------
const nodes = [], edges = [];
function node(x, y) { nodes.push({ id: nodes.length, x, y, edges: [] }); return nodes.length - 1; }
function P(n) { return [nodes[n].x, nodes[n].y]; }
function edge(a, b, pts, type, opt = {}) {
  pts = pts.map(p => p.slice());
  pts[0] = P(a); pts[pts.length - 1] = P(b);
  let len = 0; for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  const e = { id: edges.length, a, b, pts, type, len, oneway: !!opt.oneway, ring: !!opt.ring, overpass: !!opt.overpass, dead: false };
  edges.push(e); nodes[a].edges.push(e.id); nodes[b].edges.push(e.id);
  return e.id;
}
const line = (a, b, type = 'street') => edge(a, b, [P(a), P(b)], type);
const curve = (a, b, via, type = 'street') => edge(a, b, catmull([P(a), ...via, P(b)]), type);
function pointAlong(pts, d) {
  // point at distance d from start (negative: from end)
  if (d < 0) { pts = pts.slice().reverse(); d = -d; }
  for (let i = 1; i < pts.length; i++) {
    const l = dist(pts[i - 1], pts[i]);
    if (d <= l) { const t = d / l; return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t)]; }
    d -= l;
  }
  return pts[pts.length - 1].slice();
}
function splitEdge(eid, t) {
  const e = edges[eid];
  let d = e.len * t;
  const A = [], B = [];
  let i = 1;
  A.push(e.pts[0]);
  for (; i < e.pts.length; i++) {
    const l = dist(e.pts[i - 1], e.pts[i]);
    if (d <= l) break;
    d -= l; A.push(e.pts[i]);
  }
  const l = dist(e.pts[i - 1], e.pts[i]);
  const p = [lerp(e.pts[i - 1][0], e.pts[i][0], d / l), lerp(e.pts[i - 1][1], e.pts[i][1], d / l)];
  const n = node(p[0], p[1]);
  A.push(p); B.push(p); for (; i < e.pts.length; i++) B.push(e.pts[i]);
  e.dead = true;
  nodes[e.a].edges = nodes[e.a].edges.filter(x => x !== eid);
  nodes[e.b].edges = nodes[e.b].edges.filter(x => x !== eid);
  const e1 = edge(e.a, n, A, e.type, e), e2 = edge(n, e.b, B, e.type, e);
  return { n, p, e1, e2 };
}

// ---------- roundabouts ----------
const roundabouts = [];
function makeRoundabout(cx, cy, r, type = 'ring') { const rb = { cx, cy, r, type, entries: [] }; roundabouts.push(rb); return rb; }
function rbEntry(rb, toward) {
  const a = Math.atan2(toward[1] - rb.cy, toward[0] - rb.cx);
  const n = node(rb.cx + Math.cos(a) * rb.r, rb.cy + Math.sin(a) * rb.r);
  rb.entries.push({ a, n });
  return n;
}
function finishRoundabout(rb) {
  // right-hand traffic: counter-clockwise on screen = decreasing angle (y axis points down)
  const en = rb.entries.sort((p, q) => q.a - p.a);
  for (let i = 0; i < en.length; i++) {
    const from = en[i], to = en[(i + 1) % en.length];
    let a1 = to.a; if (a1 >= from.a) a1 -= TAU;
    const pts = [];
    const steps = Math.max(3, Math.ceil((from.a - a1) / 0.12));
    for (let k = 0; k <= steps; k++) { const a = lerp(from.a, a1, k / steps); pts.push([rb.cx + Math.cos(a) * rb.r, rb.cy + Math.sin(a) * rb.r]); }
    edge(from.n, to.n, pts, rb.type, { oneway: true, ring: true });
  }
}

// ---------- the city ----------
// A coastal city: sea in the south, a waterfront boulevard, two districts with different street grids,
// a river between them, a bypass highway in the north with big roundabouts, countryside beyond.
const CITY = { minX: -600, maxX: 13000, minY: -800, maxY: 6600 };
const coastY = x => 5200 + 260 * Math.sin(x / 1800) + 80 * Math.sin(x / 520);
const RIVER = catmull([[6350, -900], [6250, 500], [6420, 1500], [6300, 2500], [6200, 3500], [6350, 4300], [6280, 5100], [6300, 6600]], 30);
const RIVER_W = 100;
const WEST_LAKE = (() => {
  const pts = [], cx = -60, cy = 3000, rx = 260, ry = 380, k = 3;
  for (let i = 0; i < 48; i++) {
    const a = Math.PI / 2 + 0.26 + i / 47 * (2 * Math.PI - 0.5 - Math.PI / 2 - 0.26), f = 1 + 0.08 * Math.sin(a * 3 + k) + 0.05 * Math.cos(a * 5 + k * 2);
    pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]);
  }
  // right shore runs down to the resort, wraps under it, and closes along the bottom
  pts.push([205, 2960], [195, 3080], [150, 3180], [175, 3252], [270, 3262], [330, 3292], [310, 3345], [200, 3375], [90, 3390]);
  return pts;
})();
const LAKES = [[3150, 820, 380, 210], [7000, 360, 300, 190], [12000, 650, 380, 240], { poly: WEST_LAKE, cx: 40, cy: 3000, rx: 300, ry: 390 }, [5450, 1080, 200, 130], [9900, 520, 230, 150]];
const ptInPoly = (p, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > p[1]) !== (P[j][1] > p[1]) && p[0] < (P[j][0] - P[i][0]) * (p[1] - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
const inLake = (p, m = 0) => LAKES.some(L => {
  if (L.poly) { const P = lakeShape(L); if (ptInPoly(p, P)) return true; if (!m) return false; for (let i = 1; i < P.length; i++) if (segDist(p, P[i - 1], P[i]) < m) return true; return false; }
  const [cx, cy, rx, ry] = L; return ((p[0] - cx) / (rx + m)) ** 2 + ((p[1] - cy) / (ry + m)) ** 2 < 1;
});
const lakeShape = (L, k) => { if (L.poly) return L._s || (L._s = catmull([...L.poly, L.poly[0], L.poly[1]], 20)); const [cx, cy, rx, ry] = L; const pts = []; for (let i = 0; i < 24; i++) { const a = i / 24 * TAU, f = 1 + 0.08 * Math.sin(a * 3 + k) + 0.05 * Math.cos(a * 5 + k * 2); pts.push([cx + Math.cos(a) * rx * f, cy + Math.sin(a) * ry * f]); } return catmull([...pts, pts[0]], 20); };
function inWater(p) {
  if (inLake(p)) return true;
  if (p[1] > coastY(p[0])) return true;
  for (let i = 1; i < RIVER.length; i++) if (segDist(p, RIVER[i - 1], RIVER[i]) < RIVER_W / 2) return true;
  return false;
}
const HWY = catmull([[-900, 1750], [1500, 1500], [3500, 1850], [5500, 1650], [7600, 1450], [9600, 1750], [11300, 2250], [13600, 2900]], 20);
function hwY(x) {
  for (let i = 1; i < HWY.length; i++) if (HWY[i][0] >= x) { const a = HWY[i - 1], b = HWY[i], t = (x - a[0]) / ((b[0] - a[0]) || 1); return lerp(a[1], b[1], t); }
  return HWY[HWY.length - 1][1];
}
const G = {}, RBG = {}, GE = {}, GRIDS = {};
let FARM_PTS = [];
function grid(name, ox, oy, nx, ny, step, rotDeg, o) {
  const rot = rotDeg * Math.PI / 180, c = Math.cos(rot), s = Math.sin(rot);
  const cx = ox + step * (nx - 1) / 2, cy = oy + step * (ny - 1) / 2;
  const pos = (i, j) => { const dx = ox + step * i - cx, dy = oy + step * j - cy; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; };
  const key = (i, j) => name + i + ',' + j;
  for (const [i, j, r] of o.rb || []) RBG[key(i, j)] = makeRoundabout(...pos(i, j), r);
  const rows = o.rows || ny;
  for (let i = 0; i < nx; i++) for (let j = 0; j < rows; j++) if (!RBG[key(i, j)]) G[key(i, j)] = node(...pos(i, j));
  const gn = (i, j, toward) => RBG[key(i, j)] ? rbEntry(RBG[key(i, j)], toward) : G[key(i, j)];
  const skipH = new Set(o.skipH || []), skipV = new Set(o.skipV || []);
  for (let j = 0; j < rows; j++) for (let i = 0; i < nx - 1; i++) {
    if (skipH.has(i + ',' + j)) continue;
    GE[name + 'h' + i + ',' + j] = line(gn(i, j, pos(i + 1, j)), gn(i + 1, j, pos(i, j)), j === o.avRow ? 'avenue' : 'street');
  }
  for (let i = 0; i < nx; i++) for (let j = 0; j < rows - 1; j++) {
    if (skipV.has(i + ',' + j)) continue;
    GE[name + 'v' + i + ',' + j] = line(gn(i, j, pos(i, j + 1)), gn(i, j + 1, pos(i, j)), i === o.avCol ? 'avenue' : 'street');
  }
  const ly = rows - 1;
  const g = { pos, nx, ny, rows, bbox: [Math.min(pos(0, 0)[0], pos(0, ly)[0]) - 60, Math.min(pos(0, 0)[1], pos(nx - 1, 0)[1]) - 60, Math.max(pos(nx - 1, 0)[0], pos(nx - 1, ly)[0]) + 60, Math.max(pos(0, ly)[1], pos(nx - 1, ly)[1]) + 60] };
  GRIDS[name] = g;
  return g;
}
const inDowntown = p => Object.values(GRIDS).some(g => p[0] > g.bbox[0] && p[0] < g.bbox[2] && p[1] > g.bbox[1] && p[1] < g.bbox[3]);

function buildCity() {
  // district A: the old center, square blocks, a central square
  const A = grid('A', 2600, 2800, 9, 6, 400, 0, {
    rb: [[4, 2, 112], [1, 4, 74], [7, 1, 74]], avRow: 2, avCol: 4,
    skipH: ['2,0', '6,5', '7,5', '0,5', '6,1'], skipV: ['1,0', '5,3', '7,4', '3,1'],
  });
  // district B: east of the river, smaller blocks, turned along the coast
  const B = grid('B', 6900, 2700, 8, 6, 380, -8, {
    rb: [[3, 3, 74], [6, 1, 74]], avRow: 3, rows: 5,
    skipH: ['2,0', '5,4'], skipV: ['4,1', '1,3', '6,0'],
  });
  // two bridges between the districts
  GE.bridge1 = line(G['A8,1'], G['B0,1']);
  GE.bridge2 = line(G['A8,4'], G['B0,4']);
  // short roads to parking lots
  GE.parkW = line(G['A0,2'], node(2130, 3600));
  GE.parkE = line(G['B0,2'], node(6450, P(G['B0,2'])[1]));
  GE.parkE2 = line(G['B7,3'], node(P(G['B7,3'])[0] + 380, P(G['B7,3'])[1] + 20));

  // bypass highway with big roundabouts
  const hl = [0]; for (let i = 1; i < HWY.length; i++) hl.push(hl[i - 1] + dist(HWY[i - 1], HWY[i]));
  const at = x => { let k = 0; while (k < HWY.length - 1 && HWY[k][0] < x) k++; return k; };
  const sliceTo = (k0, k1) => HWY.slice(k0, k1 + 1);
  const hwRb = {};
  let prevNode = node(...HWY[0]), prevK = 0;
  for (const [name, x] of [['W', 1500], ['C', 4200], ['E', 7600], ['F', 10600]]) {
    const k = at(x), c = HWY[k], r = 150;
    const rb = makeRoundabout(c[0], c[1], r, 'ringBig');
    let kb = k; while (kb > 0 && dist(HWY[kb], c) < r + 10) kb--;
    let ka = k; while (ka < HWY.length - 1 && dist(HWY[ka], c) < r + 10) ka++;
    const before = rbEntry(rb, HWY[kb]), after = rbEntry(rb, HWY[ka]);
    edge(prevNode, before, sliceTo(prevK, kb), 'highway');
    prevNode = after; prevK = ka;
    hwRb[name] = { north: (t) => rbEntry(rb, t), south: (t) => rbEntry(rb, t), c };
  }
  edge(prevNode, node(...HWY[HWY.length - 1]), sliceTo(prevK, HWY.length - 1), 'highway');
  const N = (n, dy = -600) => hwRb[n].north([hwRb[n].c[0], hwRb[n].c[1] + dy]);
  const S = (n) => hwRb[n].south([hwRb[n].c[0], hwRb[n].c[1] + 600]);

  // links from the highway into town
  GE.linkC = curve(S('C'), G['A4,0'], [[4210, 2300]], 'avenue');
  const bTop = G['B2,0'];
  GE.linkE = curve(S('E'), bTop, [[7600, 2150]]);
  const E1 = node(10450, 3050);
  GE.linkF = curve(S('F'), E1, [[10550, 2600]]);
  const TB = splitEdge(GE.linkF, 0.12).n, TS = node(10770, 2330);
  GE.trainRd = curve(TB, TS, [[10680, 2325]]);
  GE.eastB = curve(G['B7,1'], E1, [[9900, 2950]]);

  // west suburbs: winding streets
  const W1 = node(1850, 3250), W2 = node(1200, 3950);
  GE.subA = curve(G['A0,1'], W1, [[2250, 3120]]);
  GE.linkW = curve(W1, S('W'), [[1700, 2700], [1560, 2150]]);
  GE.subB = curve(W1, W2, [[1450, 3500]]);
  GE.subC = curve(W2, G['A0,4'], [[1800, 4150], [2300, 4380]]);
  const W3 = node(600, 3500);
  GE.subD = curve(W2, W3, [[850, 3800]]);
  GE.subE = curve(W3, W1, [[900, 3100], [1400, 2950]]);
  const LK = node(345, 3170);
  GE.lakeRd = curve(W3, LK, [[470, 3330]], 'country');

  // waterfront boulevard, with streets coming down to it
  const blvY = x => coastY(x) - 240;
  const drops = [];
  const drop = (from, prev, type = 'street') => {
    // follow the street direction until it meets the boulevard
    const p = P(from), q = P(prev), dx = p[0] - q[0], dy = p[1] - q[1];
    let x = p[0];
    for (let k = 0; k < 6; k++) x = p[0] + dx / dy * (blvY(x) - p[1]);
    drops.push({ x, from, type });
  };
  for (const i of [0, 2, 4, 6, 8]) drop(G['A' + i + ',5'], G['A' + i + ',4'] ?? RBG['A' + i + ',4'], i === 4 ? 'avenue' : 'street');
  for (const i of [1, 4, 5, 7]) drop(G['B' + i + ',4'], G['B' + i + ',3']);
  drops.push({ x: 300 }, { x: 1150, from: W2 }, { x: 11100, from: null, east: true });
  drops.sort((a, b) => a.x - b.x);
  let prev = null, k = 0;
  for (const d of drops) {
    d.n = node(d.x, blvY(d.x));
    if (d.from != null) GE['drop' + k] = curve(d.from, d.n, [], d.type);
    if (prev) {
      const pts = []; for (let x = prev.x; x < d.x; x += 40) pts.push([x, blvY(x)]); pts.push([d.x, blvY(d.x)]);
      GE['blv' + k] = edge(prev.n, d.n, pts, 'avenue');
      GE['blv' + k + 'x'] = [prev.x, d.x];
    }
    prev = d; k++;
  }
  const blvEast = drops.find(d => d.east).n;
  GE.eastDown = curve(E1, blvEast, [[10800, 3900], [11000, 4500]]);
  const cape = node(12100, coastY(12100) - 70);
  GE.cape = curve(blvEast, cape, [[11500, blvY(11500) + 40]], 'country');

  // countryside north of the highway
  const V1 = node(1150, 750);
  GE.village = curve(N('W'), V1, [[1400, 1100]], 'country');
  const GR = node(250, 350);
  GE.grandma = curve(V1, GR, [[750, 450]], 'country');
  const AP = node(2500, 180);
  GE.amuse = curve(V1, AP, [[1750, 300]], 'country');
  const ZO = node(4500, 350);
  GE.zoo = curve(N('C'), ZO, [[4150, 900]], 'country');
  const AE = node(9300, 1000);
  GE.airport = curve(N('E'), AE, [[7700, 1000], [8300, 1050]], 'avenue');
  const FO = node(11000, 900);
  GE.forest = curve(N('F'), FO, [[10500, 1400]], 'country');
  const CM = node(3300, 430);
  GE.campRd = curve(AP, CM, [[2900, 260]], 'country');
  const PN = node(7150, 640);
  GE.picnicRd = curve(hwRb.E.north([7100, 500]), PN, [[7250, 1050]], 'country');
  const FM = node(380, 1380);
  // the farm road branches off the village road (not off the roundabout, where it ran along the highway)
  const FB = splitEdge(GE.village, 0.3).n;
  GE.farmRd = curve(FB, FM, [[1150, 1230], [750, 1300]], 'country');
  FARM_PTS = edges[GE.farmRd].pts.slice();

  roundabouts.forEach(finishRoundabout);
}
function blvEdgeAt(x) { for (const k in GE) if (k.endsWith('x') && k.startsWith('blv')) { const [a, b] = GE[k]; if (x >= a && x <= b) return k.slice(0, -1); } return null; }

// ---------- places ----------
const POI_DEFS = [
  // key, name, sprite, emoji, edge, t, side, world width, phrase
  ['home', 'Дом', 'home', '🏠', 'Ah1,4', .55, 1, 140, 'Едем домой'],
  ['kindergarten', 'Садик', 'kindergarten', '🧸', 'Av2,3', .5, 1, 165, 'Едем в садик'],
  ['school', 'Школа', 'school', '🏫', 'Av0,2', .5, -1, 175, 'Едем в школу'],
  ['shop', 'Магазин', 'shop', '🛒', 'Ah3,3', .5, -1, 140, 'Едем в магазин'],
  ['gas', 'Заправка', 'gas_station', '⛽', 'Ah5,2', .5, 1, 170, 'Едем на заправку'],
  ['gas2', 'Заправка', 'gas_station', '⛽', 'Bh6,3', .5, 1, 170, 'Едем на заправку'],
  ['fire', 'Пожарные', 'fire_station', '🚒', 'Av6,0', .5, -1, 160, 'Едем к пожарным'],
  ['park', 'Парк', 'playground', '🛝', 'Ah5,0', .45, 1, 170, 'Едем в парк'],
  ['police', 'Полиция', 'police', '🚓', 'Av4,3', .5, 1, 160, 'Едем в полицию'],
  ['carwash', 'Мойка', 'car_wash', '🧽', 'Av8,3', .5, 1, 150, 'Едем на мойку'],
  ['hospital', 'Больница', 'hospital', '🏥', 'Bv2,2', .5, -1, 190, 'Едем в больницу'],
  ['train', 'Вокзал', 'train_station', '🚂', 'trainRd', .85, 1, 210, 'Едем на вокзал'],
  ['cinema', 'Кино', 'cinema', '🎬', 'Bh1,3', .5, 1, 160, 'Едем в кино'],
  ['post', 'Почта', 'post_office', '✉️', 'Bh5,2', .5, 1, 145, 'Едем на почту'],
  ['stadium', 'Стадион', 'stadium', '⚽', 'Bv7,2', .5, -1, 380, 'Едем на стадион'],
  ['icecream', 'Мороженое', 'ice_cream', '🍦', 'blv@4700', .5, 1, 100, 'Едем за мороженым'],
  ['pizza', 'Пицца', 'pizza', '🍕', 'blv@7900', .5, -1, 125, 'Едем в пиццерию'],
  ['airport', 'Аэропорт', 'airport', '✈️', 'airport', .8, -1, 480, 'Едем в аэропорт'],
  ['amuse', 'Аттракционы', 'amusement_park', '🎡', 'amuse', .8, 1, 300, 'Едем на аттракционы'],
  ['grandma', 'Бабушка', 'grandma', '👵', 'grandma', .85, 1, 145, 'Едем к бабушке'],
  ['zoo', 'Зоопарк', 'zoo', '🦒', 'zoo', .85, 1, 210, 'Едем в зоопарк'],
  ['lighthouse', 'Маяк', 'lighthouse', '🗼', 'cape', .92, 1, 130, 'Едем к маяку'],
  ['orbi', 'Орби Сити', 'orbi_city', '🏙️', 'blv@3000', .5, -1, 340, 'Едем в Орби Сити'],
  ['beach', 'Пляж', 'beach', '🏖️', 'blv@5400', .5, 1, 170, 'Едем на пляж'],
  ['port', 'Пристань', 'port', '⛵', 'blv@6600', .5, 1, 170, 'Едем на пристань'],
  ['aquapark', 'Аквапарк', 'aquapark', '💦', 'blv@10300', .5, -1, 240, 'Едем в аквапарк'],
  ['bakery', 'Пекарня', 'bakery', '🥖', 'Ah2,1', .5, 1, 130, 'Едем в пекарню'],
  ['library', 'Библиотека', 'library', '📚', 'Av3,3', .5, 1, 160, 'Едем в библиотеку'],
  ['circus', 'Цирк', 'circus', '🎪', 'Ah7,1', .5, 1, 170, 'Едем в цирк'],
  ['toys', 'Игрушки', 'toy_shop', '🧸', 'Bh2,2', .5, 1, 130, 'Едем за игрушками'],
  ['dino', 'Динозавры', 'dino_museum', '🦖', 'Bv5,3', .5, 1, 190, 'Едем к динозаврам'],
  ['vet', 'Ветклиника', 'vet', '🐾', 'subB', .5, 1, 130, 'Едем в ветклинику'],
  ['farm', 'Ферма', 'farm', '🐄', 'farmRd', .9, 1, 320, 'Едем на ферму'],
  ['camp', 'Лагерь', 'camp', '🏕️', 'campRd', .85, -1, 300, 'Едем в лагерь'],
  ['picnic', 'Пикник', 'picnic', '🧺', 'picnicRd', .9, -1, 160, 'Едем на пикник'],
  ['marriott', 'Марриотт', 'marriott', '🏨', 'blv@3800', .5, -1, 300, 'Едем в Марриотт'],
  ['europe', 'Площадь Европы', 'europe_square', '⛲', 'Ah4,2', .5, 1, 290, 'Едем на площадь Европы'],
  ['mcdonalds', 'Макдональдс', 'mcdonalds', '🍔', 'Av4,1', .5, 1, 150, 'Едем в Макдональдс'],
  ['resort', 'Курорт', 'lake_resort', '🏝️', 'lakeRd', .92, -1, 230, 'Едем на курорт'],
  ['castle', 'Замок', 'castle', '🏰', 'forest', .92, -1, 230, 'Едем в замок'],
];
const POIS = [];
// hand-placed spots for big pictures that need the whole block: [x, y (base), width]
const POS_FIX = { europe: [4400, 3895, 270], train: [10905, 2445, 205], resort: [195, 3250, 240] };
function placePois() {
  for (const [key, name, sprite, emoji, eref0, t, side, w, phrase] of POI_DEFS) {
    const eref = eref0.startsWith('blv@') ? blvEdgeAt(+eref0.slice(4)) : eref0;
    const eid = GE[eref];
    if (eid == null || edges[eid].dead) { console.warn('bad poi edge', key, eref); continue; }
    if (!IMG[sprite]) continue;
    const e = edges[eid];
    const before = pointAlong(e.pts, Math.max(1, e.len * t - 10)), after = pointAlong(e.pts, e.len * t + 10);
    const { n, p } = splitEdge(eid, t);
    const d = [after[0] - before[0], after[1] - before[1]], l = Math.hypot(...d);
    const right = [-d[1] / l, d[0] / l];
    const nrm = [right[0] * side, right[1] * side];
    const q = placeBeside(p, nrm, RT[e.type].cw / 2, w, sprite, 420) || [p[0] + nrm[0] * (RT[e.type].cw / 2 + w * 0.5), p[1] + nrm[1] * (RT[e.type].cw / 2 + w * 0.5)];
    const fix = POS_FIX[key];
    POIS.push({ key, name, sprite, emoji, node: n, x: fix ? fix[0] : q[0], y: fix ? fix[1] : q[1], w: fix ? fix[2] : w, phrase });
  }
}

// ---------- sprites ----------
const SPRITES = ['parking_lot_small', 'parking_lot_medium', 'parking_lot_big', 'parking_small', 'parking_medium', 'parking_big', 'boat_sail', 'boat_ferry', 'boat_fishing', 'boat_yacht', 'train_engine', 'train_car', 'car', 'car_top', 'car_police', 'car_cat', 'car_blue', 'car_front', 'car_side', 'pin', 'airplane', 'house_1', 'house_2', 'house_3', 'house_4', 'tree_1', 'tree_2', 'tree_3', 'bush', 'pond',
  'apartment_1', 'apartment_2', 'office_tower', 'windmill', 'haystack', 'cows', 'sheep', 'tractor', 'tent', 'beehives', 'apple_tree', 'rocks', 'deer', 'fountain', 'crane', ...new Set(POI_DEFS.map(p => p[2]))];
const IMG = {};
function loadSprites() {
  return Promise.all(SPRITES.map(n => new Promise(res => {
    const im = new Image();
    im.onload = () => { IMG[n] = im; res(); };
    im.onerror = () => res();
    im.src = 'img/' + n + '.png';
  })));
}

// ---------- decor and filler ----------
const decor = [];   // billboard sprites {x,y,w,sprite}
const segHash = new Map(), HCELL = 200;
const RAILS = [
  // east, along the highway
  catmull([[11005, 2428], [11150, hwY(11150) + 330], ...[11600, 12200, 12900, 13600, 14300].map(x => [x, hwY(x) + 330])], 25),
  // south along the east road, then east along the coast
  catmull([[10935, 2470], [10870, 2800], [10780, 3150], [10950, 3700], [11200, 4250], [11450, coastY(11450) - 430], ...[12000, 12700, 13400, 14300].map(x => [x, coastY(x) - 430])], 25),
];
function hashRoads() {
  for (const RAIL of RAILS) { const half = 40; for (let i = 1; i < RAIL.length; i++) { const a = RAIL[i - 1], b = RAIL[i];
      for (let x = Math.floor((Math.min(a[0], b[0]) - half) / HCELL); x <= Math.floor((Math.max(a[0], b[0]) + half) / HCELL); x++) for (let y = Math.floor((Math.min(a[1], b[1]) - half) / HCELL); y <= Math.floor((Math.max(a[1], b[1]) + half) / HCELL); y++) {
        const k = x + ',' + y; if (!segHash.has(k)) segHash.set(k, []); segHash.get(k).push([a, b, half]); } } }
  for (const e of edges) {
    if (e.dead) continue;
    const half = RT[e.type].cw / 2;
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1], b = e.pts[i];
      const x0 = Math.floor((Math.min(a[0], b[0]) - half) / HCELL), x1 = Math.floor((Math.max(a[0], b[0]) + half) / HCELL);
      const y0 = Math.floor((Math.min(a[1], b[1]) - half) / HCELL), y1 = Math.floor((Math.max(a[1], b[1]) + half) / HCELL);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = x + ',' + y; if (!segHash.has(k)) segHash.set(k, []);
        segHash.get(k).push([a, b, half]);
      }
    }
  }
}
function roadClear(p, margin) {
  for (const rb of roundabouts) if (Math.hypot(p[0] - rb.cx, p[1] - rb.cy) < rb.r + RT[rb.type].cw / 2 + margin) return false; // nothing on roundabout islands

  const cx = Math.floor(p[0] / HCELL), cy = Math.floor(p[1] / HCELL);
  for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
    const list = segHash.get(x + ',' + y); if (!list) continue;
    for (const [a, b, half] of list) if (segDist(p, a, b) < half + margin) return false;
  }
  return true;
}
const FIELDS = [[-200, 650, 450, 1050, '#E6C86A'], [600, 790, 1000, 1140, '#C9A86B'], [1500, 650, 2100, 950, '#D9C46A'], [5200, 450, 5800, 800, '#E6C86A'], [10000, 900, 10500, 1300, '#D9C46A'], [11300, 1300, 11900, 1700, '#C9A86B']];
function spriteClear(q, w, sprite) {
  const im = IMG[sprite], h = im ? w * im.height / im.width : w;
  for (const fx of [-0.46, 0, 0.46]) for (const fy of [-0.8, -0.5, -0.2, 0.15]) if (!roadClear([q[0] + fx * w, q[1] + fy * h], 3)) return false;
  return true;
}
// slide out from the road along n until the picture fits next to it
function placeBeside(p, n, half, w, sprite, maxOff = 320) {
  for (let off = half + 12; off < half + maxOff; off += 10) {
    const q = [p[0] + n[0] * off, p[1] + n[1] * off];
    if (spriteClear(q, w, sprite) && ![-0.4, 0, 0.4].some(f => inWater([q[0] + f * w, q[1]]))
      && !POIS.some(o => Math.abs(o.x - q[0]) < (o.w + w) * 0.5 && Math.abs(o.y - q[1]) < (o.w + w) * 0.42)) return q;
  }
  return null;
}
const ZONES = {
  park: [4640, 2840, 4960, 3160],
  airport: [8100, 330, 9600, 900],
};
const inRect = (p, r) => p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3];
const ellK = p => ((p[0] - ELL.cx) / ELL.rx) ** 2 + ((p[1] - ELL.cy) / ELL.ry) ** 2;
function noise(x, y) { return Math.sin(x / 530) * Math.cos(y / 410) + 0.6 * Math.sin((x + y) / 290) + 0.4 * Math.cos((x - 2 * y) / 700); }
function buildDecor() { buildDecor0(); for (let i = decor.length - 1; i >= 0; i--) { const d = decor[i]; const im = IMG[d.sprite], h = im ? d.w * im.height / im.width : d.w; if (SIGNS.some(g => Math.abs(g.x - d.x) < d.w * 0.5 + 16 && g.y > d.y - 0.82 * h - 10 && g.y - 50 < d.y + 0.18 * h)) decor.splice(i, 1); } }
function buildDecor0() {
  const R = rng(7);
  const has = n => !!IMG[n];
  const pick = list => { const ok = list.filter(has); return ok.length ? ok[Math.floor(R() * ok.length)] : null; };
  const nearPoi = (p, extra) => POIS.some(q => Math.hypot(q.x - p[0], q.y - p[1]) < q.w * 0.55 + extra);
  const bh = new Map(), BC = 150;
  const free = (p, r) => {
    const cx = Math.floor(p[0] / BC), cy = Math.floor(p[1] / BC);
    for (let x = cx - 2; x <= cx + 2; x++) for (let y = cy - 2; y <= cy + 2; y++) for (const b of bh.get(x + ',' + y) || []) if (Math.hypot(b[0] - p[0], b[1] - p[1]) < b[2] + r) return false;
    return true;
  };
  const put = (p, w, sprite) => {
    decor.push({ x: p[0], y: p[1], w, sprite });
    const k = Math.floor(p[0] / BC) + ',' + Math.floor(p[1] / BC);
    if (!bh.has(k)) bh.set(k, []); bh.get(k).push([p[0], p[1], w * 0.42]);
  };
  const inField = p => FIELDS.some(f => p[0] > f[0] && p[0] < f[2] && p[1] > f[1] && p[1] < f[3]);
  const nearCoast = p => p[1] > coastY(p[0]) - 140;
  const town = p => p[1] > hwY(p[0]) + 160 && p[0] > 200 && p[0] < 11600;
  const village = p => Math.hypot(p[0] - 1150, p[1] - 750) < 650;

  // park: pond and trees
  if (has('pond')) put([(ZONES.park[0] + ZONES.park[2]) / 2 + 30, ZONES.park[3] - 60], 180, 'pond');
  for (let k = 0; k < 16; k++) {
    const p = [lerp(ZONES.park[0] + 20, ZONES.park[2] - 20, R()), lerp(ZONES.park[1] + 20, ZONES.park[3] - 20, R())];
    const s = pick(['tree_1', 'tree_2', 'tree_3', 'bush']);
    if (s && roadClear(p, 30) && !nearPoi(p, 30) && free(p, 30)) put(p, s === 'bush' ? 50 : 70, s);
  }

  // buildings: a row along every street, facing the road
  for (const e of edges) {
    if (e.dead || e.ring || e.type === 'highway' || e.type === 'ramp' || e.len < 160) continue;
    const mid = pointAlong(e.pts, e.len / 2);
    let kind;
    if (inDowntown(mid)) kind = 'city';
    else if (town(mid)) kind = 'house';
    else if (village(mid)) kind = 'house';
    else continue;
    const w = kind === 'city' ? 128 : 112, step = kind === 'city' ? 150 : 145;
    const half = RT[e.type].cw / 2;
    for (const side of [-1, 1]) {
      for (let d = 75; d < e.len - 75; d += step) {
        const a = pointAlong(e.pts, Math.max(0, d - 6)), b = pointAlong(e.pts, d + 6), p = pointAlong(e.pts, d);
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        const n = [-dy / l * side, dx / l * side];
        const sprite = kind === 'city' ? pick(['apartment_1', 'apartment_2', 'apartment_1', 'apartment_2', 'office_tower']) : pick(['house_1', 'house_2', 'house_3', 'house_4']);
        if (!sprite) continue;
        const q = placeBeside(p, n, half, w, sprite, 260);
        if (!q) continue;
        if (inWater(q) || nearCoast(q) || inRect(q, ZONES.park) || inRect(q, ZONES.airport) || inField(q)) continue;
        if (nearPoi(q, w * 0.4) || !free(q, w * 0.4)) continue;
        if (kind === 'house' && !town(q) && !village(q)) continue;
        put(q, w, sprite);
      }
    }
  }
  // street trees in town gaps, kept tidy: only along roads, between buildings
  for (const e of edges) {
    if (e.dead || e.ring || e.type === 'highway' || e.len < 160) continue;
    const mid = pointAlong(e.pts, e.len / 2);
    if (!town(mid)) continue;
    const half = RT[e.type].cw / 2;
    for (const side of [-1, 1]) for (let d = 60; d < e.len - 60; d += 75) {
      const a = pointAlong(e.pts, Math.max(0, d - 6)), b = pointAlong(e.pts, d + 6), p = pointAlong(e.pts, d);
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const s = pick(['tree_1', 'tree_1', 'tree_3', 'bush']);
      if (!s) continue;
      const tw = s === 'bush' ? 44 : 58;
      const q = placeBeside(p, [-dy / l * side, dx / l * side], half, tw, s, 120);
      if (!q || inWater(q) || nearCoast(q) || nearPoi(q, 20) || !free(q, 24)) continue;
      put(q, tw, s);
    }
  }
  // fountains on the small roundabout islands
  if (has('fountain')) for (const rb of roundabouts) if (rb.type === 'ring' && rb.r <= 80) put([rb.cx, rb.cy + 18], 58, 'fountain');
  const scatter = (sprite, w, n, area, tries = 60) => {
    if (!has(sprite)) return;
    for (let k = 0, t = 0; k < n && t < tries; t++) {
      const p = area();
      if (inWater(p) || nearCoast(p) || inLake(p, 30) || (sprite === 'rocks' || sprite === 'deer' || sprite === 'tent') && inField(p) || !spriteClear(p, w, sprite) || nearPoi(p, 30) || !free(p, w * 0.45)) continue;
      put(p, w, sprite); k++;
    }
  };
  const around = (cx, cy, r) => () => { const a = R() * TAU, d = Math.sqrt(R()) * r; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; };
  const inRectP = (f, pad = 30) => () => [lerp(f[0] + pad, f[2] - pad, R()), lerp(f[1] + pad, f[3] - pad, R())];
  // fields: haystacks, a windmill and a tractor
  for (const f of FIELDS) {
    scatter('haystack', 60, 2, inRectP(f));
    scatter('tractor', 70, 1, inRectP(f));
    scatter('windmill', 110, 1, () => [f[R() < .5 ? 0 : 2] + (R() - .5) * 60, lerp(f[1], f[3], R())]);
  }
  // meadows with animals around the farm and the village
  scatter('cows', 80, 3, around(500, 1500, 450));
  scatter('sheep', 80, 3, around(700, 1000, 500));
  scatter('cows', 80, 2, around(10300, 1100, 500));
  scatter('sheep', 80, 2, around(11600, 1500, 400));
  // village: beehives and an apple orchard
  scatter('beehives', 70, 2, around(1150, 750, 550));
  scatter('apple_tree', 66, 10, around(1500, 500, 300));
  // tents by the lakes, rocks and deer in the woods
  for (const L of LAKES) { const [cx, cy, rx, ry] = L.poly ? [L.cx, L.cy, L.rx, L.ry] : L; scatter('tent', 60, 2, () => { const a = R() * TAU; return [cx + Math.cos(a) * (rx + 90), cy + Math.sin(a) * (ry + 90)]; }); }
  scatter('rocks', 70, 14, () => [lerp(CITY.minX, CITY.maxX, R()), lerp(CITY.minY, hwY(lerp(CITY.minX, CITY.maxX, .5)) - 150, R())], 400);
  scatter('deer', 64, 10, () => [lerp(CITY.minX, CITY.maxX, R()), lerp(CITY.minY, 1300, R())], 400);
  // a grove between the farm road and the highway
  const farmY = x => { for (let i = 1; i < FARM_PTS.length; i++) { const a = FARM_PTS[i - 1], b = FARM_PTS[i]; if ((x - a[0]) * (x - b[0]) <= 0) return lerp(a[1], b[1], (x - a[0]) / ((b[0] - a[0]) || 1)); } return null; };
  for (const sp of ['tree_2', 'tree_1', 'tree_3', 'tree_2']) scatter(sp, 66, 9, () => {
    const x = lerp(420, 1380, R()), fy = farmY(x);
    return fy == null ? [-9999, -9999] : [x, lerp(fy + 75, hwY(x) - 95, R())];
  }, 200);
  // ...and further west, past the end of the farm road
  for (const sp of ['tree_2', 'tree_1', 'tree_3', 'tree_2']) scatter(sp, 66, 10, () => { const x = lerp(-550, 420, R()); return [x, lerp(1480, hwY(x) - 95, R())]; }, 200);
  // a few building sites in town
  scatter('crane', 120, 4, () => [lerp(1500, 11000, R()), lerp(hwY(6000) + 300, 4700, R())], 300);
  // countryside: dense forests in patches around fields and lakes
  for (let x = CITY.minX; x < CITY.maxX; x += 78) for (let y = CITY.minY; y < CITY.maxY; y += 78) {
    const p = [x + (R() - .5) * 50, y + (R() - .5) * 50];
    if (town(p) || village(p) || inWater(p) || nearCoast(p) || inField(p) || inRect(p, ZONES.airport)) continue;
    if (noise(p[0], p[1]) < -0.15 && R() < 0.85) continue; // meadows between forests
    if (inLake(p, 60)) continue;
    const s = pick(['tree_2', 'tree_2', 'tree_1', 'tree_3']);
    if (!s || !spriteClear(p, 66, s) || nearPoi(p, 40) || !free(p, 26)) continue;
    put(p, 66, s);
  }
}

// ---------- parking lots ----------
// rough spots from Stanislav's map; each one slides to the nearest free place next to the roads
const PARKINGS = [
  { sp: 'parking_lot_big', w: 330, at: [2050, 3700] },
  { sp: 'parking_lot_medium', w: 240, at: [5572, 2650] },
  { sp: 'parking_lot_medium', w: 240, at: [7650, 2930] },
  { sp: 'parking_lot_medium', w: 240, at: [6470, 3500] },
  { sp: 'parking_lot_small', w: 150, at: [3613, 3045] },
  { sp: 'parking_lot_small', w: 150, at: [6520, 3820] },
  { sp: 'parking_lot_small', w: 150, at: [6080, 4300] },
  { sp: 'parking_lot_small', w: 150, at: [5202, 4769] },
  { sp: 'parking_lot_small', w: 150, at: [2457, 4896] },
  { sp: 'parking_lot_medium', w: 240, at: [8850, 2480] },
  { sp: 'parking_lot_medium', w: 240, at: [9960, 3800] },
  { sp: 'parking_lot_small', w: 150, at: [9800, 3790] },
];
const footprint = (x, y, w, sp) => { const im = IMG[sp], h = im ? w * im.height / im.width : w; return [x - w / 2, y - 0.82 * h, x + w / 2, y + 0.18 * h]; };
const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
// flat top-down lots lie on the ground: turned so the driveway (right side of the picture) meets the road
const GROUND_LOTS = [];
// where the driveway is in each picture: right edge (fraction of width from centre), top and bottom (fraction of height)
const LOT_DRIVE = { parking_lot_small: [0.5, -0.30, 0.38], parking_lot_medium: [0.495, -0.065, 0.127], parking_lot_big: [0.5, -0.146, 0.159] };
function placeGroundLot(pk, placed) {
  const im = IMG[pk.sp]; if (!im) return false;
  const W = pk.w, H = W * im.height / im.width;
  const rd = nearestRoad(pk.at, 700); if (!rd) return false;
  const e = edges[rd.eid], asph = RT[e.type].w / 2;
  for (const shift of [0, 40, -40, 80, -80, 130, -130, 180, -180, 240, -240]) {
    const d0 = clamp(rd.t * e.len + shift, 30, e.len - 30);
    const p = pointAlong(e.pts, d0), a = pointAlong(e.pts, Math.max(0, d0 - 8)), b = pointAlong(e.pts, Math.min(e.len, d0 + 8));
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    let n = [-dy / l, dx / l]; if ((pk.at[0] - p[0]) * n[0] + (pk.at[1] - p[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const ang = Math.atan2(-n[1], -n[0]); // picture +x (driveway) points back to the road
    const ux = [Math.cos(ang), Math.sin(ang)], uy = [-Math.sin(ang), Math.cos(ang)];
    // the driveway end (0.448 W right of the picture centre) reaches into the road asphalt
    for (let gap = 0; gap <= 0; gap += 10) {
      const D = LOT_DRIVE[pk.sp], off = asph - 3 + W * D[0];
      const c = [p[0] + n[0] * off, p[1] + n[1] * off];
      let ok = true;
      for (let i = 0; i <= 4 && ok; i++) for (let j = 0; j <= 4 && ok; j++) {
        const fx = -0.48 + i * 0.21, fy = -0.48 + j * 0.24;
        const q = [c[0] + ux[0] * fx * W + uy[0] * fy * H, c[1] + ux[1] * fx * W + uy[1] * fy * H];
        if (inWater(q) || !roadClear(q, -1)) ok = false;
      }
      if (!ok) continue;
      const r = Math.max(W, H) * 0.6, f = [c[0] - r, c[1] - r, c[0] + r, c[1] + r];
      if (POIS.some(o => overlaps(f, footprint(o.x, o.y, o.w, o.sprite))) || placed.some(o => overlaps(f, o))) continue;
      placed.push(f);
      for (let k = decor.length - 1; k >= 0; k--) { const d = decor[k]; if (overlaps([c[0] - r * 0.85, c[1] - r * 0.85, c[0] + r * 0.85, c[1] + r * 0.85], footprint(d.x, d.y, d.w, d.sprite))) decor.splice(k, 1); }
      GROUND_LOTS.push({ x: c[0], y: c[1], ang, W, H, sp: pk.sp, road: RT[e.type].color, D });
      // upright P sign on the curb next to the driveway
      const lx = 0.46 * W, ly = D[1] * H - 10;
      SIGNS.push({ t: 'park', x: c[0] + ux[0] * lx + uy[0] * ly, y: c[1] + ux[1] * lx + uy[1] * ly });
      return true;
    }
  }
  return false;
}
function drawGroundLots() {
  for (const g of GROUND_LOTS) {
    const im = IMG[g.sp]; if (!im) continue;
    ctx.save(); ctx.translate(g.x, g.y); ctx.rotate(g.ang); ctx.drawImage(im, -g.W / 2, -g.H / 2, g.W, g.H);
    // asphalt joint: the driveway runs straight into the road, no curb or outline between them
    const [xr, a0, a1] = g.D, y0 = a0 * g.H + 3, y1 = a1 * g.H - 3;
    ctx.fillStyle = g.road; ctx.fillRect(xr * g.W - 10, y0, 24, y1 - y0);
    ctx.restore();
  }
}
function placeParkings() {
  const placed = [];
  for (const pk of PARKINGS) {
    if (LOT_DRIVE[pk.sp]) { if (!placeGroundLot(pk, placed)) console.warn('no room for parking', pk.at); continue; }
    if (!IMG[pk.sp]) continue;
    // snap to the nearest road: try spots along it and slide each one off the road until the picture fits
    let best = null;
    const rd = nearestRoad(pk.at, 700);
    if (rd) {
      const e = edges[rd.eid], half = RT[e.type].cw / 2;
      for (const shift of [0, 40, -40, 80, -80, 120, -120, 170, -170]) {
        const d0 = clamp(rd.t * e.len + shift, 20, e.len - 20);
        const p = pointAlong(e.pts, d0), a = pointAlong(e.pts, Math.max(0, d0 - 8)), b = pointAlong(e.pts, Math.min(e.len, d0 + 8));
        const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
        let n = [-dy / l, dx / l]; if ((pk.at[0] - p[0]) * n[0] + (pk.at[1] - p[1]) * n[1] < 0) n = [-n[0], -n[1]];
        const q = placeBeside(p, n, half, pk.w, pk.sp, 220);
        if (!q) continue;
        const f = footprint(q[0], q[1], pk.w, pk.sp);
        if (POIS.some(o => overlaps(f, footprint(o.x, o.y, o.w, o.sprite))) || placed.some(o => overlaps(f, o))) continue;
        best = q; break;
      }
    }
    if (!best) { console.warn('no room for parking', pk.at); continue; }
    const f = footprint(best[0], best[1], pk.w, pk.sp);
    placed.push(f);
    for (let i = decor.length - 1; i >= 0; i--) { const d = decor[i]; if (overlaps(f, footprint(d.x, d.y, d.w, d.sprite))) decor.splice(i, 1); }
    decor.push({ x: best[0], y: best[1], w: pk.w, sprite: pk.sp });
  }
}

// ---------- boats ----------
// a few boats sail along the coast at different distances, each its own way and speed
const BOATS = [
  { sp: 'boat_sail', w: 95, off: 300, v: 30, dir: 1, x: 1400 },
  { sp: 'boat_ferry', w: 120, off: 560, v: 42, dir: -1, x: 3600 },
  { sp: 'boat_fishing', w: 95, off: 420, v: 20, dir: -1, x: 6200 },
  { sp: 'boat_yacht', w: 100, off: 700, v: 60, dir: 1, x: 8800 },
];
function drawBoats(dt) {
  for (const b of BOATS) {
    const im = IMG[b.sp]; if (!im) continue;
    b.x += b.dir * b.v * dt;
    if (b.x > CITY.maxX + 1200) b.x = CITY.minX - 1200; else if (b.x < CITY.minX - 1200) b.x = CITY.maxX + 1200;
    const y = coastY(b.x) + b.off + 25 * Math.sin(b.x / 900);
    const y2 = coastY(b.x + b.dir * 20) + b.off + 25 * Math.sin((b.x + b.dir * 20) / 900);
    const h = Math.atan2(y2 - y, b.dir * 20);
    const len = b.w * im.height / im.width;
    ctx.save(); ctx.translate(b.x, y); ctx.rotate(h + Math.PI / 2);
    // wake behind the stern
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    for (let k = 1; k <= 3; k++) { const yy = len / 2 + k * 26; ctx.globalAlpha = 1 - k * 0.28; ctx.beginPath(); ctx.moveTo(-b.w * 0.3 - k * 5, yy); ctx.quadraticCurveTo(0, yy - 7, b.w * 0.3 + k * 5, yy); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.drawImage(im, -b.w / 2, -len / 2, b.w, len);
    ctx.restore();
  }
}

// ---------- train ----------
// leaves the station on one line, goes off the map, comes back, waits, then takes the other line
const RAIL_LEN = RAILS.map(R => { const c = [0]; for (let i = 1; i < R.length; i++) c.push(c[i - 1] + dist(R[i - 1], R[i])); return c; });
function railAt(k, s) {
  const R = RAILS[k], C = RAIL_LEN[k], L = C[C.length - 1];
  s = clamp(s, 0, L);
  let i = 1; while (i < C.length - 1 && C[i] < s) i++;
  const a = R[i - 1], b = R[i], t = (s - C[i - 1]) / ((C[i] - C[i - 1]) || 1);
  return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), h: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
const TRAIN_HOME = 820; // stop point: the whole train stands next to the station
const train = { line: 0, s: TRAIN_HOME, v: 0, dir: 1, wait: 6, cars: 4 };
function drawTrain(dt) {
  const eng = IMG.train_engine, car = IMG.train_car; if (!eng || !car) return;
  const L = RAIL_LEN[train.line][RAIL_LEN[train.line].length - 1];
  const W = 50, gap = 6, len = W * eng.height / eng.width, clen = W * car.height / car.width;
  if (train.wait > 0) { train.wait -= dt; if (train.wait <= 0 && train.dir < 0) { train.dir = 1; train.line = 1 - train.line; train.s = TRAIN_HOME; } }
  else {
    const end = train.dir > 0 ? L + 600 : TRAIN_HOME, left = Math.abs(end - train.s);
    const vmax = 70, vt = train.dir < 0 ? Math.min(vmax, Math.sqrt(2 * 6 * left) + 2) : vmax;
    train.v = train.v < vt ? Math.min(vt, train.v + 12 * dt) : vt;
    train.s += train.dir * train.v * dt;
    if (train.dir > 0 && train.s >= end) { train.dir = -1; train.wait = 4; train.v = 0; }
    else if (train.dir < 0 && train.s <= end) { train.s = end; train.v = 0; train.wait = 8 + Math.random() * 6; }
  }
  // engine first, then cars behind it, each turned along the track
  const parts = [[eng, len]]; for (let c = 0; c < train.cars; c++) parts.push([car, clen]);
  let off = 0;
  for (const [im, l] of parts) {
    const sc = train.s - train.dir * (off + l / 2);
    off += l + gap;
    if (sc < 0) continue;
    const p = railAt(train.line, sc);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.h + (train.dir > 0 ? Math.PI / 2 : -Math.PI / 2));
    ctx.drawImage(im, -W / 2, -l / 2, W, l); ctx.restore();
  }
}

// ---------- road signs ----------
const SIGNS = [];
const KID_PLACES = new Set(['kindergarten', 'school', 'park', 'library', 'toys', 'icecream', 'circus', 'cinema', 'dino', 'home']);
// one pedestrian-crossing sign per crossing with zebras, on a free corner
function buildSigns() {
  for (const n of nodes) {
    const es = n.edges.map(i => edges[i]).filter(e => !e.dead);
    if (es.length < 3 || es.some(e => e.ring)) continue;
    if (!es.some(e => (e.type === 'street' || e.type === 'avenue') && e.len >= 200)) continue;
    // only where children walk: next to kid places, and where avenues cross
    const nearKids = POIS.some(q => KID_PLACES.has(q.key) && Math.hypot(q.x - n.x, q.y - n.y) < 450);
    const avenue = es.filter(e => e.type === 'avenue').length >= 1 && es.some(e => e.type === 'street');
    if (!nearKids && !avenue) continue;
    const half = Math.max(...es.map(e => RT[e.type].cw / 2));
    for (const [dx, dy] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      const p = [n.x + dx * (half + 22), n.y + dy * (half + 22)];
      const onPoi = POIS.some(q => { const im = IMG[q.sprite], h = im ? q.w * im.height / im.width : q.w; return Math.abs(p[0] - q.x) < q.w * 0.5 + 16 && p[1] > q.y - 0.82 * h - 10 && p[1] - 50 < q.y + 0.18 * h; });
      if (roadClear(p, 8) && !inWater(p) && !onPoi) { SIGNS.push({ t: 'ped', x: p[0], y: p[1] }); break; }
    }
  }
}
function signShape(t, sz, time) {
  const r = sz / 2, k = Math.max(2, sz * 0.09);
  ctx.lineWidth = k; ctx.strokeStyle = '#2B2B3A';
  if (t === 'stop') {
    ctx.fillStyle = '#E53935'; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `900 ${sz * 0.3}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('STOP', 0, 1);
  } else if (t === 'ped') {
    ctx.fillStyle = '#1E6FD9'; roundRect(-r, -r, sz, sz, sz * 0.12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, -r * 0.75); ctx.lineTo(r * 0.75, r * 0.6); ctx.lineTo(-r * 0.75, r * 0.6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2B2B3A'; ctx.lineWidth = Math.max(1.5, sz * 0.06); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, -r * 0.18, sz * 0.07, 0, TAU); ctx.fillStyle = '#2B2B3A'; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -r * 0.05); ctx.lineTo(0, r * 0.22); ctx.moveTo(0, r * 0.22); ctx.lineTo(-r * 0.2, r * 0.48); ctx.moveTo(0, r * 0.22); ctx.lineTo(r * 0.2, r * 0.48); ctx.moveTo(-r * 0.22, r * 0.05); ctx.lineTo(r * 0.22, r * 0.05); ctx.stroke();
  } else if (t === 'speed') {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.lineWidth = sz * 0.14; ctx.strokeStyle = '#E53935'; ctx.beginPath(); ctx.arc(0, 0, r - sz * 0.07, 0, TAU); ctx.stroke();
    ctx.lineWidth = k; ctx.strokeStyle = '#2B2B3A'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#2B2B3A'; ctx.font = `900 ${sz * 0.42}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('40', 0, 1);
  } else if (t === 'ring') {
    ctx.fillStyle = '#1E6FD9'; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = sz * 0.1; ctx.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      const a0 = i * TAU / 3 + 0.3, a1 = a0 + 1.4, rr = r * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, rr, a0, a1); ctx.stroke();
      const hx = Math.cos(a1) * rr, hy = Math.sin(a1) * rr, ta = a1 + Math.PI / 2;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(ta) * sz * 0.14, hy + Math.sin(ta) * sz * 0.14);
      ctx.lineTo(hx + Math.cos(ta + 2.3) * sz * 0.12, hy + Math.sin(ta + 2.3) * sz * 0.12);
      ctx.lineTo(hx + Math.cos(ta - 2.3) * sz * 0.12, hy + Math.sin(ta - 2.3) * sz * 0.12); ctx.closePath(); ctx.fill();
    }
  } else if (t === 'park') {
    ctx.fillStyle = '#1E6FD9'; roundRect(-r, -r, sz, sz, sz * 0.12); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `900 ${sz * 0.72}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('P', 0, sz * 0.04);
  }
}
function drawSign(sg, sx, sy, s, time) {
  const post = 40 * s, sz = 24 * s;
  ctx.save(); ctx.translate(sx, sy);
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(0, 0, 7 * s, 3 * s, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#5B6270'; ctx.strokeStyle = '#2B2B3A'; ctx.lineWidth = Math.max(1.5, 1.6 * s);
  ctx.fillRect(-1.8 * s, -post, 3.6 * s, post); ctx.strokeRect(-1.8 * s, -post, 3.6 * s, post);
  if (sg.t === 'light') {
    const bw = 14 * s, bh = 36 * s, top = -post - bh + 6 * s;
    ctx.fillStyle = '#2F3440'; roundRect(-bw / 2, top, bw, bh, 4 * s); ctx.fill(); ctx.stroke();
    const ph = Math.floor((time + sg.x / 300) % 9), on = ph < 4 ? 2 : ph < 5 ? 1 : 0; // green 4s, yellow 1s, red 4s
    const cols = ['#FF3B30', '#FFCC00', '#34C759'];
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i === on ? cols[i] : '#4A505C';
      ctx.beginPath(); ctx.arc(0, top + bh * (0.2 + 0.3 * i), 4.2 * s, 0, TAU); ctx.fill();
      if (i === on) { ctx.globalAlpha = .3; ctx.beginPath(); ctx.arc(0, top + bh * (0.2 + 0.3 * i), 7.5 * s, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    }
  } else { ctx.translate(0, -post - sz * 0.35); signShape(sg.t, sz, time); }
  ctx.restore();
}
// ---------- routing ----------
function dirInfo(eid, dir) {
  const e = edges[eid];
  const from = dir > 0 ? e.a : e.b, to = dir > 0 ? e.b : e.a;
  const pts = dir > 0 ? e.pts : e.pts.slice().reverse();
  return { e, from, to, pts };
}
function headAt(pts, atStart) {
  const L = Math.min(55, dist(pts[0], pts[pts.length - 1]) * 0.6 + 1);
  if (atStart) { const q = pointAlong(pts, L); return Math.atan2(q[1] - pts[0][1], q[0] - pts[0][0]); }
  const q = pointAlong(pts, -L), z = pts[pts.length - 1];
  return Math.atan2(z[1] - q[1], z[0] - q[0]);
}
function outgoing(n) {
  const res = [];
  for (const eid of nodes[n].edges) {
    const e = edges[eid]; if (e.dead) continue;
    if (e.a === n) res.push([eid, 1]);
    if (e.b === n && !e.oneway) res.push([eid, -1]);
  }
  return res;
}
function findRoute(start, goal, heading) {
  const key = (e, d) => e * 2 + (d > 0 ? 0 : 1);
  const best = new Map(), prev = new Map();
  const heap = [];
  const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const cost = (e) => e.len / RT[e.type].v;
  for (const [eid, d] of outgoing(start)) {
    const di = dirInfo(eid, d);
    let c = cost(di.e);
    if (heading != null && Math.abs(angDiff(headAt(di.pts, true), heading)) > 2) c += 6;
    const k = key(eid, d); if (!(best.get(k) <= c)) { best.set(k, c); prev.set(k, null); push(c, k); }
  }
  while (heap.length) {
    const [c, k] = pop();
    if (c > best.get(k)) continue;
    const eid = k >> 1, d = (k & 1) ? -1 : 1;
    const di = dirInfo(eid, d);
    if (di.to === goal) {
      const route = []; let kk = k;
      while (kk != null) { route.unshift({ e: kk >> 1, d: (kk & 1) ? -1 : 1 }); kk = prev.get(kk); }
      return route;
    }
    const hin = headAt(di.pts, false);
    const outs = outgoing(di.to);
    for (const [e2, d2] of outs) {
      const uturn = e2 === eid;
      if (uturn && outs.length > 1) continue;
      const d2i = dirInfo(e2, d2);
      const turn = Math.abs(angDiff(headAt(d2i.pts, true), hin));
      if (turn > 2.1 && outs.length > 1) continue;
      let c2 = c + cost(d2i.e) + (turn > 2.1 ? 60 : turn > 1.2 ? 3 : turn > 0.5 ? 1 : 0);
      const k2 = key(e2, d2);
      if (!(best.get(k2) <= c2)) { best.set(k2, c2); prev.set(k2, k); push(c2, k2); }
    }
  }
  return null;
}

// ---------- maneuvers ----------
const ORD = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой'];
function maneuvers(route) {
  const list = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = dirInfo(route[i].e, route[i].d), b = dirInfo(route[i + 1].e, route[i + 1].d);
    const n = a.to;
    if (!a.e.ring && b.e.ring) {
      let k = i + 1; while (k < route.length && edges[route[k].e].ring) k++;
      const exit = k - (i + 1);
      list.push({ node: n, kind: 'ring', exit, text: `кольцо, ${exit}-й съезд`, say: `на круговом движении ${ORD[exit] || exit} съезд` });
      i = k - 1;
      continue;
    }
    if (a.e.ring) continue;
    const hin = headAt(a.pts, false);
    const opts = outgoing(n).filter(([e2]) => e2 !== a.e.id);
    const ang = angDiff(headAt(b.pts, true), hin); // >0 right
    if (opts.length < 2) {
      // no choice, but a sharp corner is still worth saying
      if (Math.abs(ang) > 1.0 && Math.abs(ang) < 2.6) list.push(ang > 0 ? { node: n, kind: 'right', text: 'направо', say: 'поверните направо' } : { node: n, kind: 'left', text: 'налево', say: 'поверните налево' });
      continue;
    }
    const others = opts.filter(([e2, d2]) => !(e2 === b.e.id && d2 === route[i + 1].d))
      .map(([e2, d2]) => angDiff(headAt(dirInfo(e2, d2).pts, true), hin));
    const A = Math.abs(ang);
    let m = null;
    if (A < 0.45) {
      const close = others.filter(o => Math.abs(o) < 0.9);
      if (close.length) {
        const right = close.every(o => ang > o);
        if (b.e.type === 'ramp' && a.e.type === 'highway') m = { kind: right ? 'exitR' : 'exitL', text: right ? 'съезд направо' : 'съезд налево', say: right ? 'съезд направо' : 'съезд налево' };
        else m = { kind: right ? 'keepR' : 'keepL', text: right ? 'держитесь правее' : 'держитесь левее', say: right ? 'держитесь правее' : 'держитесь левее' };
      }
    } else if (A < 1.0) {
      m = ang > 0 ? { kind: 'keepR', text: 'держитесь правее', say: 'держитесь правее' } : { kind: 'keepL', text: 'держитесь левее', say: 'держитесь левее' };
    } else if (A < 2.6) {
      m = ang > 0 ? { kind: 'right', text: 'направо', say: 'поверните направо' } : { kind: 'left', text: 'налево', say: 'поверните налево' };
    } else {
      m = { kind: 'uturn', text: 'разворот', say: 'развернитесь' };
    }
    if (m) { m.node = n; list.push(m); }
  }
  return list;
}

// nearest point on any road; returns {eid, t, p, d}
function nearestRoad(q, maxD = 1e9) {
  let best = null;
  for (const e of edges) {
    if (e.dead) continue;
    let acc = 0;
    for (let i = 1; i < e.pts.length; i++) {
      const a = e.pts[i - 1], b = e.pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, l = Math.sqrt(l2) || 1;
      const u = l2 ? clamp(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2, 0, 1) : 0;
      const p = [a[0] + u * dx, a[1] + u * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < maxD && (!best || d < best.d)) best = { eid: e.id, t: (acc + u * l) / e.len, p, d };
      acc += l;
    }
  }
  return best;
}
// a graph node at a road point: reuse an end node when close, otherwise split the road there
function nodeAtRoad(r) {
  const e = edges[r.eid];
  if (r.t * e.len < 20) return e.a;
  if ((1 - r.t) * e.len < 20) return e.b;
  return splitEdge(r.eid, r.t).n;
}

// ---------- path geometry ----------
function buildPath(route) {
  const raw = [];
  route.forEach((r, k) => {
    const di = dirInfo(r.e, r.d);
    const t = RT[di.e.type];
    di.pts.forEach((p, i) => { if (k > 0 && i === 0) return; raw.push({ p, lane: t.lane, v: t.v }); });
  });
  // round the corners
  const R = 46, pts = [raw[0]];
  for (let i = 1; i < raw.length - 1; i++) {
    const a = raw[i - 1].p, p = raw[i].p, b = raw[i + 1].p;
    const d1 = dist(a, p), d2 = dist(p, b);
    if (d1 < 0.01 || d2 < 0.01) continue;
    const u1 = [(p[0] - a[0]) / d1, (p[1] - a[1]) / d1], u2 = [(b[0] - p[0]) / d2, (b[1] - p[1]) / d2];
    const ang = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1));
    if (ang < 0.04) { pts.push(raw[i]); continue; }
    const cut = Math.min(R * Math.tan(Math.min(ang, 2.8) / 2), d1 * 0.45, d2 * 0.45);
    const p1 = [p[0] - u1[0] * cut, p[1] - u1[1] * cut], p2 = [p[0] + u2[0] * cut, p[1] + u2[1] * cut];
    const n = Math.max(2, Math.ceil(ang / 0.12));
    for (let k = 0; k <= n; k++) {
      const t = k / n, u = 1 - t;
      pts.push({ p: [u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]], lane: t < .5 ? raw[i].lane : raw[i + 1].lane, v: Math.min(raw[i].v, raw[i + 1].v) });
    }
  }
  pts.push(raw[raw.length - 1]);
  // resample every 3 m
  const S = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = dist(a.p, b.p);
    const n = Math.max(1, Math.ceil(l / 3));
    for (let k = 0; k < n; k++) { const t = k / n; S.push({ x: lerp(a.p[0], b.p[0], t), y: lerp(a.p[1], b.p[1], t), lane: lerp(a.lane, b.lane, t), v: b.v }); }
  }
  S.push({ x: pts[pts.length - 1].p[0], y: pts[pts.length - 1].p[1], lane: pts[pts.length - 1].lane, v: pts[pts.length - 1].v });
  const N = S.length;
  // smooth the centerline (2 passes, +-8 samples), ends stay fixed
  for (let pass = 0; pass < 4; pass++) {
    const xs = S.map(q => q.x), ys = S.map(q => q.y);
    for (let i = 1; i < N - 1; i++) {
      const r = Math.min(10, i, N - 1 - i); let sx = 0, sy = 0;
      for (let k = i - r; k <= i + r; k++) { sx += xs[k]; sy += ys[k]; }
      S[i].x = sx / (2 * r + 1); S[i].y = sy / (2 * r + 1);
    }
  }
  // smooth lane offset
  const lanes = S.map((_, i) => { let s = 0, c = 0; for (let k = Math.max(0, i - 35); k <= Math.min(N - 1, i + 35); k++) { s += S[k].lane; c++; } return s / c; });
  // offset to the right lane
  const out = S.map((q, i) => {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(N - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
    return { x: q.x - dy / l * lanes[i], y: q.y + dx / l * lanes[i], vmax: q.v };
  });
  // arc length, heading
  let s = 0;
  out.forEach((q, i) => { if (i) s += Math.hypot(q.x - out[i - 1].x, q.y - out[i - 1].y); q.s = s; });
  out.forEach((q, i) => { const a = out[Math.max(0, i - 2)], b = out[Math.min(N - 1, i + 2)]; q.h = Math.atan2(b.y - a.y, b.x - a.x); });
  // speed limits from curvature, braking pass
  const ALAT = 55, DEC = 28;
  out.forEach((q, i) => {
    const a = out[Math.max(0, i - 4)], b = out[Math.min(N - 1, i + 4)];
    const ds = (b.s - a.s) || 1, k = Math.abs(angDiff(b.h, a.h)) / ds;
    q.lim = Math.min(q.vmax, k > 1e-4 ? Math.sqrt(ALAT / k) : 999);
  });
  out[N - 1].lim = 0;
  for (let i = N - 2; i >= 0; i--) out[i].lim = Math.min(out[i].lim, Math.sqrt(out[i + 1].lim ** 2 + 2 * DEC * (out[i + 1].s - out[i].s)));
  // time to the end with this profile
  out[N - 1].tte = 0;
  for (let i = N - 2; i >= 0; i--) out[i].tte = out[i + 1].tte + (out[i + 1].s - out[i].s) / Math.max(8, (out[i].lim + out[i + 1].lim) / 2);
  return out;
}
function locate(path, p, from) {
  let bi = from, bd = 1e9;
  for (let i = from; i < path.length; i++) {
    const d = Math.hypot(path[i].x - p[0], path[i].y - p[1]);
    if (d < bd) { bd = d; bi = i; }
    if (d > bd + 300) break;
  }
  return bi;
}

// ---------- speech ----------
let muted = false, ruVoice = null;
function pickVoice() { const vs = speechSynthesis.getVoices(); ruVoice = vs.find(v => /^ru/i.test(v.lang)) || null; }
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, urgent) {
  if (muted || !('speechSynthesis' in window)) return;
  if (urgent) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU'; if (ruVoice) u.voice = ruVoice; u.rate = 1; u.pitch = 1.05;
  speechSynthesis.speak(u);
}
function sayDist(d) {
  if (d < 1000) { const n = Math.max(50, Math.round(d / 50) * 50); return n >= 1000 ? 'через 1 километр' : `через ${n} метров`; }
  const k = Math.round(d / 500) / 2;
  if (k === 1) return 'через 1 километр';
  if (k === 1.5) return 'через полтора километра';
  if (Number.isInteger(k)) return `через ${k} ${k < 5 ? 'километра' : 'километров'}`;
  return `через ${String(k).replace('.', ',')} километра`;
}
function fmtDist(d) {
  if (d < 1000) return `${Math.max(10, Math.round(d / 10) * 10)} м`;
  return `${(d / 1000).toFixed(1).replace('.', ',')} км`;
}

// ---------- arrows ----------
const SV = (inner) => `<svg viewBox="0 0 64 64" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ARROWS = {
  straight: SV('<path d="M32 58V12"/><path d="M18 26L32 12l14 14"/>'),
  right: SV('<path d="M20 58V34a10 10 0 0 1 10-10h22"/><path d="M40 12l12 12-12 12"/>'),
  left: SV('<path d="M44 58V34a10 10 0 0 0-10-10H12"/><path d="M24 12L12 24l12 12"/>'),
  keepR: SV('<path d="M22 58V40l22-22"/><path d="M28 16h18v18"/>'),
  keepL: SV('<path d="M42 58V40L20 18"/><path d="M36 16H18v18"/>'),
  exitR: SV('<path d="M20 58V8" opacity=".45"/><path d="M20 46c0-12 10-16 26-28"/><path d="M32 16h16v16"/>'),
  exitL: SV('<path d="M44 58V8" opacity=".45"/><path d="M44 46c0-12-10-16-26-28"/><path d="M32 16H16v16"/>'),
  uturn: SV('<path d="M42 58V28a11 11 0 0 0-22 0v14"/><path d="M10 32l10 12 10-12"/>'),
  ring: SV('<circle cx="32" cy="30" r="12" opacity=".4"/><path d="M32 60V42A12 12 0 0 0 40.5 21.5L50 12"/><path d="M41 11h10v10"/>'),
  finish: '<svg viewBox="0 0 64 64"><path d="M16 60V6" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M18 8h34l-8 11 8 11H18z" fill="#fff"/><path d="M26 8h8v11h-8zM34 19h8v11h-8zM18 19h8v11h-8z" fill="#1F6FD1"/></svg>',
};

// ---------- state ----------
const cv = $('map'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, rot: 0, scale: 1, fy: 0.5 };
const tgt = { x: 0, y: 0, rot: 0, scale: 1, fy: 0.5 };
let mode = 'idle'; // idle | preview | nav | arrived
const CARS = [['car_top', 'Красная'], ['car_police', 'Полиция'], ['car_cat', 'Котик'], ['car_blue', 'Синяя']];
let carSkin = 'car_top';
try { carSkin = localStorage.getItem('carSkin') || 'car_top'; } catch (e) { /* storage blocked */ }
let userZoom = 1;
let navZoom = 1, navFreeUntil = 0; // during a trip: pinch zoom factor, and the map is free (not following) until this time
const navBase = () => Math.min(W, H) / (330 + (trip ? trip.v : 0) * 2.6);
const car = { node: 0, x: 0, y: 0, h: -Math.PI / 2 };
let trip = null;   // {poi, route, path, man, s, v, mi, ...}
let wakeLock = null;
const confetti = [];
let plane = null, planeTimer = 6;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2.5);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
}
const baseScale = () => Math.min(W, H) / 1100;
function w2s(x, y) {
  const dx = x - cam.x, dy = y - cam.y, c = Math.cos(cam.rot), s = Math.sin(cam.rot);
  return [W / 2 + cam.scale * (dx * c - dy * s), H * cam.fy + cam.scale * (dx * s + dy * c)];
}
function s2w(sx, sy) {
  const dx = (sx - W / 2) / cam.scale, dy = (sy - H * cam.fy) / cam.scale, c = Math.cos(-cam.rot), s = Math.sin(-cam.rot);
  return [cam.x + dx * c - dy * s, cam.y + dx * s + dy * c];
}

// ---------- drawing ----------
const GRASS = '#9ED47F';
function strokePts(pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); }
function edgeVisible(e, view) {
  if (!e.bb) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of e.pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); } e.bb = [x0 - 100, y0 - 100, x1 + 100, y1 + 100]; }
  return !(e.bb[2] < view[0] || e.bb[0] > view[2] || e.bb[3] < view[1] || e.bb[1] > view[3]);
}
let bridgeSpans = null, overSpans = [];
function computeBridges() {
  bridgeSpans = [];
  for (const e of edges) {
    if (e.dead) continue;
    let run = null;
    const step = 6;
    for (let d = 0; d <= e.len; d += step) {
      const p = pointAlong(e.pts, d);
      const wet = inWater(p) || [-1, 1].some(s => { const q = pointAlong(e.pts, clamp(d + s * 20, 0, e.len)); return inWater(q); });
      if (wet) { if (!run) run = { e, pts: [] }; run.pts.push(p); }
      else if (run) { if (run.pts.length > 1) bridgeSpans.push(run); run = null; }
    }
    if (run && run.pts.length > 1) bridgeSpans.push(run);
  }
  const hw = edges.filter(e => !e.dead && e.type === 'highway');
  const reach = RT.highway.cw / 2 + RT.street.cw / 2 + 10;
  for (const e of edges) {
    if (e.dead || !e.overpass) continue;
    const pts = [];
    for (let d = 0; d <= e.len; d += 4) {
      const p = pointAlong(e.pts, d);
      if (hw.some(h => h.pts.some((q, i) => i && segDist(p, h.pts[i - 1], q) < reach))) pts.push(p);
    }
    if (pts.length > 1) overSpans.push({ e, pts });
  }
}
function drawGround(view) {
  // order: river banks, beach, river water, sea, waves. The sea covers the river mouth, no edges in the water
  const coast = (dy) => { ctx.beginPath(); ctx.moveTo(CITY.minX - 2000, coastY(CITY.minX - 2000) + dy); for (let x = CITY.minX - 2000; x <= CITY.maxX + 2000; x += 60) ctx.lineTo(x, coastY(x) + dy); ctx.lineTo(CITY.maxX + 2000, CITY.maxY + 3000); ctx.lineTo(CITY.minX - 2000, CITY.maxY + 3000); ctx.fill(); };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = '#7FD08A'; ctx.lineWidth = RIVER_W + 30; strokePts(RIVER);
  ctx.fillStyle = '#E9D9A6'; coast(-70);
  ctx.strokeStyle = '#5BB8F5'; ctx.lineWidth = RIVER_W; strokePts(RIVER);
  ctx.fillStyle = '#5BB8F5'; coast(0);
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  for (let x = CITY.minX; x < CITY.maxX; x += 260) for (let y = 4900; y < CITY.maxY + 600; y += 180) {
    const ox = x + ((y / 180) % 2) * 130;
    if (ox < view[0] - 100 || ox > view[2] + 100 || y < view[1] - 100 || y > view[3] + 100) continue;
    if (y < coastY(ox) + 60) continue;
    ctx.beginPath(); ctx.arc(ox, y, 26, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
  }
  ctx.lineCap = 'round';
  // lakes
  // all shores first, then all water, so lakes that touch merge into one
  const lakePath = (L, k) => { const pts = lakeShape(L, k); ctx.beginPath(); pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); };
  ctx.fillStyle = '#E9D9A6'; ctx.strokeStyle = '#E9D9A6'; ctx.lineWidth = 36;
  LAKES.forEach((L, k) => { lakePath(L, k); ctx.fill(); ctx.stroke(); });
  ctx.fillStyle = '#5BB8F5';
  LAKES.forEach((L, k) => { lakePath(L, k); ctx.fill(); });
  // park
  const pk = ZONES.park;
  ctx.fillStyle = '#86CC6A'; roundRect(pk[0], pk[1], pk[2] - pk[0], pk[3] - pk[1], 30); ctx.fill();
  ctx.strokeStyle = '#E8DDB5'; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(pk[0] + 20, pk[3] - 40); ctx.quadraticCurveTo((pk[0] + pk[2]) / 2, (pk[1] + pk[3]) / 2, pk[2] - 30, pk[1] + 40); ctx.stroke();
  // airport
  const ap = ZONES.airport;
  ctx.fillStyle = '#C9CDD3'; roundRect(ap[0], ap[1], ap[2] - ap[0], ap[3] - ap[1], 40); ctx.fill();
  const ry = ap[3] - 170; ctx.fillStyle = '#5E6470'; ctx.fillRect(ap[0] + 60, ry, ap[2] - ap[0] - 120, 110);
  ctx.fillStyle = '#fff';
  for (let x = ap[0] + 100; x < ap[2] - 120; x += 90) ctx.fillRect(x, ry + 50, 50, 10);
  for (let k = 0; k < 6; k++) { ctx.fillRect(ap[0] + 70, ry + 12 + k * 15, 26, 8); ctx.fillRect(ap[2] - 96, ry + 12 + k * 15, 26, 8); }
  // fields near grandma
  for (const [x0, y0, x1, y1, c] of FIELDS) {
    ctx.fillStyle = c; roundRect(x0, y0, x1 - x0, y1 - y0, 20); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.lineWidth = 8;
    for (let y = y0 + 30; y < y1 - 10; y += 34) { ctx.beginPath(); ctx.moveTo(x0 + 20, y); ctx.lineTo(x1 - 20, y); ctx.stroke(); }
  }
}
function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawRoads(view) {
  const vis = edges.filter(e => !e.dead && edgeVisible(e, view));
  const order = ['country', 'street', 'ring', 'avenue', 'ramp', 'highway', 'ringBig'];
  vis.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  // bridge decks
  for (const b of bridgeSpans) {
    if (!edgeVisible(b.e, view)) continue;
    const t = RT[b.e.type];
    b.rails = true;
  }
  for (const e of vis) { ctx.strokeStyle = RT[e.type].casing; ctx.lineWidth = RT[e.type].cw; strokePts(e.pts); }
  for (const e of vis) { ctx.strokeStyle = RT[e.type].color; ctx.lineWidth = RT[e.type].w; strokePts(e.pts); }
  // railway: ballast, sleepers, two rails, buffer stop at the station end
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#CDBFA6'; ctx.lineWidth = 50; RAILS.forEach(strokePts);
  ctx.strokeStyle = '#8B5E3C'; ctx.lineWidth = 34; ctx.setLineDash([7, 15]); RAILS.forEach(strokePts); ctx.setLineDash([]);
  ctx.strokeStyle = '#5B6270'; ctx.lineWidth = 5; for (const R of RAILS) { strokePts(offsetPts(R, -11)); strokePts(offsetPts(R, 11)); }
  ctx.lineCap = 'round';
  // roundabout islands
  for (const rb of roundabouts) {
    const half = RT[rb.type].w / 2;
    ctx.fillStyle = RT[rb.type].casing; ctx.beginPath(); ctx.arc(rb.cx, rb.cy, rb.r - half + 7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7BC96F'; ctx.beginPath(); ctx.arc(rb.cx, rb.cy, rb.r - half - 1, 0, TAU); ctx.fill();
    const fl = ['#FFD23F', '#F2545B', '#9B7BE0', '#FFFFFF'];
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; ctx.fillStyle = fl[k % 4]; ctx.beginPath(); ctx.arc(rb.cx + Math.cos(a) * 22, rb.cy + Math.sin(a) * 22, 6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#FFD23F'; ctx.beginPath(); ctx.arc(rb.cx, rb.cy, 9, 0, TAU); ctx.fill();
  }
  // markings
  for (const e of vis) {
    if (e.overpass) continue;
    const t = RT[e.type];
    const trim = (e.type === 'street' || e.type === 'avenue' || e.type === 'country') ? 60 : e.type === 'highway' ? 90 : 0;
    if (e.len < trim * 2 + 20) continue;
    const pts = trim ? e.pts.filter((p, i) => { const da = dist(p, e.pts[0]), db = dist(p, e.pts[e.pts.length - 1]); return da > trim && db > trim; }) : e.pts;
    if (pts.length < 2) continue;
    if (t.mark === 'dash') {
      ctx.strokeStyle = e.type === 'country' ? '#F5F0DC' : '#FFFFFF'; ctx.lineWidth = 4; ctx.setLineDash([26, 22]); ctx.lineCap = 'butt'; strokePts(pts); ctx.setLineDash([]); ctx.lineCap = 'round';
    } else if (t.mark === 'median') {
      ctx.strokeStyle = '#7BC96F'; ctx.lineWidth = 16; strokePts(pts);
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3; ctx.setLineDash([22, 22]); ctx.lineCap = 'butt';
      for (const s of [-1, 1]) strokePts(offsetPts(pts, s * 26));
      ctx.setLineDash([]); ctx.lineCap = 'round';
    } else if (t.mark === 'highway') {
      ctx.strokeStyle = '#FFD23F'; ctx.lineWidth = 5; strokePts(offsetPts(pts, 4)); strokePts(offsetPts(pts, -4));
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.setLineDash([30, 26]); ctx.lineCap = 'butt';
      for (const s of [-1, 1]) strokePts(offsetPts(pts, s * 34));
      ctx.setLineDash([]); ctx.lineCap = 'round';
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4;
      for (const s of [-1, 1]) strokePts(offsetPts(pts, s * 62));
    }
  }
  // bridge rails over water, drawn on the curb line
  ctx.strokeStyle = '#2B2B3A'; ctx.lineWidth = 4; ctx.lineCap = 'butt';
  for (const b of bridgeSpans) {
    if (!edgeVisible(b.e, view)) continue;
    const t = RT[b.e.type];
    for (const o of [-1, 1]) strokePts(offsetPts(b.pts, o * (t.cw / 2 - 2)));
  }
  ctx.lineCap = 'round';
  // overpasses: a deck only over the highway, same widths as the road so the joins are invisible
  for (const b of overSpans) {
    if (!edgeVisible(b.e, view)) continue;
    const t = RT[b.e.type];
    ctx.lineCap = 'butt';
    ctx.strokeStyle = t.casing; ctx.lineWidth = t.cw; strokePts(b.pts);
    ctx.strokeStyle = t.color; ctx.lineWidth = t.w; strokePts(b.pts);
    ctx.strokeStyle = '#2B2B3A'; ctx.lineWidth = 4;
    for (const o of [-1, 1]) strokePts(offsetPts(b.pts, o * (t.cw / 2 - 2)));
    ctx.lineCap = 'round';
  }
  for (const e of vis) {
    if (!e.overpass) continue;
    const pts = e.pts.length > 2 ? e.pts : [e.pts[0], pointAlong(e.pts, 60), pointAlong(e.pts, -60), e.pts[1]].slice(1, 3);
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.setLineDash([26, 22]); ctx.lineCap = 'butt'; strokePts(pts); ctx.setLineDash([]); ctx.lineCap = 'round';
  }
  // zebra crossings next to grid crossings
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  for (const e of vis) {
    if (e.type !== 'street' && e.type !== 'avenue') continue;
    if (e.len < 200) continue;
    for (const end of [0, 1]) {
      const n = end ? e.b : e.a;
      if (nodes[n].edges.length < 3 || nodes[n].edges.some(x => edges[x].ring)) continue;
      const pts = end ? e.pts.slice().reverse() : e.pts;
      const p = pointAlong(pts, 52), q = pointAlong(pts, 60);
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
      const hw = RT[e.type].w / 2 - 6;
      for (let y = -hw; y < hw - 4; y += 14) ctx.fillRect(-9, y, 18, 8);
      ctx.restore();
    }
  }
}
function offsetPts(pts, o) {
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [p[0] - dy / l * o, p[1] + dx / l * o]; });
}
function drawRoute() {
  if (!trip) return;
  const P = trip.path, i0 = mode === 'nav' ? trip.idx : 0;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (i0 > 0) {
    ctx.strokeStyle = 'rgba(120,130,150,.55)'; ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(P[0].x, P[0].y); for (let i = 1; i <= i0; i++) ctx.lineTo(P[i].x, P[i].y); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(mode === 'nav' ? car.x : P[0].x, mode === 'nav' ? car.y : P[0].y);
  for (let i = i0 + 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
  ctx.strokeStyle = '#1559B8'; ctx.lineWidth = 24; ctx.stroke();
  ctx.strokeStyle = '#3D8BFD'; ctx.lineWidth = 16; ctx.stroke();
  const end = P[P.length - 1], poi = trip.poi;
  ctx.strokeStyle = '#1559B8'; ctx.lineWidth = 9; ctx.setLineDash([2, 18]);
  ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(poi.x, poi.y - poi.w * 0.1); ctx.stroke(); ctx.setLineDash([]);
}
function drawSprite(name, sx, sy, wpx, emoji) {
  const im = IMG[name];
  if (im) {
    const h = wpx * im.height / im.width;
    ctx.drawImage(im, sx - wpx / 2, sy - h * 0.82, wpx, h);
    return [sx - wpx / 2, sy - h * 0.82, wpx, h];
  }
  if (!emoji) return null;
  const r = wpx * 0.32;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2B2B3A'; ctx.lineWidth = Math.max(2, r * 0.1);
  ctx.beginPath(); ctx.arc(sx, sy - r, r, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.font = `${Math.round(r * 1.2)}px system-ui, "Noto Color Emoji", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000'; ctx.fillText(emoji, sx, sy - r + r * 0.06);
  return [sx - r, sy - 2 * r, 2 * r, 2 * r];
}
function drawBillboards() {
  const items = [];
  const M = 260;
  for (const d of decor) {
    d.rect = null;
    const [sx, sy] = w2s(d.x, d.y);
    if (sx < -M || sx > W + M || sy < -M || sy > H + M) continue;
    const wpx = d.w * cam.scale; if (wpx < 4) continue;
    items.push({ sy, sx, wpx, name: d.sprite, dec: d });
  }
  for (const p of POIS) {
    const [sx, sy] = w2s(p.x, p.y);
    if (sx < -M || sx > W + M || sy < -M || sy > H + M) continue;
    items.push({ sy, sx, wpx: p.w * cam.scale, name: p.sprite, poi: p });
  }
  if (cam.scale > 0.22) for (const g of SIGNS) { const [sx, sy] = w2s(g.x, g.y); if (sx > -60 && sx < W + 60 && sy > -60 && sy < H + 120) items.push({ sy, sx, sign: g }); }
  items.sort((a, b) => a.sy - b.sy);
  for (const it of items) {
    if (it.sign) { drawSign(it.sign, it.sx, it.sy, cam.scale, performance.now() / 1000); continue; }
    const r = drawSprite(it.name, it.sx, it.sy, it.wpx, it.emoji);
    if (it.poi) it.poi.rect = r;
    if (it.dec) it.dec.rect = r;
  }
  // labels on top
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const it of items) {
    if (!it.poi) continue;
    const p = it.poi;
    const isTarget = trip && trip.poi === p;
    if (mode === 'nav' && !isTarget) continue;
    if (cam.scale < 0.2 && !isTarget) continue;
    const fs = 13;
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const tw = ctx.measureText(p.name).width + 14;
    const y = it.sy + 14;
    ctx.fillStyle = 'rgba(255,255,255,.92)'; roundRect(it.sx - tw / 2, y - 11, tw, 22, 11); ctx.fill();
    ctx.fillStyle = '#2B2B3A'; ctx.fillText(p.name, it.sx, y + 1);
  }
}
function drawCar(t) {
  // the map is always north-up: pick the car picture by direction, tilt a little on diagonals
  const [sx, sy] = w2s(car.x, car.y);
  const h = car.h + cam.rot;
  const q = ((Math.round(h / (Math.PI / 2)) % 4) + 4) % 4; // 0 right, 1 down, 2 left, 3 up
  const r = angDiff(h, q * Math.PI / 2);
  const views = { 0: ['car_side', 1, 1], 1: ['car_front', 1, 0.5], 2: ['car_side', -1, 1], 3: ['car', 1, 0.5] };
  let [name, flip, tilt] = views[q];
  const top = IMG[carSkin] || IMG.car_top;
  if (top) {
    // top view car: just turn it with the road
    const wpx = Math.max(18, 36 * cam.scale), hh = wpx * top.height / top.width;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(h + Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(3, 4, wpx * 0.5, hh * 0.48, 0, 0, TAU); ctx.fill();
    ctx.drawImage(top, -wpx / 2, -hh / 2, wpx, hh);
    if (carSkin === 'car_police' && mode === 'nav') {
      // flashing roof lights
      const on = Math.floor(t * 4) % 2;
      for (const [x, col, lit] of [[-0.24, '#1E6BFF', on], [0.24, '#FF2D2D', 1 - on]]) {
        if (!lit) continue;
        const g = ctx.createRadialGradient(x * wpx, -0.23 * hh, 0, x * wpx, -0.23 * hh, wpx * 0.55);
        g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.75; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x * wpx, -0.23 * hh, wpx * 0.55, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    return;
  }
  let im = IMG[name], rot = clamp(r * tilt, -0.45, 0.45);
  if (!im) { im = IMG.car; flip = 1; rot = h + Math.PI / 2; name = 'car'; } // fallback until all views exist
  const wpx = Math.max(20, (name === 'car_side' ? 58 : 40) * cam.scale);
  ctx.save(); ctx.translate(sx, sy);
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(0, wpx * 0.12, wpx * 0.52, wpx * 0.22, 0, 0, TAU); ctx.fill();
  ctx.rotate(rot); ctx.scale(flip, 1);
  if (im) { const hh = wpx * im.height / im.width; ctx.drawImage(im, -wpx / 2, -hh * 0.75, wpx, hh); }
  ctx.restore();
}
function drawPin(t) {
  if (!trip || (mode !== 'preview' && mode !== 'nav')) return;
  const p = trip.poi, r = p.dec ? p.dec.rect : p.rect;
  const [sx, sy] = w2s(p.x, p.y);
  const top = r ? r[1] : sy + 4; // a plain map point: the pin tip sits on the spot
  const bob = Math.sin(t * 4) * 6;
  const w = 44, im = IMG.pin;
  if (im) ctx.drawImage(im, sx - w / 2, top - w * im.height / im.width - 4 + bob, w, w * im.height / im.width);
}
function drawPlane(dt) {
  if (!IMG.airplane) return;
  if (!plane) {
    planeTimer -= dt; if (planeTimer > 0) return;
    const a = Math.random() * TAU, c = [cam.x, cam.y], R0 = 1800;
    plane = { x: c[0] - Math.cos(a) * R0, y: c[1] - Math.sin(a) * R0, h: a, t: 0 };
  }
  plane.x += Math.cos(plane.h) * 160 * dt; plane.y += Math.sin(plane.h) * 160 * dt; plane.t += dt;
  if (plane.t > 24) { plane = null; planeTimer = 25 + Math.random() * 20; return; }
  const im = IMG.airplane, w = 150 * cam.scale, hgt = w * im.height / im.width;
  for (const shadow of [true, false]) {
    const [sx, sy] = w2s(plane.x + (shadow ? 60 : 0), plane.y + (shadow ? 90 : 0));
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(plane.h + cam.rot + Math.PI / 2);
    if (shadow) { ctx.globalAlpha = 0.18; ctx.filter = 'brightness(0)'; }
    ctx.drawImage(im, -w / 2, -hgt / 2, w, hgt);
    ctx.restore();
  }
}
function drawConfetti(dt) {
  if (!confetti.length) return;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.vy += 400 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.r += c.vr * dt; c.life -= dt;
    if (c.life <= 0 || c.y > H + 20) { confetti.splice(i, 1); continue; }
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.fillStyle = c.col; ctx.fillRect(-5, -3, 10, 6); ctx.restore();
  }
}

// ---------- camera ----------
function fitRoute() {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of trip.path) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const p = trip.poi; x0 = Math.min(x0, p.x - 100); x1 = Math.max(x1, p.x + 100); y0 = Math.min(y0, p.y - 200); y1 = Math.max(y1, p.y + 60);
  const availH = H - 260, availW = W - 40;
  tgt.scale = clamp(Math.min(availW / (x1 - x0 + 200), availH / (y1 - y0 + 200)), 0.05, 2);
  tgt.x = (x0 + x1) / 2; tgt.y = (y0 + y1) / 2 + 110 / tgt.scale; tgt.rot = 0; tgt.fy = 0.5;
}
function updateCamera(dt) {
  if (mode === 'nav') {
    tgt.scale = navBase() * navZoom;
    tgt.rot = 0; tgt.fy = 0.55;
    if (performance.now() > navFreeUntil) { tgt.x = car.x; tgt.y = car.y; }
    $('btnCenter').classList.toggle('hidden', performance.now() > navFreeUntil);
  }
  const k = 1 - Math.exp(-dt * (mode === 'nav' ? 6 : 4));
  const kp = mode === 'nav' ? 1 - Math.exp(-dt * 12) : k;
  cam.x = lerp(cam.x, tgt.x, kp); cam.y = lerp(cam.y, tgt.y, kp);
  cam.scale = Math.exp(lerp(Math.log(cam.scale), Math.log(tgt.scale), k));
  cam.rot += angDiff(tgt.rot, cam.rot) * (1 - Math.exp(-dt * 3.5));
  cam.fy = lerp(cam.fy, tgt.fy, k);
}

// ---------- trip ----------
function startPreview(poi) {
  if (poi.node === car.node) return;
  const route = findRoute(car.node, poi.node, car.h);
  if (!route) return;
  const path = buildPath(route);
  const man = maneuvers(route);
  let from = 0;
  for (const m of man) { const i = locate(path, P(m.node), from); m.i = i; m.s = path[i].s; from = i; }
  trip = { poi, route, path, man, s: 0, v: 0, idx: 0, mi: 0, said: {}, L: path[path.length - 1].s };
  mode = 'preview';
  car.x = path[0].x; car.y = path[0].y; car.h = path[0].h;
  fitRoute();
  setPic($('pvPic'), poi);
  $('pvName').textContent = poi.name;
  $('pvInfo').textContent = `${fakeMin(path[0].tte)} мин · ${fmtDist(trip.L)}`;
  ui();
}
const fakeMin = t => Math.max(1, Math.round(t * 10 / 60));
function startNav() {
  if (!trip) return;
  mode = 'nav';
  trip.s = 0; trip.v = 0; trip.idx = 0; trip.mi = 0; trip.said = {};
  navZoom = 1; navFreeUntil = 0;
  say(kidName ? `${kidName}, поехали! ${trip.poi.phrase}!` : trip.poi.phrase + '! Поехали!', true);
  requestWake();
  ui();
}
function stopNav() {
  if (mode === 'nav' && trip) {
    const r = nearestRoad([car.x, car.y]);
    if (r) car.node = nodeAtRoad(r); // the car stays here; the next trip starts from this spot
  }
  mode = 'idle'; trip = null;
  engineStop(); saveFuel();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseWake();
  tgt.x = car.x; tgt.y = car.y; tgt.rot = 0; tgt.scale = baseScale() * userZoom; tgt.fy = 0.5;
  ui();
}
function arrive() {
  mode = 'arrived';
  car.node = trip.poi.node;
  say(kidName ? `Ура, ${kidName}, мы приехали! ${trip.poi.name}!` : 'Вы прибыли! ' + trip.poi.name + '!', true);
  $('arTitle').textContent = kidName ? `Ура, ${kidName}!` : 'Вы прибыли!';
  const arPic = $('arPic'), arPlace = $('arPlace');
  arPlace.innerHTML = '';
  if (kidPhoto) {
    arPic.className = 'pic photo'; arPic.innerHTML = '';
    const k = document.createElement('img'); k.className = 'kid'; k.src = kidPhoto; arPic.appendChild(k);
    setPic(arPlace, trip.poi);
  } else { arPic.className = 'pic'; setPic(arPic, trip.poi); }
  $('arName').textContent = trip.poi.name;
  const cols = ['#F2545B', '#FFD23F', '#5BB8F5', '#7BC96F', '#9B7BE0', '#FF9F40'];
  engineStop(); saveFuel();
  if (isGas(trip.poi) && fuel < 0.99) { say('Заправляемся!'); setTimeout(() => { refuelAnim = true; }, 2500); }
  for (let i = 0; i < 140; i++) confetti.push({ x: W / 2, y: H * 0.35, vx: (Math.random() - .5) * 700, vy: -Math.random() * 650 - 150, r: Math.random() * 6, vr: (Math.random() - .5) * 12, col: cols[i % cols.length], life: 3 + Math.random() * 1.5 });
  releaseWake();
  ui();
}
// ---------- sounds ----------
let actx = null, engineOn = true;
const SND = {};
try { engineOn = localStorage.getItem('engineOn') !== '0'; } catch (e) { }
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
async function sound(name, file) {
  if (SND[name]) return SND[name];
  const a = audio(); if (!a) return null;
  try { const buf = await (await fetch(file)).arrayBuffer(); SND[name] = await a.decodeAudioData(buf); } catch (e) { SND[name] = null; }
  return SND[name];
}
addEventListener('pointerdown', () => { audio(); sound('ign', 'snd/ignition.mp3'); sound('eng', 'snd/engine.ogg'); }, { once: true });
let eng = null; // {src, gain}
async function engineStart() {
  if (muted || !engineOn || eng || mode !== 'nav') return;
  const b = await sound('eng', 'snd/engine.ogg'); const a = audio(); if (!b || !a || eng || mode !== 'nav') return;
  const src = a.createBufferSource(), gain = a.createGain();
  src.buffer = b; src.loop = true; src.connect(gain).connect(a.destination);
  gain.gain.setValueAtTime(0, a.currentTime); gain.gain.linearRampToValueAtTime(0.5, a.currentTime + 0.6);
  src.start(); eng = { src, gain };
}
function engineSpeed(v) {
  if (!eng) return;
  const k = Math.min(1, v / 110), a = actx;
  eng.src.playbackRate.setTargetAtTime(0.85 + 0.75 * k, a.currentTime, 0.3);
  eng.gain.gain.setTargetAtTime(0.5 + 0.35 * k, a.currentTime, 0.3);
}
function engineStop() {
  if (!eng) return;
  const e = eng, a = actx; eng = null;
  e.gain.gain.setTargetAtTime(0, a.currentTime, 0.15);
  setTimeout(() => { try { e.src.stop(); } catch (err) { } }, 900);
}
async function ignition() {
  const btn = $('pvGo');
  if (btn.disabled) return;
  if (muted) { startNav(); return; }
  btn.disabled = true; btn.classList.add('turning');
  const b = await sound('ign', 'snd/ignition.mp3'), a = audio();
  if (b && a) { const s = a.createBufferSource(), g = a.createGain(); g.gain.value = 0.9; s.buffer = b; s.connect(g).connect(a.destination); s.start(); }
  setTimeout(() => { btn.disabled = false; btn.classList.remove('turning'); startNav(); engineStart(); }, 1600);
}

// ---------- fuel ----------
const FUEL_METERS = 35000, FUEL_MIN = 0.05; // a full tank is about 8 trips; never runs dry
let fuel = 1, fuelSaved = 0, refuelAnim = null;
try { const f = parseFloat(localStorage.getItem('fuel')); if (f >= 0) fuel = Math.max(FUEL_MIN, Math.min(1, f)); } catch (e) { }
const saveFuel = () => { try { localStorage.setItem('fuel', fuel.toFixed(3)); } catch (e) { } };
const isGas = p => p && (p.key === 'gas' || p.key === 'gas2');
function burnFuel(meters) {
  const before = fuel;
  fuel = Math.max(FUEL_MIN, fuel - meters / FUEL_METERS);
  const who = kidName ? kidName + ', ' : '';
  if (before > 0.15 && fuel <= 0.15) say(cap(who + 'бензин заканчивается! Поехали на заправку!'));
  if (performance.now() - fuelSaved > 3000) { fuelSaved = performance.now(); saveFuel(); }
}
function drawFuel(dt) {
  if (refuelAnim) {
    fuel = Math.min(1, fuel + dt / 4);
    if (fuel >= 1) { refuelAnim = null; saveFuel(); say('Бак полный! Можно ехать!'); }
  }
  const el = $('fuel'), low = fuel < 0.25;
  $('fuelBar').style.width = Math.round(fuel * 100) + '%';
  $('fuelBar').style.background = fuel < 0.25 ? '#F2545B' : fuel < 0.5 ? '#FFB020' : '#27AE60';
  el.classList.toggle('low', low && mode === 'idle');
  el.classList.toggle('hidden', mode === 'preview');
}
function nearestGas() {
  let best = null;
  for (const p of POIS) if (isGas(p)) { const d = Math.hypot(p.x - car.x, p.y - car.y); if (!best || d < best.d) best = { p, d }; }
  return best && best.p;
}
function updateTrip(dt) {
  if (mode !== 'nav' || !trip) return;
  const P = trip.path;
  const lim = P[trip.idx].lim, ahead = P[Math.min(P.length - 1, trip.idx + 6)].lim;
  const vt = Math.min(lim, ahead);
  if (trip.v < vt) trip.v = Math.min(vt, trip.v + 22 * dt); else trip.v = Math.max(vt, trip.v - 40 * dt);
  trip.v = Math.max(trip.v, 4);
  trip.s += trip.v * dt;
  burnFuel(trip.v * dt);
  engineSpeed(trip.v);
  if (trip.s >= trip.L - 0.5) { const q = P[P.length - 1]; car.x = q.x; car.y = q.y; car.h = q.h; arrive(); return; }
  while (trip.idx < P.length - 2 && P[trip.idx + 1].s <= trip.s) trip.idx++;
  const a = P[trip.idx], b = P[trip.idx + 1], t = (trip.s - a.s) / ((b.s - a.s) || 1);
  car.x = lerp(a.x, b.x, t); car.y = lerp(a.y, b.y, t); car.h = a.h + angDiff(b.h, a.h) * t;

  // instructions
  while (trip.mi < trip.man.length && trip.man[trip.mi].s < trip.s - 8) {
    trip.mi++;
    const nd = (trip.mi < trip.man.length ? trip.man[trip.mi].s : trip.L) - trip.s;
    if (nd > 1300) say(`Прямо ${sayDist(nd).replace('через ', '')}`);
  }
  const m = trip.man[trip.mi];
  const d = (m ? m.s : trip.L) - trip.s;
  const v = trip.v, far = Math.max(260, v * 7), near = Math.max(70, v * 2.4);
  const key = trip.mi;
  if (m && m.kind === 'ring') {
    if (!trip.said['f' + key] && d < far && d > near * 1.5) { trip.said['f' + key] = 1; say(`${cap(sayDist(d))} ${m.say}`); }
    if (!trip.said['n' + key] && d < near) { trip.said['n' + key] = 1; trip.said['f' + key] = 1; say(cap(m.say), true); }
  } else if (!m && !trip.said.fin && d < far && d > 60) { trip.said.fin = 1; say(`${cap(sayDist(d))} вы на месте`); }

  // banner and trip bar
  const kind = m ? m.kind : 'finish';
  if ($('bArrow').dataset.k !== kind) { $('bArrow').innerHTML = ARROWS[kind] || ARROWS.straight; $('bArrow').dataset.k = kind; }
  $('bDist').textContent = fmtDist(d);
  $('bText').textContent = m ? m.text : 'место назначения';
  const rem = trip.L - trip.s;
  const tte = P[trip.idx].tte;
  const mins = fakeMin(tte);
  const eta = new Date(Date.now() + mins * 60000);
  $('tTime').textContent = `${mins} мин`;
  $('tInfo').textContent = `${fmtDist(rem)} · ${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}`;
  $('spd').textContent = Math.round(v);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- UI ----------
function setPic(el, poi) {
  el.innerHTML = '';
  if (IMG[poi.sprite]) { const i = document.createElement('img'); i.src = IMG[poi.sprite].src; el.appendChild(i); }
  else el.textContent = poi.emoji;
}
function buildDests() {
  const box = $('dests'); box.innerHTML = '';
  for (const p of POIS) {
    const b = document.createElement('button'); b.className = 'dest'; b.dataset.key = p.key;
    const pic = document.createElement('div'); pic.className = 'pic'; setPic(pic, p);
    const l = document.createElement('div'); l.className = 'lbl'; l.textContent = p.name;
    b.append(pic, l);
    b.onclick = () => startPreview(p);
    box.appendChild(b);
  }
}
function ui() {
  document.body.classList.toggle('nav', mode === 'nav');
  $('dests').classList.toggle('hidden', mode !== 'idle');
  $('preview').classList.toggle('hidden', mode !== 'preview');
  $('arrived').classList.toggle('hidden', mode !== 'arrived');
  $('banner').classList.toggle('hidden', mode !== 'nav');
  $('tripbar').classList.toggle('hidden', mode !== 'nav');
  $('speed').classList.toggle('hidden', mode !== 'nav');
  $('btnStop').classList.toggle('hidden', mode !== 'nav');
  $('btnCenter').classList.toggle('hidden', mode !== 'idle');
  $('btnCar').classList.toggle('hidden', mode !== 'idle');
  if (mode !== 'idle') $('garage').classList.add('hidden');
  for (const b of document.querySelectorAll('#dests .dest')) b.classList.toggle('here', POIS.find(p => p.key === b.dataset.key).node === car.node);
}
async function requestWake() { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) { /* not available */ } }
function releaseWake() { try { wakeLock?.release(); } catch (e) { } wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && mode === 'nav') requestWake(); });

function buildGarage() {
  const box = $('garageList'); box.innerHTML = '';
  for (const [name, label] of CARS) {
    if (!IMG[name]) continue;
    const b = document.createElement('button'); b.className = 'dest' + (name === carSkin ? ' sel' : '');
    const pic = document.createElement('div'); pic.className = 'pic'; const i = document.createElement('img'); i.src = IMG[name].src; pic.appendChild(i);
    const l = document.createElement('div'); l.className = 'lbl'; l.textContent = label;
    b.append(pic, l);
    b.onclick = () => { carSkin = name; try { localStorage.setItem('carSkin', name); } catch (e) { } $('btnCar').innerHTML = `<img src="${IMG[name].src}" alt="">`; $('garage').classList.add('hidden'); };
    box.appendChild(b);
  }
  $('btnCar').innerHTML = `<img src="${(IMG[carSkin] || IMG.car_top || IMG.car).src}" alt="">`;
}
// driver: name and photo live only on this phone (localStorage), never in the app files
let kidName = '', kidPhoto = '';
const DEFAULT_NAME = 'Костя', DEFAULT_PHOTO = 'img/kostya.jpg';
kidName = DEFAULT_NAME; kidPhoto = DEFAULT_PHOTO;
try { const n = localStorage.getItem('kidName'), p = localStorage.getItem('kidPhoto'); if (n !== null) kidName = n; if (p) kidPhoto = p; } catch (e) { }
function showDriver() {
  $('kidName').value = kidName;
  const b = $('photoBtn');
  b.style.backgroundImage = kidPhoto ? `url(${kidPhoto})` : ''; b.textContent = kidPhoto ? '' : '📷';
}
$('kidName').oninput = e => { kidName = e.target.value.trim(); try { localStorage.setItem('kidName', kidName); } catch (err) { } };
$('photoBtn').onclick = () => $('photoFile').click();
$('photoFile').onchange = e => {
  const f = e.target.files && e.target.files[0]; if (!f) return;
  const im = new Image();
  im.onload = () => {
    // square crop from the centre, 360 px, JPEG: small enough for local storage
    const S = 360, c = document.createElement('canvas'); c.width = c.height = S;
    const m = Math.min(im.width, im.height);
    c.getContext('2d').drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, S, S);
    kidPhoto = c.toDataURL('image/jpeg', 0.85);
    try { localStorage.setItem('kidPhoto', kidPhoto); } catch (err) { }
    URL.revokeObjectURL(im.src); showDriver();
  };
  im.src = URL.createObjectURL(f);
};
$('btnCar').onclick = () => { buildGarage(); showDriver(); showEngineToggle(); $('garage').classList.toggle('hidden'); };
$('garageClose').onclick = () => $('garage').classList.add('hidden');
$('pvGo').onclick = ignition;
$('fuel').onclick = () => { if (mode !== 'idle') return; const g = nearestGas(); if (g) startPreview(g); };
$('engineToggle').onclick = () => {
  engineOn = !engineOn; try { localStorage.setItem('engineOn', engineOn ? '1' : '0'); } catch (e) { }
  showEngineToggle(); if (!engineOn) engineStop();
};
function showEngineToggle() { $('engineToggle').textContent = engineOn ? '🔊 Звук мотора: вкл' : '🔇 Звук мотора: выкл'; }
$('pvCancel').onclick = stopNav;
$('btnStop').onclick = stopNav;
$('arOk').onclick = () => { trip = null; stopNav(); };
$('btnMute').onclick = () => { muted = !muted; $('btnMute').textContent = muted ? '🔇' : '🔊'; if (muted) { speechSynthesis?.cancel(); engineStop(); } else engineStart(); };
$('btnCenter').onclick = () => {
  if (mode === 'nav') { navFreeUntil = 0; navZoom = 1; return; }
  tgt.x = car.x; tgt.y = car.y; userZoom = 1; tgt.scale = baseScale();
};

// pan, pinch, tap
const ptrs = new Map();
let gesture = null;
cv.addEventListener('pointerdown', e => {
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or lost pointer */ }
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  gesture = { moved: false, start: [e.clientX, e.clientY], pinch: ptrs.size === 2 ? pinchDist() : 0, scale0: tgt.scale };
});
cv.addEventListener('pointermove', e => {
  if (!ptrs.has(e.pointerId) || !gesture) return;
  const old = ptrs.get(e.pointerId);
  ptrs.set(e.pointerId, [e.clientX, e.clientY]);
  if (mode === 'arrived') return;
  if (Math.hypot(e.clientX - gesture.start[0], e.clientY - gesture.start[1]) > 10) gesture.moved = true;
  if (!gesture.moved) return;
  if (ptrs.size === 2 && gesture.pinch) {
    const f = pinchDist() / gesture.pinch;
    if (mode === 'nav') { navZoom = clamp(gesture.scale0 * f / navBase(), 0.25, 3); tgt.scale = cam.scale = navBase() * navZoom; }
    else { tgt.scale = cam.scale = clamp(gesture.scale0 * f, baseScale() * 0.15, baseScale() * 4); userZoom = tgt.scale / baseScale(); }
  } else if (ptrs.size === 1) {
    const a = s2w(old[0], old[1]), b = s2w(e.clientX, e.clientY);
    tgt.x = cam.x = clamp(cam.x - (b[0] - a[0]), CITY.minX, CITY.maxX);
    tgt.y = cam.y = clamp(cam.y - (b[1] - a[1]), CITY.minY, CITY.maxY);
    if (mode === 'nav') navFreeUntil = performance.now() + 8000; // back to the car after 8 s
  }
});
function pinchDist() { const [a, b] = [...ptrs.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; }
let lastTap = { t: 0, x: 0, y: 0 };
function endPtr(e) {
  const wasTap = gesture && !gesture.moved && ptrs.size === 1;
  ptrs.delete(e.pointerId);
  if (wasTap && (mode === 'idle' || mode === 'preview')) {
    const now = performance.now();
    const dbl = now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40;
    lastTap = dbl ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
    if (dbl) customTarget(e.clientX, e.clientY); else tapAt(e.clientX, e.clientY);
  }
  if (!ptrs.size) gesture = null;
}
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); gesture = null; });
cv.addEventListener('wheel', e => {
  if (mode === 'arrived') return;
  if (mode === 'nav') { navZoom = clamp(navZoom * Math.exp(-e.deltaY * 0.0015), 0.25, 3); return; }
  tgt.scale = clamp(tgt.scale * Math.exp(-e.deltaY * 0.0015), baseScale() * 0.15, baseScale() * 4);
  userZoom = tgt.scale / baseScale();
}, { passive: true });
const alphaMasks = {};
function opaqueAt(name, u, v) {
  const im = IMG[name]; if (!im) return false;
  let m = alphaMasks[name];
  if (!m) {
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    m = alphaMasks[name] = { w: im.width, h: im.height, a: g.getImageData(0, 0, im.width, im.height).data };
  }
  const px = clamp(Math.floor(u * m.w), 0, m.w - 1), py = clamp(Math.floor(v * m.h), 0, m.h - 1);
  return m.a[(py * m.w + px) * 4 + 3] > 40;
}
const BUILDINGS = new Set(['house_1', 'house_2', 'house_3', 'house_4', 'apartment_1', 'apartment_2', 'office_tower']);
const CUSTOM_NAMES = { house_1: 'Домик', house_2: 'Домик', house_3: 'Домик', house_4: 'Домик', apartment_1: 'Многоэтажка', apartment_2: 'Многоэтажка', office_tower: 'Офис', tree_1: 'Дерево', tree_2: 'Ёлка', tree_3: 'Дерево', bush: 'Кустик', pond: 'Пруд' };
function customTarget(x, y) {
  if (POIS.some(p => p.rect && x > p.rect[0] && x < p.rect[0] + p.rect[2] && y > p.rect[1] && y < p.rect[1] + p.rect[3])) return; // a real place: already handled by single tap
  // a building or tree under the finger?
  let hit = null;
  // the picture really under the finger (non-transparent pixel, topmost wins); only buildings count
  for (const d of decor) {
    const r = d.rect; if (!r || x < r[0] || x > r[0] + r[2] || y < r[1] || y > r[1] + r[3]) continue;
    if (!opaqueAt(d.sprite, (x - r[0]) / r[2], (y - r[1]) / r[3])) continue;
    if (!hit || d.y > hit.y) hit = d;
  }
  if (!hit || !BUILDINGS.has(hit.sprite)) return;
  const road = nearestRoad([hit.x, hit.y], 600);
  if (!road) return;
  const n = nodeAtRoad(road);
  startPreview({ key: 'custom', name: CUSTOM_NAMES[hit.sprite] || 'Дом', sprite: hit.sprite, emoji: '🏠', node: n, x: hit.x, y: hit.y, w: hit.w, dec: hit, phrase: 'Едем в гости' });
}
function tapAt(x, y) {
  let hit = null, bd = 1e9;
  for (const p of POIS) {
    const r = p.rect; if (!r) continue;
    const pad = 12;
    if (x > r[0] - pad && x < r[0] + r[2] + pad && y > r[1] - pad && y < r[1] + r[3] + 30) {
      const d = Math.hypot(x - (r[0] + r[2] / 2), y - (r[1] + r[3] / 2));
      if (d < bd) { bd = d; hit = p; }
    }
  }
  if (hit) startPreview(hit);
}

// ---------- main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  updateTrip(dt);
  drawFuel(dt);
  updateCamera(dt);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = GRASS; ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H * cam.fy); ctx.rotate(cam.rot); ctx.scale(cam.scale, cam.scale); ctx.translate(-cam.x, -cam.y);
  const c0 = s2w(0, 0), c1 = s2w(W, 0), c2 = s2w(0, H), c3 = s2w(W, H);
  const view = [Math.min(c0[0], c1[0], c2[0], c3[0]), Math.min(c0[1], c1[1], c2[1], c3[1]), Math.max(c0[0], c1[0], c2[0], c3[0]), Math.max(c0[1], c1[1], c2[1], c3[1])];
  drawGround(view);
  drawRoads(view);
  drawGroundLots();
  drawTrain(dt);
  drawBoats(dt);
  drawRoute();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBillboards();
  drawPin(t);
  drawCar(t);
  drawPlane(dt);
  drawConfetti(dt);
  requestAnimationFrame(frame);
}

// ---------- boot ----------
async function boot() {
  resize();
  addEventListener('resize', () => { resize(); if (mode === 'idle') tgt.scale = baseScale() * userZoom; if (mode === 'preview') fitRoute(); });
  buildCity();
  await loadSprites();
  hashRoads();
  placePois();
  // buildSigns(); // road signs: off for now
  computeBridges();
  buildDecor();
  placeParkings();
  const home = POIS.find(p => p.key === 'home');
  car.node = home.node; car.x = nodes[home.node].x; car.y = nodes[home.node].y + RT.street.lane; car.h = Math.PI;
  cam.x = tgt.x = car.x; cam.y = tgt.y = car.y; cam.scale = tgt.scale = baseScale();
  buildDests();
  buildGarage();
  ui();
  requestAnimationFrame(frame);
  window.__nav = { POIS, decor, startPreview, startNav, nodes, edges, get trip() { return trip; }, get mode() { return mode; }, cam, car };
}
boot();
