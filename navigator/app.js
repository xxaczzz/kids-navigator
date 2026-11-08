'use strict';
const APP_VERSION = 'v47'; // keep in sync with VERSION in sw.js
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
  ['kindergarten', 'Садик', 'kindergarten', '🧸', 'Av2,3', .5, 1, 200, 'Едем в садик'],
  ['school', 'Школа', 'school', '🏫', 'Av0,2', .5, -1, 175, 'Едем в школу'],
  ['shop', 'Магазин', 'shop', '🛒', 'Ah3,3', .5, -1, 140, 'Едем в магазин'],
  ['gas', 'Заправка', 'gas_station', '⛽', 'Ah5,2', .5, 1, 170, 'Едем на заправку'],
  ['gas2', 'Заправка', 'gas_station', '⛽', 'Bh6,3', .5, 1, 170, 'Едем на заправку'],
  ['service', 'Автосервис', 'car_service', '🔧', 'Ah6,4', .5, 1, 170, 'Едем в автосервис'],
  ['chargeW', 'Зарядка', 'charger', '⚡', 'Ah0,1', .5, 1, 160, 'Едем на зарядку'],
  ['chargeE', 'Зарядка', 'charger', '⚡', 'Bv7,0', .5, 1, 160, 'Едем на зарядку'],
  ['fire', 'Пожарные', 'fire_station', '🚒', 'Av6,0', .5, -1, 160, 'Едем к пожарным'],
  ['park', 'Парк', 'playground', '🛝', 'Ah5,0', .45, 1, 170, 'Едем в парк'],
  ['police', 'Полиция', 'police', '🚓', 'Av4,3', .5, 1, 160, 'Едем в полицию'],
  ['carwash', 'Мойка', 'car_wash', '🧽', 'Av8,3', .5, 1, 175, 'Едем на мойку'],
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
  ['pineapples', 'Мои ананасы', 'pineapples', '🍍', 'blv@2350', .5, -1, 200, 'Едем к ананасам'],
  ['beach', 'Пляж', 'beach', '🏖️', 'blv@5400', .5, 1, 170, 'Едем на пляж'],
  ['port', 'Пристань', 'port', '⛵', 'blv@6600', .5, 1, 170, 'Едем на пристань'],
  ['aquapark', 'Аквапарк', 'aquapark', '💦', 'blv@10300', .5, -1, 240, 'Едем в аквапарк'],
  ['bakery', 'Пекарня', 'bakery', '🥖', 'Ah2,1', .5, 1, 130, 'Едем в пекарню'],
  ['library', 'Библиотека', 'library', '📚', 'Av3,3', .5, 1, 160, 'Едем в библиотеку'],
  ['circus', 'Цирк', 'circus', '🎪', 'Ah7,1', .5, 1, 150, 'Едем в цирк'],
  ['toys', 'Лошадина', 'unicorn_shop', '🦄', 'Bh3,1', .5, -1, 190, 'Едем в Лошадину'],
  ['dino', 'Динозавры', 'dino_museum', '🦖', 'Bv5,3', .5, 1, 190, 'Едем к динозаврам'],
  ['vet', 'Ветклиника', 'vet', '🐾', 'subB', .5, 1, 130, 'Едем в ветклинику'],
  ['farm', 'Ферма', 'farm', '🐄', 'farmRd', .9, 1, 320, 'Едем на ферму'],
  ['camp', 'Лагерь', 'camp', '🏕️', 'campRd', .85, -1, 300, 'Едем в лагерь'],
  ['picnic', 'Пикник', 'picnic', '🧺', 'picnicRd', .9, -1, 160, 'Едем на пикник'],
  ['marriott', 'Марриотт', 'marriott', '🏨', 'blv@3800', .5, -1, 300, 'Едем в Марриотт'],
  ['europe', 'Площадь Европы', 'europe_square', '⛲', 'Ah4,2', .5, 1, 290, 'Едем на площадь Европы'],
  ['grandmall', 'Гранд Молл', 'grand_mall', '🛍️', 'blv@8650', .5, -1, 260, 'Едем в Гранд Молл'],
  ['metrocity', 'Метро Сити', 'metro_city', '🏬', 'blv@9350', .5, -1, 320, 'Едем в Метро Сити'],
  ['mcdonalds', 'Макдональдс', 'mcdonalds', '🍔', 'Av4,1', .5, 1, 150, 'Едем в Макдональдс'],
  ['resort', 'Курорт', 'lake_resort', '🏝️', 'lakeRd', .92, -1, 230, 'Едем на курорт'],
  ['castle', 'Замок', 'castle', '🏰', 'forest', .92, -1, 230, 'Едем в замок'],
  ['bus1', 'Остановка', 'bus_stop', '🚏', 'Av1,3', .5, 1, 110, 'Едем на остановку'],
  ['bus2', 'Остановка', 'bus_stop', '🚏', 'Bh1,1', .5, 1, 110, 'Едем на остановку'],
  ['bus3', 'Остановка', 'bus_stop', '🚏', 'Bh4,4', .5, 1, 110, 'Едем на остановку'],
  ['bus4', 'Остановка', 'bus_stop', '🚏', 'Ah3,5', .5, 1, 110, 'Едем на остановку'],
];
const POIS = [];
// hand-placed spots for big pictures that need the whole block: [x, y (base), width]
const POS_FIX = { europe: [4400, 3895, 270], train: [10905, 2445, 205], resort: [195, 3250, 240], grandmall: [8750, 4540, 270], metrocity: [9330, 4555, 340] };
function placePois() {
  for (const [key, name, sprite, emoji, eref0, t, side, w, phrase] of POI_DEFS) {
    const eref = eref0.startsWith('blv@') ? blvEdgeAt(+eref0.slice(4)) : eref0;
    const eid = GE[eref];
    if (eid == null || edges[eid].dead) { console.warn('bad poi edge', key, eref); continue; }
    if (!IMG[sprite] && !/^bus\d/.test(key)) continue;
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
const SPRITES = ['person_businessman', 'person_couple', 'person_dog', 'person_girl_balloon', 'person_grandma', 'person_grandpa', 'person_icecream', 'person_kid', 'person_mom_stroller', 'person_runner', 'person_scooter', 'person_tourist', 'parking_lot_small', 'parking_lot_medium', 'parking_lot_big', 'parking_small', 'parking_medium', 'parking_big', 'boat_sail', 'boat_ferry', 'boat_fishing', 'boat_yacht', 'train_engine', 'train_car', 'car', 'car_top', 'car_police', 'car_cat', 'car_blue', 'car_race', 'car_tesla', 'car_robot', 'robot_leg', 'santa', 'xmas_truck', 'charger', 'car_service', 'bus', 'bus_stop', 'pineapples', 'unicorn_shop', 'parking_tower', 'fir', 'snowman', 'xmas_tree', 'xmas_small', 'car_front', 'car_side', 'pin', 'airplane', 'house_1', 'house_2', 'house_3', 'house_4', 'tree_1', 'tree_2', 'tree_3', 'bush', 'pond',
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
// inside each picture: the aisle line (fraction of height from centre) and the free spots [x, y, faces up]
const LOT_SPOTS = {
  parking_lot_small: { aisle: 0.30, spots: [[0.104, -0.084, 1]] },
  parking_lot_medium: { aisle: 0.019, spots: [[0.234, -0.234, 1], [-0.010, 0.268, 0]] },
  parking_lot_big: { aisle: 0.001, spots: [[-0.039, -0.283, 1], [-0.205, 0.272, 0], [0.133, 0.272, 0]] },
};
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
      const lot = { x: c[0], y: c[1], ang, W, H, sp: pk.sp, road: RT[e.type].color, D };
      GROUND_LOTS.push(lot);
      // a destination: a graph node on the road right at the driveway
      const tt = d0 / e.len, node = tt * e.len < 20 ? e.a : (1 - tt) * e.len < 20 ? e.b : splitEdge(rd.eid, tt).n;
      POIS.push({ key: 'lot' + GROUND_LOTS.length, name: 'Парковка', sprite: 'parking_small', emoji: '🅿️', node, x: c[0], y: c[1], w: 0, lot, phrase: 'Едем на парковку' });
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
  return profile(dropBacksteps(smoothCorners(cutLoops(out))));
}
// the lane offset makes a tiny loop on tight inner corners (skewed crossings): cut every loop at its crossing point
function cutLoops(P) {
  const X = (a, b, c, d) => {
    const r1x = b.x - a.x, r1y = b.y - a.y, r2x = d.x - c.x, r2y = d.y - c.y, den = r1x * r2y - r1y * r2x;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((c.x - a.x) * r2y - (c.y - a.y) * r2x) / den, u = ((c.x - a.x) * r1y - (c.y - a.y) * r1x) / den;
    return t > 0 && t < 1 && u > 0 && u < 1 ? t : null;
  };
  const out = [];
  for (let i = 0; i < P.length; i++) {
    out.push(P[i]);
    if (i >= P.length - 2) continue;
    let cut = -1, ct = 0;
    for (let j = Math.min(P.length - 2, i + 60); j >= i + 2; j--) { const t = X(P[i], P[i + 1], P[j], P[j + 1]); if (t != null) { cut = j; ct = t; break; } }
    if (cut > 0) { out.push({ ...P[i + 1], x: lerp(P[i].x, P[i + 1].x, ct), y: lerp(P[i].y, P[i + 1].y, ct) }); i = cut; }
  }
  return out;
}
// tiny steps backwards make a round blob on the drawn line and spin the car: keep points at least 2.5 m apart, always going forward
function dropBacksteps(S) {
  const out = [S[0]];
  for (let i = 1; i < S.length; i++) {
    const q = S[i], a = out[out.length - 1], d = Math.hypot(q.x - a.x, q.y - a.y);
    if (d < 2.5 && i < S.length - 1) continue;
    if (out.length >= 2) { const b = out[out.length - 2]; if ((a.x - b.x) * (q.x - a.x) + (a.y - b.y) * (q.y - a.y) < 0 && i < S.length - 1) continue; }
    out.push(q);
  }
  return out;
}
// after a cut the corner has a sharp point: resample every 3 m and round it again
function smoothCorners(P) {
  const S = [P[0]];
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], l = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.round(l / 3));
    for (let k = 1; k <= n; k++) S.push({ ...b, x: lerp(a.x, b.x, k / n), y: lerp(a.y, b.y, k / n) });
  }
  const N = S.length;
  for (let pass = 0; pass < 3; pass++) {
    const xs = S.map(q => q.x), ys = S.map(q => q.y);
    for (let i = 1; i < N - 1; i++) { const r = Math.min(4, i, N - 1 - i); let sx = 0, sy = 0; for (let k = i - r; k <= i + r; k++) { sx += xs[k]; sy += ys[k]; } S[i].x = sx / (2 * r + 1); S[i].y = sy / (2 * r + 1); }
  }
  // hooks and cusps that are left: smooth harder, only where the line bends too sharply
  const ang = (i, w) => { const a = S[Math.max(0, i - w)], b = S[i], c = S[Math.min(N - 1, i + w)]; const h1 = Math.atan2(b.y - a.y, b.x - a.x), h2 = Math.atan2(c.y - b.y, c.x - b.x); return Math.abs(angDiff(h2, h1)); };
  for (let pass = 0; pass < 12; pass++) {
    const bad = new Uint8Array(N); let any = false;
    for (let i = 3; i < N - 3; i++) if (ang(i, 3) > 0.75) { any = true; for (let k = Math.max(1, i - 6); k <= Math.min(N - 2, i + 6); k++) bad[k] = 1; }
    if (!any) break;
    const xs = S.map(q => q.x), ys = S.map(q => q.y);
    for (let i = 1; i < N - 1; i++) { if (!bad[i]) continue; const r = Math.min(8, i, N - 1 - i); let sx = 0, sy = 0; for (let k = i - r; k <= i + r; k++) { sx += xs[k]; sy += ys[k]; } S[i].x = sx / (2 * r + 1); S[i].y = sy / (2 * r + 1); }
  }
  return S;
}
// arc length, heading, speed limits and time to the end for a list of path points
function profile(out) {
  const N = out.length;
  let s = 0;
  out.forEach((q, i) => { if (i) s += Math.hypot(q.x - out[i - 1].x, q.y - out[i - 1].y); q.s = s; });
  out.forEach((q, i) => { const a = out[Math.max(0, i - 2)], b = out[Math.min(N - 1, i + 2)]; q.h = Math.atan2(b.y - a.y, b.x - a.x) + (q.rev ? Math.PI : 0); });
  // speed limits from curvature, braking pass
  const ALAT = 55, DEC = 28;
  out.forEach((q, i) => {
    const a = out[Math.max(0, i - 4)], b = out[Math.min(N - 1, i + 4)];
    const ds = (b.s - a.s) || 1, k = Math.abs(angDiff(b.h, a.h)) / ds;
    q.cl = k > 1e-4 ? Math.sqrt(ALAT / k) : 999;
    q.lim = Math.min(q.vmax, q.cl);
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
try { muted = localStorage.getItem('muted') === '1'; } catch (e) { }
function pickVoice() { const vs = speechSynthesis.getVoices(); ruVoice = vs.find(v => /^ru/i.test(v.lang)) || null; }
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let voiceOn = true;
try { voiceOn = localStorage.getItem('voiceOn') !== '0'; } catch (e) { }
// recorded voice: one file per phrase, snd/v/<code>.mp3 (the list lives in the Map-car project, voice-phrases.md)
const VOICE_TEXT = {"a01": "Костя, поехали!", "a02": "Ура, Костя, мы приехали!", "b01": "Едем домой", "b02": "Едем в садик", "b03": "Едем в школу", "b04": "Едем в магазин", "b05": "Едем на заправку", "b06": "Едем к пожарным", "b07": "Едем в парк", "b08": "Едем в полицию", "b09": "Едем на мойку", "b10": "Едем в больницу", "b11": "Едем на вокзал", "b12": "Едем в кино", "b13": "Едем на почту", "b14": "Едем на стадион", "b15": "Едем за мороженым", "b16": "Едем в пиццерию", "b17": "Едем в аэропорт", "b18": "Едем на аттракционы", "b19": "Едем к бабушке", "b20": "Едем в зоопарк", "b21": "Едем к маяку", "b22": "Едем в Орби Сити", "b23": "Едем на пляж", "b24": "Едем на пристань", "b25": "Едем в аквапарк", "b26": "Едем в пекарню", "b27": "Едем в библиотеку", "b28": "Едем в цирк", "b29": "Едем за игрушками", "b30": "Едем к динозаврам", "b31": "Едем в ветклинику", "b32": "Едем на ферму", "b33": "Едем в лагерь", "b34": "Едем на пикник", "b35": "Едем в Марриотт", "b36": "Едем на площадь Европы", "b37": "Едем в Гранд Молл", "b38": "Едем в Метро Сити", "b39": "Едем в Макдональдс", "b40": "Едем на курорт", "b41": "Едем в замок", "b42": "Едем в гости", "c01": "Дом", "c02": "Садик", "c03": "Школа", "c04": "Магазин", "c05": "Заправка", "c06": "Пожарные", "c07": "Парк", "c08": "Полиция", "c09": "Мойка", "c10": "Больница", "c11": "Вокзал", "c12": "Кино", "c13": "Почта", "c14": "Стадион", "c15": "Мороженое", "c16": "Пицца", "c17": "Аэропорт", "c18": "Аттракционы", "c19": "Бабушка", "c20": "Зоопарк", "c21": "Маяк", "c22": "Орби Сити", "c23": "Пляж", "c24": "Пристань", "c25": "Аквапарк", "c26": "Пекарня", "c27": "Библиотека", "c28": "Цирк", "c29": "Игрушки", "c30": "Динозавры", "c31": "Ветклиника", "c32": "Ферма", "c33": "Лагерь", "c34": "Пикник", "c35": "Марриотт", "c36": "Площадь Европы", "c37": "Гранд Молл", "c38": "Метро Сити", "c39": "Макдональдс", "c40": "Курорт", "c41": "Замок", "c42": "Домик", "c43": "Многоэтажка", "c44": "Офис", "d01": "Скоро кольцо, первый съезд", "d02": "Скоро кольцо, второй съезд", "d03": "Скоро кольцо, третий съезд", "d04": "Скоро кольцо, четвертый съезд", "d05": "На кольце первый съезд", "d06": "На кольце второй съезд", "d07": "На кольце третий съезд", "d08": "На кольце четвертый съезд", "e01": "Едем прямо, долго-долго", "e02": "Скоро приедем!", "f01": "Костя, бензин заканчивается! Поехали на заправку!", "f02": "Заправляемся!", "f03": "Бак полный! Можно ехать!", "g01": "Поехали!", "g02": "Едем в новое место!", "g03": "Посмотрим, что там!", "g04": "Приехали!", "g05": "Вот мы и на месте!", "g06": "Какое интересное место!", "h01": "Внимание, полиция едет!", "h02": "Костя, батарея садится! Поехали на зарядку!", "h03": "Заряжаемся!", "h04": "Батарея заряжена!", "h05": "Едем на зарядку", "h06": "Едем на парковку", "h07": "Едем в автосервис", "h08": "Ой, Костя! Машинка сломалась! Поехали в автосервис!", "h09": "Чиним машинку!", "h10": "Машинка как новая! Можно ехать!", "h11": "Едем к ананасам", "h12": "Едем в Лошадину", "h13": "Едем на высокую парковку", "h14": "Высокая парковка", "k01": "Лошадина"};
const vkey = t => String(t).toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const VOICE_BY_TEXT = {};
for (const [c, t] of Object.entries(VOICE_TEXT)) VOICE_BY_TEXT[vkey(t)] = c;
const clip = t => VOICE_BY_TEXT[vkey(t)];
let vQueue = [], vNow = null, vEnd = 0;
async function playClips(codes, urgent) {
  const a = audio(); if (!a) return false;
  if (urgent) { vQueue = []; if (vNow) { try { vNow.stop(); } catch (e) { } vNow = null; } vEnd = 0; }
  const bufs = [];
  for (const c of codes) { const b = await sound('v_' + c, 'snd/v/' + c + '.mp3'); if (b) bufs.push(b); }
  if (!bufs.length) return false;
  let t = Math.max(a.currentTime + 0.05, vEnd);
  for (const b of bufs) {
    const src = a.createBufferSource(), g = a.createGain(); g.gain.value = 1.15; src.buffer = b; src.connect(g).connect(a.destination);
    src.start(t); vNow = src; t += b.duration + 0.12;
  }
  vEnd = t;
  return true;
}
// codes: recorded phrases to play; text: what the synthesiser says if there is no recording
function say(text, urgent, codes) {
  if (muted || !voiceOn) return;
  codes = (codes || [clip(text)]).filter(Boolean);
  if (codes.length) { playClips(codes, urgent); return; }
  if (!('speechSynthesis' in window)) return;
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
const CARS = [['car_top', 'Красная'], ['car_police', 'Полиция'], ['car_cat', 'Котик'], ['car_blue', 'Синяя'], ['car_race', 'Гоночная'], ['car_tesla', 'Тесла'], ['car_robot', 'Робот']];
const isEV = () => carSkin === 'car_tesla' || carSkin === 'car_robot';
let carSkin = 'car_top';
try { carSkin = localStorage.getItem('carSkin') || 'car_top'; } catch (e) { /* storage blocked */ }
let userZoom = 1;
let navZoom = 1, navFreeUntil = 0; // during a trip: pinch zoom factor, and the map is free (not following) until this time
const navBase = () => Math.min(W, H) / (330 + (trip ? trip.v : 0) * 2.6);
const car = { node: 0, x: 0, y: 0, h: -Math.PI / 2 };
let trip = null;   // {poi, route, path, man, s, v, mi, ...}
let wakeLock = null;
const confetti = [];
let plane = null, planeTimer = 20;

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
// ---------- winter ----------
let winterMode = 'auto'; // auto | on | off
try { winterMode = localStorage.getItem('winterMode') || 'auto'; } catch (e) { }
let winter = false;
// New Year: Santa and the truck caravan, on their own schedule (15 December - 15 January) or by hand
let newYearMode = 'auto'; // auto | on | off
try { newYearMode = localStorage.getItem('newYearMode') || 'auto'; } catch (e) { }
function newYearNow() {
  if (newYearMode !== 'auto') return newYearMode === 'on';
  const d = new Date(), m = d.getMonth(), day = d.getDate();
  return (m === 11 && day >= 15) || (m === 0 && day <= 15);
}
function winterNow() {
  if (winterMode !== 'auto') return winterMode === 'on';
  const d = new Date(), m = d.getMonth(), day = d.getDate();
  return m === 11 || (m === 0 && day <= 15); // 1 December - 15 January
}
const SNOWY = { '#9ED47F': '#EAF1F7', '#7FD08A': '#DCE7F0', '#86CC6A': '#E3ECF4', '#7BC96F': '#E6EEF5', '#E9D9A6': '#ECE8DE', '#E6C86A': '#E2EAF1', '#C9A86B': '#DDE5ED', '#D9C46A': '#E0E8EF' };
const wc = c => winter ? SNOWY[c] || c : c;
// snow caps: on each column of a sprite the top few pixels under the outline turn white
const SNOWCAP = {};
const NO_SNOW = /^(xmas_truck$|santa$|fir$|snowman$|xmas_tree$|xmas_small$|person_|boat_|train_|car_(top|police|cat|blue|race|tesla|front|side)$|car$|airplane|pin$|parking)/;
function snowSprite(name) {
  if (name in SNOWCAP) return SNOWCAP[name];
  const im = IMG[name]; if (!im || NO_SNOW.test(name)) return (SNOWCAP[name] = null);
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data, W0 = c.width, H0 = c.height;
  const dark = i => p[i] + p[i + 1] + p[i + 2] < 210;
  const base = /tree|bush|forest/.test(name) ? H0 * 0.17 : Math.max(8, Math.min(H0 * 0.09, 36));
  for (let x = 0; x < W0; x++) {
    let y = 0; while (y < H0 && p[4 * (y * W0 + x) + 3] < 110) y++;
    if (y >= H0) continue;
    const y1 = y + 12; while (y < y1 && y < H0 && dark(4 * (y * W0 + x))) y++;
    const cap = Math.round(base + 2 * Math.sin(x * 0.21) + 1.5 * Math.sin(x * 0.07 + 1));
    for (let k = 0; k < cap && y + k < H0; k++) {
      const i = 4 * ((y + k) * W0 + x);
      if (p[i + 3] < 110) break;
      if (dark(i)) continue; // inner outlines stay
      const edge = k >= cap - 2;
      p[i] = edge ? 200 : 246; p[i + 1] = edge ? 218 : 250; p[i + 2] = edge ? 236 : 254;
    }
  }
  g.putImageData(d, 0, 0);
  return (SNOWCAP[name] = c);
}
const baseSprite = name => (winter && snowSprite(name)) || IMG[name];
// snowdrifts along the curbs, worked out once
// winter only: every other tree turns into a snowy fir, a New Year tree by Europe Square, snowmen by the kids' places
const WINTER_DECOR = [];
function placeTower() {
  if (!IMG.parking_tower) return;
  const w = 210;
  for (const x0 of [6000, 5600, 6400, 5200, 6800, 4800, 7200]) {
    const hgt = w * IMG.parking_tower.height / IMG.parking_tower.width, y0 = hwY(x0), off = RT.highway.cw / 2 + hgt * 0.2 + 12, c = [x0, y0 - off];
    if (!spriteClear(c, w, 'parking_tower') || inWater(c)) continue;
    const f = footprint(c[0], c[1], w, 'parking_tower');
    if (POIS.some(p => p.w && overlaps(f, footprint(p.x, p.y, p.w, p.sprite)))) continue;
    for (let k = decor.length - 1; k >= 0; k--) { const d = decor[k]; if (overlaps(f, footprint(d.x, d.y, d.w, d.sprite))) decor.splice(k, 1); }
    // a destination: a node on the highway right in front of it
    const r = nearestRoad([x0, y0], 60); if (!r) continue;
    const tt = clamp(r.t, 0.05, 0.95);
    const node = splitEdge(r.eid, tt).n;
    POIS.push({ key: 'tower', name: 'Высокая парковка', sprite: 'parking_tower', emoji: '🅿️', node, x: c[0], y: c[1], w, phrase: 'Едем на высокую парковку' });
    return c;
  }
}
function buildWinterDecor() {
  decor.forEach((d, i) => { if (/^tree_/.test(d.sprite) && i % 2 === 0) d.fir = true; });
  const taken = [];
  // festive trees on the roundabout islands instead of fountains and flowers
  if (IMG.xmas_small) {
    for (const d of decor) if (d.sprite === 'fountain') d.noWinter = true;
    for (const rb of roundabouts) { const w = Math.min(90, Math.max(46, (rb.r - RT[rb.type].cw / 2) * 1.1)); WINTER_DECOR.push({ x: rb.cx, y: rb.cy + w * 0.35, w, sprite: 'xmas_small' }); }
  }
  // the New Year tree stands right on the fountain of Europe Square
  const eu = POIS.find(p => p.key === 'europe');
  if (eu && IMG.xmas_tree && IMG[eu.sprite]) {
    const w = 125, th = w * IMG.xmas_tree.height / IMG.xmas_tree.width, eh = eu.w * IMG[eu.sprite].height / IMG[eu.sprite].width;
    WINTER_DECOR.push({ x: eu.x, y: eu.y - 0.09 * eh - 0.18 * th + 12, w, sprite: 'xmas_tree', over: eu });
  }
  for (const [key, sp, w] of [['home', 'snowman', 55], ['kindergarten', 'snowman', 55], ['park', 'snowman', 55], ['school', 'snowman', 55], ['grandma', 'snowman', 55]]) {
    const o = POIS.find(p => p.key === key); if (!o || !IMG[sp]) continue;
    let ok = null;
    for (let r = o.w * 0.55 + w * 0.5; r < 420 && !ok; r += 20) for (let k = 0; k < 16 && !ok; k++) {
      const a = k / 16 * TAU + r * 0.01, q = [o.x + Math.cos(a) * r, o.y + Math.sin(a) * r * 0.8];
      if (!spriteClear(q, w, sp) || inWater(q)) continue;
      const f = footprint(q[0], q[1], w, sp);
      if (POIS.some(p => p.w && overlaps(f, footprint(p.x, p.y, p.w, p.sprite))) || taken.some(t => overlaps(f, t))) continue;
      if (decor.some(d => !/^(tree_|bush)/.test(d.sprite) && overlaps(f, footprint(d.x, d.y, d.w, d.sprite)))) continue;
      ok = q;
    }
    if (!ok) continue;
    const f = footprint(ok[0], ok[1], w, sp); taken.push(f);
    // trees under it step aside in winter
    decor.forEach(d => { if (/^(tree_|bush)/.test(d.sprite) && overlaps(f, footprint(d.x, d.y, d.w, d.sprite))) d.noWinter = true; });
    WINTER_DECOR.push({ x: ok[0], y: ok[1], w, sprite: sp });
  }
}
let DRIFTS = null;
function buildDrifts() {
  DRIFTS = [];
  let seed = 7; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const e of edges) {
    if (e.dead || e.type === 'ring' || e.type === 'ringBig') continue;
    const off = RT[e.type].cw / 2 + 5, pts = [];
    let bb = [1e9, 1e9, -1e9, -1e9];
    for (let d = 30; d < e.len - 30; d += 16) {
      const a = pointAlong(e.pts, d), b = pointAlong(e.pts, Math.min(e.len, d + 4)), l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      for (const sd of [1, -1]) {
        const q = [a[0] + n[0] * off * sd, a[1] + n[1] * off * sd];
        if (inWater(q)) continue;
        const r = 6 + R() * 7; pts.push([q[0], q[1], r]);
        bb = [Math.min(bb[0], q[0]), Math.min(bb[1], q[1]), Math.max(bb[2], q[0]), Math.max(bb[3], q[1])];
      }
    }
    if (pts.length) DRIFTS.push({ bb, pts });
  }
}
function drawDrifts(view) {
  if (!winter || cam.scale < 0.18) return;
  if (!DRIFTS) buildDrifts();
  const vis = DRIFTS.filter(D => !(D.bb[2] < view[0] - 20 || D.bb[0] > view[2] + 20 || D.bb[3] < view[1] - 20 || D.bb[1] > view[3] + 20));
  // a soft blue shadow under each drift, then the white snow
  for (const [col, dy, dr] of [['#C6D6E6', 3, 1.5], ['#FFFFFF', 0, 0]]) {
    ctx.fillStyle = col; ctx.beginPath();
    for (const D of vis) for (const [x, y, r] of D.pts) { ctx.moveTo(x + r + dr, y + dy); ctx.arc(x, y + dy, r + dr, 0, TAU); }
    ctx.fill();
  }
}
// ---------- weather: rain, or snow in winter ----------
let weatherMode = 'auto'; // auto | clear | wet
try { weatherMode = localStorage.getItem('weatherMode') || 'auto'; } catch (e) { }
let wetK = 0, wetAuto = false, wetTimer = 240 + Math.random() * 300;
const DROPS = [];
function drawWeather(dt) {
  if (weatherMode === 'auto') {
    wetTimer -= dt;
    if (wetTimer <= 0) { wetAuto = !wetAuto; wetTimer = wetAuto ? 300 + Math.random() * 120 : 600 + Math.random() * 600; }
  }
  const want = weatherMode === 'wet' || (weatherMode === 'auto' && wetAuto) ? 1 : 0;
  wetK += (want - wetK) * Math.min(1, dt * 0.6);
  if (wetK < 0.01) return;
  const snow = winter, N = Math.round((snow ? 150 : 170) * wetK);
  while (DROPS.length < 170) DROPS.push({ x: Math.random(), y: Math.random(), z: Math.random() });
  if (!snow) { ctx.fillStyle = `rgba(70,80,96,${0.22 * wetK})`; ctx.fillRect(0, 0, W, H); }
  const t = performance.now() / 1000;
  ctx.save();
  if (snow) ctx.fillStyle = 'rgba(255,255,255,.92)';
  else { ctx.strokeStyle = 'rgba(215,228,245,.6)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round'; ctx.beginPath(); }
  for (let i = 0; i < N; i++) {
    const q = DROPS[i];
    if (snow) {
      q.y += dt * (0.05 + q.z * 0.07); q.x += dt * 0.012 * Math.sin(t * 0.8 + i);
      if (q.y > 1.02) { q.y = -0.02; q.x = Math.random(); }
      ctx.beginPath(); ctx.arc(((q.x % 1) + 1) % 1 * W, q.y * H, 1.4 + q.z * 2.4, 0, TAU); ctx.fill();
    } else {
      q.y += dt * (1.1 + q.z * 0.8); q.x -= dt * 0.12;
      if (q.y > 1.05) { q.y = -0.05; q.x = Math.random() * 1.2; }
      const x = q.x * W, y = q.y * H, L = 12 + q.z * 12;
      ctx.moveTo(x, y); ctx.lineTo(x - L * 0.25, y + L);
    }
  }
  if (!snow) ctx.stroke();
  ctx.restore();
}
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
  ctx.strokeStyle = wc('#7FD08A'); ctx.lineWidth = RIVER_W + 30; strokePts(RIVER);
  ctx.fillStyle = wc('#E9D9A6'); coast(-70);
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
  ctx.fillStyle = wc('#E9D9A6'); ctx.strokeStyle = wc('#E9D9A6'); ctx.lineWidth = 36;
  LAKES.forEach((L, k) => { lakePath(L, k); ctx.fill(); ctx.stroke(); });
  ctx.fillStyle = '#5BB8F5';
  LAKES.forEach((L, k) => { lakePath(L, k); ctx.fill(); });
  // park
  const pk = ZONES.park;
  ctx.fillStyle = wc('#86CC6A'); roundRect(pk[0], pk[1], pk[2] - pk[0], pk[3] - pk[1], 30); ctx.fill();
  ctx.strokeStyle = '#E8DDB5'; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(pk[0] + 20, pk[3] - 40); ctx.quadraticCurveTo((pk[0] + pk[2]) / 2, (pk[1] + pk[3]) / 2, pk[2] - 30, pk[1] + 40); ctx.stroke();
  // airport
  const ap = ZONES.airport;
  ctx.fillStyle = '#C9CDD3'; roundRect(ap[0], ap[1], ap[2] - ap[0], ap[3] - ap[1], 40); ctx.fill();
  const ry = ap[1] + 50; ctx.fillStyle = '#5E6470'; ctx.fillRect(ap[0] + 60, ry, ap[2] - ap[0] - 120, 110);
  ctx.fillStyle = '#fff';
  for (let x = ap[0] + 100; x < ap[2] - 120; x += 90) ctx.fillRect(x, ry + 50, 50, 10);
  for (let k = 0; k < 6; k++) { ctx.fillRect(ap[0] + 70, ry + 12 + k * 15, 26, 8); ctx.fillRect(ap[2] - 96, ry + 12 + k * 15, 26, 8); }
  // fields near grandma
  for (const [x0, y0, x1, y1, c] of FIELDS) {
    ctx.fillStyle = wc(c); roundRect(x0, y0, x1 - x0, y1 - y0, 20); ctx.fill();
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
    ctx.fillStyle = wc('#7BC96F'); ctx.beginPath(); ctx.arc(rb.cx, rb.cy, rb.r - half - 1, 0, TAU); ctx.fill();
    const fl = ['#FFD23F', '#F2545B', '#9B7BE0', '#FFFFFF'];
    if (!winter) for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; ctx.fillStyle = fl[k % 4]; ctx.beginPath(); ctx.arc(rb.cx + Math.cos(a) * 22, rb.cy + Math.sin(a) * 22, 6, 0, TAU); ctx.fill(); }
    if (!winter) { ctx.fillStyle = '#FFD23F'; ctx.beginPath(); ctx.arc(rb.cx, rb.cy, 9, 0, TAU); ctx.fill(); }
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
      ctx.strokeStyle = wc('#7BC96F'); ctx.lineWidth = 16; strokePts(pts);
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
// ---------- day and night ----------
// darkness 0..1 from the real clock: dusk 18:30-20:30, dawn 5:30-7:30. Settings can force day or night.
let dayMode = 'auto';
try { dayMode = localStorage.getItem('dayMode') || 'auto'; } catch (e) { }
let night = 0;
function nightTarget() {
  if (dayMode === 'day') return 0;
  if (dayMode === 'night') return 1;
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60;
  if (h >= 20.5 || h < 5.5) return 1;
  if (h >= 18.5) return (h - 18.5) / 2;
  if (h < 7.5) return 1 - (h - 5.5) / 2;
  return 0;
}
// a night version of every sprite: walls darker, windows (light blue / glass) glowing warm yellow
const NIGHT = {};
function nightSprite(name) {
  const key = winter ? name + '|w' : name;
  if (key in NIGHT) return NIGHT[key];
  const im = baseSprite(name); if (!im) return (NIGHT[key] = null);
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  const lit = BUILDINGS.has(name) || POIS.some(q => q.sprite === name);
  // windows are small separate blue patches; a roof or a big glass wall is one large patch and stays dark
  const W0 = c.width, H0 = c.height, N = W0 * H0, blue = new Uint8Array(N);
  if (lit) for (let k = 0; k < N; k++) { const r = p[4 * k], gg = p[4 * k + 1], b = p[4 * k + 2]; if (p[4 * k + 3] > 100 && b > 180 && r < 135 && gg > 130 && gg < b) blue[k] = 1; }
  const label = new Int32Array(N), sizes = [0], stack = [];
  for (let k = 0; k < N; k++) {
    if (!blue[k] || label[k]) continue;
    const id = sizes.length; let n = 0; stack.push(k); label[k] = id;
    while (stack.length) {
      const q = stack.pop(); n++;
      const x = q % W0, y = (q / W0) | 0;
      if (x > 0 && blue[q - 1] && !label[q - 1]) { label[q - 1] = id; stack.push(q - 1); }
      if (x < W0 - 1 && blue[q + 1] && !label[q + 1]) { label[q + 1] = id; stack.push(q + 1); }
      if (y > 0 && blue[q - W0] && !label[q - W0]) { label[q - W0] = id; stack.push(q - W0); }
      if (y < H0 - 1 && blue[q + W0] && !label[q + W0]) { label[q + W0] = id; stack.push(q + W0); }
    }
    sizes.push(n);
  }
  const maxWin = N * 0.012;
  for (let k = 0; k < N; k++) {
    const i = 4 * k; if (!p[i + 3]) continue;
    if (label[k] && sizes[label[k]] < maxWin) { p[i] = 255; p[i + 1] = 214; p[i + 2] = 110; }
    else if ((name === 'xmas_tree' || name === 'xmas_small') && Math.max(p[i], p[i + 1], p[i + 2]) > 190 && Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]) > 70) { /* garland bulbs and the star keep shining */ }
    else { p[i] = p[i] * 0.42 + 8; p[i + 1] = p[i + 1] * 0.45 + 10; p[i + 2] = p[i + 2] * 0.6 + 26; }
  }
  g.putImageData(d, 0, 0);
  return (NIGHT[key] = c);
}
function drawNightOverlay() {
  if (night < 0.01) return;
  ctx.fillStyle = `rgba(14, 22, 58, ${0.55 * night})`;
  ctx.fillRect(0, 0, W, H);
}
// warm street lights at crossings, drawn on top of the dark overlay
function drawStreetLights() {
  if (night < 0.05) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const r = 70 * cam.scale;
  for (const n of LAMPS) {
    const [sx, sy] = w2s(n.x, n.y); if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    gr.addColorStop(0, `rgba(255, 200, 110, ${0.35 * night})`); gr.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = gr; ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
  }
  ctx.restore();
}
let LAMPS = [];
function buildLamps() { LAMPS = nodes.filter(n => n.edges.filter(i => !edges[i].dead).length >= 3).map(n => ({ x: n.x, y: n.y })); }
let wasDark = null;
function autoLights() {
  const dark = night > 0.5;
  if (dark !== wasDark) { wasDark = dark; lightsOn = dark; const b = $('btnLights'); if (b) b.classList.toggle('on', lightsOn); }
}
function drawHeadlights() {
  autoLights();
  const lv = lightsOn ? Math.max(0.75, night) : 0;
  if (lv < 0.05) return;
  const [sx, sy] = w2s(car.x, car.y), h = car.h + cam.rot, L = Math.max(60, 170 * cam.scale);
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(h); ctx.globalCompositeOperation = 'lighter';
  const gr = ctx.createRadialGradient(L * 0.15, 0, 0, L * 0.15, 0, L);
  gr.addColorStop(0, `rgba(255, 245, 200, ${0.55 * lv})`); gr.addColorStop(1, 'rgba(255, 245, 200, 0)');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(L * 0.12, -L * 0.08); ctx.lineTo(L, -L * 0.42); ctx.lineTo(L, L * 0.42); ctx.lineTo(L * 0.12, L * 0.08); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// ---------- pedestrians ----------
// people walk around blocks on the sidewalk and always turn at corners to stay on their block,
// so they never step onto the road. Kids are smaller than adults.
const PEOPLE_KINDS = [
  ['person_businessman', 1, 14], ['person_couple', 1, 11], ['person_dog', 0.95, 13], ['person_girl_balloon', 0.78, 11],
  ['person_grandma', 0.95, 9], ['person_grandpa', 1, 8], ['person_icecream', 0.72, 12], ['person_kid', 0.72, 13],
  ['person_mom_stroller', 1, 11], ['person_runner', 1, 30], ['person_scooter', 0.8, 26], ['person_tourist', 1, 12],
]; // sprite, height factor, speed (m/s on the map)
const PERSON_H = 46;
const people = [];
let walkEdges = [];
function isWalkEdge(e) {
  if (e.dead || e.ring || e.overpass || (e.type !== 'street' && e.type !== 'avenue') || e.len < 120) return false;
  const m = pointAlong(e.pts, e.len / 2);
  return m[1] > hwY(m[0]) + 160 && m[0] > 200 && m[0] < 11600;
}
function walkFrame(p) {
  const e = edges[p.e], off = RT[e.type].cw / 2 + 10, len = e.len;
  const d = p.dir > 0 ? p.s : len - p.s;
  const a = pointAlong(e.pts, clamp(d - 4, 0, len)), b = pointAlong(e.pts, clamp(d + 4, 0, len)), c = pointAlong(e.pts, d);
  let ux = b[0] - a[0], uy = b[1] - a[1]; const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
  if (p.dir < 0) { ux = -ux; uy = -uy; }
  // right-hand normal of the walking direction (y points down); side +1 = walk with the block on the right
  const nx = -uy * p.side, ny = ux * p.side;
  return { x: c[0] + nx * off, y: c[1] + ny * off, ux, uy };
}
function nextWalkEdge(p) {
  const e = edges[p.e], node = p.dir > 0 ? e.b : e.a;
  const pts = p.dir > 0 ? e.pts : e.pts.slice().reverse(), hin = headAt(pts, false);
  let best = null, bestA = 0;
  for (const id of nodes[node].edges) {
    if (id === e.id) continue;
    const e2 = edges[id]; if (!isWalkEdge(e2)) continue;
    const d2 = e2.a === node ? 1 : -1;
    const ang = angDiff(headAt(d2 > 0 ? e2.pts : e2.pts.slice().reverse(), true), hin); // > 0 = turn right
    const score = ang * p.side; // stay on the block: walking with it on the right means turning right
    if (Math.abs(ang) > 2.6) continue;
    if (!best || score > bestA) { best = [id, d2]; bestA = score; }
  }
  return best;
}
function buildPeople() {
  walkEdges = edges.filter(isWalkEdge);
  if (!walkEdges.length) return;
  // spread evenly: a few people on every street, more downtown
  const wt = e => e.len * (inDowntown(pointAlong(e.pts, e.len / 2)) ? 1.6 : 1);
  const total = walkEdges.reduce((s, e) => s + wt(e), 0), R = rng(11);
  const COUNT = Math.round(total / 650);
  for (let i = 0; i < COUNT; i++) {
    let r = R() * total, e = walkEdges[0];
    for (const w of walkEdges) { if (r < wt(w)) { e = w; break; } r -= wt(w); }
    const k = PEOPLE_KINDS[i % PEOPLE_KINDS.length];
    const off = RT[e.type].cw / 2 + 10;
    people.push({ e: e.id, dir: R() < .5 ? 1 : -1, side: R() < .5 ? 1 : -1, s: off + R() * (e.len - 2 * off), sp: k[0], hf: k[1], v: k[2] * (0.85 + R() * 0.3), ph: R() * 10, night: i % 3 !== 0 });
  }
}
function movePeople(dt) {
  for (const p of people) {
    const e = edges[p.e], off = RT[e.type].cw / 2 + 10;
    p.s += p.v * dt; p.ph += dt;
    if (p.s < e.len - off) continue;
    const nx = nextWalkEdge(p);
    if (nx) { const e2 = edges[nx[0]]; p.e = nx[0]; p.dir = nx[1]; p.s = RT[e2.type].cw / 2 + 10; }
    else { p.dir = -p.dir; p.side = -p.side; p.s = off; } // dead end: turn around on the same sidewalk
  }
}
function personItems(items) {
  if (cam.scale < 0.16) return;
  const M = 80;
  for (const p of people) {
    if (night > 0.5 && p.night) continue; // fewer people at night
    const f = walkFrame(p);
    const [sx, sy] = w2s(f.x, f.y);
    if (sx < -M || sx > W + M || sy < -M || sy > H + M) continue;
    items.push({ sy, sx, person: p, left: f.ux < -0.05 });
  }
}
function drawPerson(it) {
  const p = it.person, im = IMG[p.sp]; if (!im) return;
  const h = PERSON_H * p.hf * cam.scale, w = h * im.width / im.height;
  const bob = Math.abs(Math.sin(p.ph * (p.v > 20 ? 11 : 7))) * h * 0.05;
  ctx.save(); ctx.translate(it.sx, it.sy - bob);
  ctx.rotate(Math.sin(p.ph * (p.v > 20 ? 11 : 7)) * 0.04);
  if (it.left) ctx.scale(-1, 1);
  ctx.drawImage(im, -w / 2, -h, w, h);
  if (night > 0.01) { const n = nightSprite(p.sp); if (n) { ctx.globalAlpha = night; ctx.drawImage(n, -w / 2, -h, w, h); } }
  ctx.restore();
}

// ---------- dashboard ----------
let lightsOn = false; // headlights by hand; at night they are on by themselves
function drawGauge(v) {
  const c = $('gauge'), g = c.getContext('2d'), W2 = c.width, H2 = c.height, cx = W2 / 2, cy = H2 - 14, R = 82;
  g.clearRect(0, 0, W2, H2);
  const a0 = Math.PI, a1 = 2 * Math.PI, vmax = 120, ang = x => a0 + (a1 - a0) * Math.min(1, x / vmax);
  g.lineCap = 'round';
  g.strokeStyle = '#3F4759'; g.lineWidth = 12; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
  const gr = g.createLinearGradient(cx - R, 0, cx + R, 0); gr.addColorStop(0, '#6BE38A'); gr.addColorStop(.6, '#FFD23F'); gr.addColorStop(1, '#F2545B');
  g.strokeStyle = gr; g.beginPath(); g.arc(cx, cy, R, a0, ang(v)); g.stroke();
  g.fillStyle = '#C7CCD6'; g.font = '700 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let x = 0; x <= vmax; x += 20) { const a = ang(x); g.fillText(x, cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22)); }
  const a = ang(v); g.strokeStyle = '#F2545B'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, 7, 0, TAU); g.fill();
  g.font = '800 26px system-ui'; g.fillText(Math.round(v), cx, cy - 30);
}
function drawFuelGauge(f) {
  const c = $('fgauge'), g = c.getContext('2d'), W2 = c.width, cx = W2 / 2, cy = 74, R = 46;
  g.clearRect(0, 0, W2, c.height);
  const a0 = Math.PI * 1.15, a1 = Math.PI * 1.85, a = a0 + (a1 - a0) * f;
  g.lineCap = 'round'; g.lineWidth = 9;
  g.strokeStyle = '#3F4759'; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
  g.strokeStyle = f < 0.25 ? '#F2545B' : f < 0.5 ? '#FFB020' : '#6BE38A'; g.beginPath(); g.arc(cx, cy, R, a0, a); g.stroke();
  g.fillStyle = '#C7CCD6'; g.font = '800 15px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (isEV()) {
    // battery: percent with a lightning bolt instead of the needle
    g.fillStyle = f < 0.25 && Math.floor(performance.now() / 700) % 2 === 0 ? '#FFC21A' : '#fff';
    g.font = '800 20px system-ui'; g.fillText(Math.round(f * 100) + '%', cx, cy - 8);
    g.font = '22px system-ui'; g.fillText('⚡', cx, cy + 20);
    return;
  }
  g.fillText('E', cx + Math.cos(a0) * (R + 2) - 6, cy + Math.sin(a0) * (R + 2) + 12); g.fillText('F', cx + Math.cos(a1) * (R + 2) + 6, cy + Math.sin(a1) * (R + 2) + 12);
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8)); g.stroke();
  if (f < 0.25) {
    const on = Math.floor(performance.now() / 700) % 2 === 0;
    g.save(); g.translate(cx - 12, cy + 8); g.scale(1, 1);
    g.fillStyle = on ? '#FFC21A' : '#6B5A1E'; if (on) { g.shadowColor = '#FFC21A'; g.shadowBlur = 12; }
    g.fill(new Path2D('M5 3h8a1 1 0 0 1 1 1v8h1.5a2 2 0 0 1 2 2v3a1 1 0 0 0 2 0V9l-2.3-2.3 1.4-1.4L21.4 8A2 2 0 0 1 22 9.4V17a3 3 0 0 1-6 0v-3h-2v7H4V4a1 1 0 0 1 1-1zm1 2v5h6V5z'));
    g.restore();
  } else { g.font = '24px system-ui'; g.fillText('⛽', cx, cy + 22); }
}
function drawSprite(name, sx, sy, wpx, emoji) {
  const im = IMG[name];
  if (im) {
    const h = wpx * im.height / im.width;
    ctx.drawImage(baseSprite(name), sx - wpx / 2, sy - h * 0.82, wpx, h);
    if (night > 0.01) { const n = nightSprite(name); if (n) { ctx.globalAlpha = night; ctx.drawImage(n, sx - wpx / 2, sy - h * 0.82, wpx, h); ctx.globalAlpha = 1; } }
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
    if (winter && d.noWinter) continue;
    const [sx, sy] = w2s(d.x, d.y);
    if (sx < -M || sx > W + M || sy < -M || sy > H + M) continue;
    const wpx = d.w * cam.scale; if (wpx < 4) continue;
    items.push({ sy, sx, wpx, name: winter && d.fir && IMG.fir ? 'fir' : d.sprite, dec: d });
  }
  if (winter) for (const d of WINTER_DECOR) {
    const [sx, sy] = w2s(d.x, d.y);
    if (sx < -M || sx > W + M || sy < -M || sy > H + M) continue;
    items.push({ sy: d.over ? w2s(d.over.x, d.over.y)[1] + 0.5 : sy, drawSy: sy, sx, wpx: d.w * cam.scale, name: d.sprite });
  }
  for (const p of POIS) {
    const [sx, sy] = w2s(p.x, p.y);
    if (p.lot) { const r = p.lot.W * 0.45 * cam.scale; p.rect = sx > -M && sx < W + M && sy > -M && sy < H + M ? [sx - r, sy - r, 2 * r, 2 * r] : null; continue; }
    if (sx < -M || sx > W + M || sy < -M || sy > H + M) continue;
    items.push({ sy, sx, wpx: p.w * cam.scale, name: p.sprite, poi: p });
  }
  if (cam.scale > 0.22) for (const g of SIGNS) { const [sx, sy] = w2s(g.x, g.y); if (sx > -60 && sx < W + 60 && sy > -60 && sy < H + 120) items.push({ sy, sx, sign: g }); }
  personItems(items);
  items.sort((a, b) => a.sy - b.sy);
  for (const it of items) {
    if (it.person) { drawPerson(it); continue; }
    if (it.sign) { drawSign(it.sign, it.sx, it.sy, cam.scale, performance.now() / 1000); continue; }
    const r = drawSprite(it.name, it.sx, it.drawSy ?? it.sy, it.wpx, it.emoji);
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
    if (/^bus\d/.test(p.key) && !isTarget) continue;
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
    const hh = Math.max(18, 36 * cam.scale) * 384 / 257, wpx = hh * top.width / top.height; // same length for every car
    if (broken && !repairAnim) drawSmoke(t, sx, sy, h, hh);
    const blinkOn = Math.floor(performance.now() / 350) % 2 === 0, hazOn = hazard && blinkOn, turnOn = !hazard && turnSig && blinkOn;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(h + Math.PI / 2);
    if (carSkin === 'car_robot' && IMG.robot_leg) { drawRobot(top, hh); robotLamps(hh); ctx.restore(); return; }
    if (mode === 'nav' && performance.now() < boostUntil) drawBoost(t, wpx, hh);
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(3, 4, wpx * 0.5, hh * 0.48, 0, 0, TAU); ctx.fill();
    ctx.drawImage(top, -wpx / 2, -hh / 2, wpx, hh);
    if (carSkin === 'car_police' && sirenOn) {
      // flashing roof lights while the siren is on
      const on = Math.floor(t * 5) % 2;
      for (const [x, col, lit] of [[-0.24, '#1E6BFF', on], [0.24, '#FF2D2D', 1 - on]]) {
        if (!lit) continue;
        const R = wpx * 1.1;
        const g = ctx.createRadialGradient(x * wpx, -0.23 * hh, 0, x * wpx, -0.23 * hh, R);
        g.addColorStop(0, col); g.addColorStop(0.35, col); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = 0.8; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x * wpx, -0.23 * hh, R, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    const lamps = hazOn ? [[-0.42, -0.44], [0.42, -0.44], [-0.42, 0.46], [0.42, 0.46]] : turnOn ? [[0.42 * turnSig, -0.44], [0.42 * turnSig, 0.46]] : [];
    for (const [fx, fy] of lamps) {
      const x = fx * wpx, y = fy * hh, R = Math.max(wpx * 0.6, 12);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, '#FFF3C4'); g.addColorStop(0.25, '#FFA41B'); g.addColorStop(1, 'rgba(255,140,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (refuelAnim && isEV()) drawSparks(t, sx, sy, Math.max(wpx, hh));
    if (repairAnim) drawSparks(t, sx, sy, Math.max(wpx, hh), '🔧');
    if (performance.now() < meowUntil) drawBubble(sx, sy - Math.max(wpx, hh) * 0.75, 'Мяу!');
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
// the robot walks: two legs step in turn with the distance driven, the body bobs and sways on each step
let robotDist = 0, robotLast = null, robotGlowUntil = 0;
function drawRobot(body, hh) {
  const s = mode === 'nav' && trip ? trip.s : null;
  if (s != null && robotLast != null && s > robotLast) robotDist += s - robotLast;
  robotLast = s;
  const L = hh * 0.95, bw = hh * 1.2, bh = bw * body.height / body.width;
  const stride = 14, ph = robotDist / stride * Math.PI; // one step every 14 m
  const leg = IMG.robot_leg, lw = L * leg.width / leg.height;
  // legs first (under the body); the leg that swings forward is lifted, drawn a bit bigger
  for (const side of [-1, 1]) {
    const k = Math.sin(ph + (side > 0 ? Math.PI : 0));
    const lift = Math.max(0, Math.cos(ph + (side > 0 ? Math.PI : 0))) * (Math.abs(k) < 1 ? 1 : 0);
    const sc = 1 + 0.12 * Math.max(0, Math.cos(ph + (side > 0 ? Math.PI : 0)));
    // the foot swings from behind the body to in front of it; the leg top stays under the body
    ctx.save(); ctx.translate(side * bw * 0.3, -k * L * 0.42); ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(3, -L * 0.3, lw * 0.42, lw * 0.36, 0, 0, TAU); ctx.fill();
    ctx.drawImage(leg, -lw / 2, -L * 0.55, lw, L);
    ctx.restore();
  }
  const bob = Math.abs(Math.sin(ph)), sway = Math.sin(ph) * 0.06;
  ctx.rotate(sway);
  const sc = 1 + 0.04 * bob;
  ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.beginPath(); ctx.ellipse(4, 6, bw * 0.5, bh * 0.48, 0, 0, TAU); ctx.fill();
  ctx.drawImage(body, -bw * sc / 2, -bh * sc / 2 - 2 * bob, bw * sc, bh * sc);
  // the guard line: a blue shield ring pulses around the robot and the eyes shine
  if (performance.now() < robotGlowUntil) {
    const q = (performance.now() / 1000) % 0.8 / 0.8;
    ctx.strokeStyle = `rgba(80,200,255,${0.9 * (1 - q)})`; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, bw * (0.6 + q * 0.5), 0, TAU); ctx.stroke();
    for (const ex of [-0.17, 0.17]) {
      const x = ex * bw * sc, y = -0.33 * bh * sc - 2 * bob, g = ctx.createRadialGradient(x, y, 0, x, y, bw * 0.22);
      g.addColorStop(0, 'rgba(220,255,255,.95)'); g.addColorStop(1, 'rgba(80,220,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, bw * 0.22, 0, TAU); ctx.fill();
    }
  }
}
// hazard and turn lamps for the robot: orange lights on the four corners of its round body, same beat as the car
function robotLamps(hh) {
  const blinkOn = Math.floor(performance.now() / 350) % 2 === 0;
  if (!blinkOn || (!hazard && !turnSig)) return;
  const bw = hh * 1.2, bh = bw * IMG.car_robot.height / IMG.car_robot.width;
  const corners = [[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]];
  const on = hazard ? corners : corners.filter(([x]) => Math.sign(x) === turnSig);
  for (const [fx, fy] of on) {
    const x = fx * bw, y = fy * bh, R = Math.max(bw * 0.32, 12);
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, '#FFF3C4'); g.addColorStop(0.25, '#FFA41B'); g.addColorStop(1, 'rgba(255,140,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
  }
}
function drawBoost(t, wpx, hh) {
  // under the car: fire for the race car, a blue glow for the Tesla
  const ev = isEV(), y0 = hh * 0.48;
  if (ev) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hh * 0.85);
    g.addColorStop(0, 'rgba(80,190,255,.55)'); g.addColorStop(1, 'rgba(80,190,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, wpx * 1.1, hh * 0.85, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#BFF0FF'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) {
      const k = (t * 3 + i / 5) % 1, x = (((i * 37) % 10) / 10 - 0.5) * wpx * 0.9, y = y0 + k * hh * 0.7;
      ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + wpx * 0.08, y + hh * 0.06); ctx.lineTo(x - wpx * 0.04, y + hh * 0.1); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else {
    for (const x of [-0.16, 0.16]) {
      const L = hh * (0.75 + 0.2 * Math.sin(t * 40 + x * 50)), w = wpx * 0.2;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + L);
      g.addColorStop(0, '#FFF6A0'); g.addColorStop(0.35, '#FFB020'); g.addColorStop(1, 'rgba(255,60,20,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x * wpx - w, y0); ctx.quadraticCurveTo(x * wpx, y0 + L * 1.2, x * wpx + w, y0); ctx.fill();
    }
  }
}
function drawSparks(t, x, y, r, sym = '⚡') {
  // a small lightning bolt runs around the car while it charges
  ctx.save(); ctx.translate(x, y);
  for (let i = 0; i < 2; i++) {
    const a = t * 4 + i * Math.PI;
    ctx.save(); ctx.translate(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75);
    ctx.font = `${Math.round(r * 0.5)}px system-ui`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(sym, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
function drawBubble(x, y, text) {
  ctx.save();
  ctx.font = '800 20px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 24, h = 34, bx = x - w / 2, by = y - h - 10;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1D2A44'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(bx, by, w, h, 14); ctx.moveTo(x - 7, by + h); ctx.lineTo(x, by + h + 10); ctx.lineTo(x + 7, by + h);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 6, by + h - 3, 12, 4);
  ctx.fillStyle = '#1D2A44'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, by + h / 2 + 1);
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
// the plane takes off from the airport, circles over the city and flies away;
// other times it comes in over the city and lands. A soft hum plays while it is on screen.
function runway() { const ap = ZONES.airport, y = ap[1] + 50 + 55; return { x0: ap[0] + 120, x1: ap[2] - 120, y }; }
let FLIGHTS = null;
function buildFlights() {
  const rw = runway(), mk = pts => { const P = catmull(pts, 40), C = [0]; for (let i = 1; i < P.length; i++) C.push(C[i - 1] + dist(P[i - 1], P[i])); return { P, C, L: C[C.length - 1] }; };
  const ground = mk([[rw.x0, rw.y], [rw.x1, rw.y]]);
  // one round trip: take off to the east, fly a big circle around the whole city, come back and land from the west
  const cx = 6000, cy = 2900, rx = 5300, ry = 2300, loop = [[rw.x1, rw.y], [rw.x1 + 900, rw.y + 120]];
  for (let k = 0; k <= 40; k++) { const a = -0.95 + k / 40 * (TAU - 0.7); loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  loop.push([rw.x0 - 1500, rw.y + 60], [rw.x0, rw.y]);
  const air = mk(loop);
  FLIGHTS = { rw, ground, air };
}
function pathAt(path, s) {
  const { P, C } = path; s = clamp(s, 0, path.L);
  let lo = 0, hi = C.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] < s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = (s - C[lo]) / ((C[hi] - C[lo]) || 1);
  return { x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t), h: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
const AIR_V = 330;
function drawPlane(dt) {
  if (!IMG.airplane) return;
  if (!FLIGHTS) buildFlights();
  const F = FLIGHTS, run = F.ground.L;
  if (!plane) {
    planeTimer -= dt; if (planeTimer > 0) return;
    plane = { phase: 'roll', t: 0, s: 0, v: 0 };
  }
  plane.t += dt;
  let q, alt = 0;
  if (plane.phase === 'roll') { // accelerate along the runway, lift off at the end
    plane.v = Math.min(AIR_V, plane.v + 26 * dt); plane.s += plane.v * dt;
    q = pathAt(F.ground, plane.s); alt = clamp((plane.s - run * 0.8) / (run * 0.2), 0, 1) * 0.25;
    if (plane.s >= run) { plane.phase = 'air'; plane.s = 0; }
  } else if (plane.phase === 'air') { // climb, circle the city, descend on the way back
    plane.v = AIR_V; plane.s += plane.v * dt; q = pathAt(F.air, plane.s);
    alt = Math.min(1, 0.25 + plane.s / 1500, (F.air.L - plane.s) / 2200);
    if (plane.s >= F.air.L) { plane.phase = 'land'; plane.s = 0; }
  } else { // touch down and brake on the runway
    plane.v = Math.max(0, plane.v - 45 * dt); plane.s += plane.v * dt; q = pathAt(F.ground, plane.s);
    if (plane.v <= 0) { endPlane(); return; }
  }
  plane.q = q;
  const im = IMG.airplane, w = (110 + 60 * alt) * cam.scale, hgt = w * im.height / im.width;
  let onScreen = false, sxc = 0, syc = 0;
  for (const shadow of [true, false]) {
    const [sx, sy] = w2s(q.x + (shadow ? 90 * alt : 0), q.y + (shadow ? 140 * alt + 6 : 0));
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) continue;
    if (!shadow) { onScreen = true; sxc = sx; syc = sy; }
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(q.h + cam.rot + Math.PI / 2);
    if (shadow) { ctx.globalAlpha = 0.18; ctx.filter = 'brightness(0)'; }
    ctx.drawImage(im, -w / 2, -hgt / 2, w, hgt);
    if (!shadow && night > 0.01) { const n = nightSprite('airplane'); if (n) { ctx.globalAlpha = night * 0.7; ctx.drawImage(n, -w / 2, -hgt / 2, w, hgt); } }
    ctx.restore();
  }
  // hum: louder near the middle of the screen, silent when the plane is off screen
  let g = 0;
  if (onScreen) { const d = Math.hypot(sxc - W / 2, syc - H / 2) / Math.hypot(W / 2, H / 2); g = clamp(1.2 - d, 0, 1) * (0.35 + 0.65 * Math.max(alt, plane.v / AIR_V)); }
  planeHum(g);
}
function endPlane() { plane = null; planeTimer = 120 + Math.random() * 60; planeHum(0); }
let hum = null;
async function planeHum(g) {
  if (muted) g = 0;
  if (!hum && g > 0.01) {
    hum = { starting: true };
    const b = await sound('plane', IOS ? 'snd/plane.wav' : 'snd/plane.ogg'), a = audio();
    if (!b || !a) { hum = null; return; }
    const src = a.createBufferSource(), gain = a.createGain(); src.buffer = b; src.loop = true;
    gain.gain.value = 0; src.connect(gain).connect(a.destination); src.start();
    hum = { src, gain };
  }
  if (hum && hum.gain) {
    hum.gain.gain.setTargetAtTime(g * 0.6, actx.currentTime, 0.25);
    if (g <= 0.01 && !plane) { const h = hum; hum = null; h.gain.gain.setTargetAtTime(0, actx.currentTime, 0.2); setTimeout(() => { try { h.src.stop(); } catch (e) { } }, 1200); }
  }
}
// ---------- city bus: a loop through the stops, 20 seconds at each stop ----------
let BUS = null;
function buildBus() {
  const stops = POIS.filter(p => /^bus\d/.test(p.key));
  if (stops.length < 2) return;
  let pts = [], stopS = [], h = 0;
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i], b = stops[(i + 1) % stops.length];
    const route = findRoute(a.node, b.node, h); if (!route) return;
    const leg = buildPath(route);
    h = leg[leg.length - 1].h;
    const add = leg.map(q => ({ x: q.x, y: q.y, vmax: q.vmax * 0.8 }));
    if (pts.length) add.shift();
    pts = pts.concat(add);
    pts[pts.length - 1].vmax = 0; // stop here
    stopS.push(pts.length - 1);
  }
  const path = profile(pts);
  // each stop stands on the right side of the road in the bus's direction, right at the curb, and nothing hides it
  stopS.forEach((pi, i) => {
    const st = stops[(i + 1) % stops.length]; // leg i ends at the next stop
    const q = path[pi], h = q.h, n = nodes[st.node];
    const r = nearestRoad([n.x, n.y], 80); if (!r) return;
    const half = RT[edges[r.eid].type].cw / 2, nrm = [-Math.sin(h), Math.cos(h)];
    let pos = null;
    for (let off = half + 14; off < half + 70 && !pos; off += 4) {
      const c = [n.x + nrm[0] * off, n.y + nrm[1] * off];
      if (spriteClear(c, st.w, st.sprite) && !inWater(c)) pos = c;
    }
    if (!pos) pos = [n.x + nrm[0] * (half + 40), n.y + nrm[1] * (half + 40)];
    st.x = pos[0]; st.y = pos[1];
    const f = footprint(st.x, st.y, st.w, st.sprite), pad = 6;
    const fp = [f[0] - pad, f[1] - pad, f[2] + pad, f[3] + pad];
    for (let k = decor.length - 1; k >= 0; k--) { const d = decor[k]; if (overlaps(fp, footprint(d.x, d.y, d.w, d.sprite))) decor.splice(k, 1); }
  });
  BUS = { path, stops: stopS.map(i => path[i].s), L: path[path.length - 1].s, s: 0, v: 0, idx: 0, wait: 20, next: 0, x: path[0].x, y: path[0].y, h: path[0].h };
}
function updateBus(dt) {
  const B = BUS; if (!B) return;
  if (B.wait > 0) { B.wait -= dt; B.v = 0; }
  else {
    const P = B.path, lim = P[B.idx].lim, ahead = P[Math.min(P.length - 1, B.idx + 6)].lim;
    const vt = Math.min(lim, ahead);
    B.v = B.v < vt ? Math.min(vt, B.v + 12 * dt) : Math.max(vt, B.v - 30 * dt);
    B.v = Math.max(B.v, 3);
    const target = B.stops[B.next];
    B.s = Math.min(B.s + B.v * dt, target);
    if (B.s >= target - 0.5) { B.wait = 20; B.v = 0; B.next = (B.next + 1) % B.stops.length; if (target >= B.L - 0.5) { B.s = 0; B.idx = 0; } }
  }
  const P = B.path;
  while (B.idx < P.length - 2 && P[B.idx + 1].s <= B.s) B.idx++;
  const a = P[B.idx], b = P[B.idx + 1], t = clamp((B.s - a.s) / ((b.s - a.s) || 1), 0, 1);
  B.x = lerp(a.x, b.x, t); B.y = lerp(a.y, b.y, t); B.h = a.h + angDiff(b.h, a.h) * t;
  // engine sound only near the bus
  const d = Math.hypot(B.x - car.x, B.y - car.y);
  busHum(B.wait > 0 ? 0.5 * clamp(1 - d / 500, 0, 1) : clamp(1 - d / 600, 0, 1));
}
// ---------- winter: a holiday truck caravan drives along the northern highway every 10-15 minutes ----------
let caravan = null, caravanTimer = 90, caravanLights = null;
// the caravan's way: in from the west on the highway, down into the old town, across the south bridge,
// through the east district and back up to the highway at the east roundabout (waypoints are road crossings)
const CARAVAN_WAY_PTS = [[1850, 3250], [3000, 3600], [3000, 4000], [5800, 4000], [5800, 4860], [8943, 4629], [9521, 3277], [10450, 3050], [10745, 2079]];
let CARAVAN_WAY = null;
function startCaravan(way) {
  const near = (p, cross) => { let best = null, bd = 1e9; for (const n of nodes) { const deg = n.edges.filter(e => !edges[e].dead).length; if (!deg || (cross && deg < 3)) continue; const d = Math.hypot(n.x - p[0], n.y - p[1]); if (d < bd) { bd = d; best = n.id; } } return best; };
  if (way) CARAVAN_WAY = way;
  if (!CARAVAN_WAY) CARAVAN_WAY = CARAVAN_WAY_PTS.map(p => near(p, true));
  let ids = [near(HWY[0]), ...(CARAVAN_WAY || []), near(HWY[HWY.length - 1])];
  if (Math.random() < 0.5) ids.reverse();
  let route = [], h = 0;
  for (let i = 0; i < ids.length - 1; i++) {
    if (ids[i] === ids[i + 1]) continue;
    const leg = findRoute(ids[i], ids[i + 1], h); if (!leg) return;
    route = route.concat(leg); const last = leg[leg.length - 1]; h = Math.atan2(nodes[ids[i + 1]].y - nodes[ids[i]].y, nodes[ids[i + 1]].x - nodes[ids[i]].x);
  }
  const path = buildPath(route);
  caravan = { path, L: path[path.length - 1].s, s: 0, v: 45, gap: 36 * 384 / 257 * 3.2 + 30, n: 3 };
}
// the bulbs painted on the truck (centres as fractions of the picture); each one gets a color in turn
const TRUCK_BULBS = [[0.4954,0.0102],[0.5897,0.0125],[0.3891,0.0129],[0.6756,0.0193],[0.313,0.0198],[0.2566,0.0317],[0.7357,0.0317],[0.2206,0.0482],[0.7746,0.048],[0.2054,0.0672],[0.7912,0.0671],[0.4978,0.0733],[0.3974,0.0745],[0.593,0.0744],[0.6871,0.0783],[0.31,0.0784],[0.2217,0.0866],[0.7748,0.087],[0.192,0.1104],[0.8034,0.1108],[0.4964,0.1351],[0.3928,0.1358],[0.5969,0.1358],[0.2717,0.1411],[0.7161,0.1406],[0.1969,0.1552],[0.7954,0.1555],[0.1784,0.1741],[0.814,0.1739],[0.171,0.1943],[0.8238,0.194],[0.1677,0.2167],[0.825,0.2167],[0.168,0.2394],[0.8266,0.2395],[0.1771,0.2623],[0.8147,0.2628],[0.2156,0.2797],[0.7635,0.2804],[0.298,0.2833],[0.3971,0.2836],[0.4962,0.2836],[0.5838,0.2836],[0.6769,0.2832],[0.2292,0.322],[0.4112,0.3221],[0.3235,0.3221],[0.4995,0.3223],[0.5966,0.3221],[0.6893,0.3222],[0.7834,0.322],[0.1436,0.3242],[0.8595,0.3245],[0.103,0.3378],[0.8936,0.3378],[0.0994,0.3612],[0.8976,0.3611],[0.0985,0.386],[0.8988,0.3861],[0.0992,0.4113],[0.8989,0.4114],[0.0989,0.439],[0.8984,0.4393],[0.099,0.4662],[0.8998,0.4665],[0.0988,0.4932],[0.8998,0.4932],[0.0989,0.5183],[0.8998,0.5189],[0.0983,0.5451],[0.9002,0.5446],[0.0982,0.5705],[0.9001,0.5715],[0.0983,0.5966],[0.9003,0.5968],[0.0987,0.6213],[0.8997,0.6219],[0.0987,0.647],[0.9,0.6474],[0.099,0.6721],[0.9005,0.6724],[0.0991,0.698],[0.9004,0.6984],[0.0984,0.7229],[0.8998,0.7227],[0.0982,0.7491],[0.8999,0.7493],[0.0985,0.7749],[0.9018,0.7758],[0.0985,0.8007],[0.9014,0.801],[0.0986,0.8256],[0.9009,0.8258],[0.0977,0.8513],[0.9015,0.851],[0.0981,0.8772],[0.902,0.8781],[0.0986,0.9038],[0.9014,0.9041],[0.0983,0.9297],[0.9014,0.9294],[0.0987,0.9531],[0.9016,0.9532],[0.1042,0.9751],[0.8948,0.9752],[0.1801,0.9865],[0.2886,0.9866],[0.391,0.9867],[0.4979,0.9865],[0.6056,0.9866],[0.7092,0.9866],[0.8159,0.9866]];
function truckLights() { return TRUCK_BULBS.map(([x, y], k) => [x, y, k % 4]); }
function updateCaravan(dt) {
  if (!newYearNow() || !winter) { if (caravan) { caravan = null; caravanSong(0); } return; }
  if (!caravan) { caravanTimer -= dt; if (caravanTimer <= 0) { caravanTimer = 600; startCaravan(); } return; }
  const C = caravan; C.s += C.v * dt;
  if (C.s - (C.n - 1) * C.gap > C.L) { caravan = null; caravanSong(0); return; }
  // the song is heard near the caravan: by distance from the middle of the screen
  const q = posAt(C.path, clamp(C.s - C.gap, 0, C.L)), [sx, sy] = w2s(q.x, q.y);
  const d = Math.hypot(sx - W / 2, sy - H / 2) / Math.hypot(W / 2, H / 2);
  caravanSong(clamp(1.4 - d, 0, 1));
}
function posAt(P, s) {
  let lo = 0, hi = P.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].s < s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = clamp((s - a.s) / ((b.s - a.s) || 1), 0, 1);
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), h: a.h + angDiff(b.h, a.h) * t };
}
function drawCaravan() {
  const C = caravan, im = IMG.xmas_truck; if (!C || !im) return;
  const len = Math.max(18, 36 * cam.scale) * 384 / 257 * 3.2, wid = len * im.width / im.height;
  const lights = caravanLights || (caravanLights = truckLights());
  for (let i = 0; i < C.n; i++) {
    const s = C.s - i * C.gap; if (s < 0 || s > C.L) continue;
    const q = posAt(C.path, s), [sx, sy] = w2s(q.x, q.y);
    if (sx < -300 || sx > W + 300 || sy < -300 || sy > H + 300) continue;
    const near = Math.hypot(q.x - car.x, q.y - car.y) < 140;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(q.h + cam.rot + Math.PI / 2); ctx.globalAlpha = near ? 0.45 : 1;
    ctx.fillStyle = 'rgba(0,0,0,.18)'; roundRect(-wid / 2 + 3, -len / 2 + 5, wid, len, wid * 0.2); ctx.fill();
    ctx.drawImage(im, -wid / 2, -len / 2, wid, len);
    if (lights) {
      // colored bulbs blink like a garland, as bright as the hazard lights: a hot white core and a wide colored glow
      const tt = performance.now() / 1000, rr = Math.max(1.3, wid * 0.03), G = BULB_GLOW || (BULB_GLOW = makeBulbGlow());
      for (const [fx, fy, k] of lights) {
        // one minute all bulbs glow steady warm yellow, the next minute the colors run along the garland
        const party = Math.floor((tt + garlandShift) / 60) % 2 === 1;
        const step = Math.floor(tt * 2.5) + i, c = party ? (k + step) % 4 : 3;
        if (party && (k + step) % 4 === 3 && (k >> 2) % 2 === step % 2) continue;
        const x = (fx - 0.5) * wid, y = (fy - 0.5) * len, R = rr * 3.2;
        ctx.globalAlpha = near ? 0.45 : 1;
        ctx.drawImage(G[c], x - R, y - R, 2 * R, 2 * R);
      }
    }
    ctx.restore();
  }
}
let BULB_GLOW = null, garlandShift = 0;
function makeBulbGlow() {
  return [[255, 60, 60], [60, 255, 110], [70, 160, 255], [255, 215, 50]].map(([r, g, b]) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.3, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.55, `rgba(${r},${g},${b},.45)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(28, 28, 4, 0, 7); x.fill(); return c;
  });
}
let chum = null;
async function caravanSong(g) {
  if (!actx) return;
  if (muted || !voiceOn) g = 0;
  if (!chum && g > 0.01) {
    chum = { starting: true };
    const b = await sound('caravan', 'snd/caravan.mp3'), a = audio();
    if (!b || !a) { chum = null; return; }
    const src = a.createBufferSource(), gain = a.createGain(); src.buffer = b; src.loop = true;
    gain.gain.value = 0; src.connect(gain).connect(a.destination); src.start(); chum = { src, gain, g: 0 };
  }
  if (chum && chum.gain && Math.abs(chum.g - g) > 0.02) {
    chum.g = g; chum.gain.gain.setTargetAtTime(g * 0.9, actx.currentTime, 0.4);
    if (g <= 0.01 && !caravan) { const c = chum; chum = null; c.gain.gain.setTargetAtTime(0, actx.currentTime, 0.3); setTimeout(() => { try { c.src.stop(); } catch (e) { } }, 1500); }
  }
}
function drawBus() {
  const B = BUS; if (!B) return;
  const [sx, sy] = w2s(B.x, B.y); if (sx < -200 || sx > W + 200 || sy < -200 || sy > H + 200) return;
  const len = Math.max(18, 36 * cam.scale) * 384 / 257 * 2.3, im = IMG.bus;
  const wid = im ? len * im.width / im.height : len * 0.38;
  // see-through when it drives over Kostya's car, so they never look like they crash
  const near = Math.hypot(B.x - car.x, B.y - car.y) < 110;
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(B.h + cam.rot + Math.PI / 2); ctx.globalAlpha = near ? 0.45 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.18)'; roundRect(-wid / 2 + 2, -len / 2 + 4, wid, len, wid * 0.25); ctx.fill();
  if (im) ctx.drawImage(im, -wid / 2, -len / 2, wid, len);
  else { ctx.fillStyle = '#FF8A1F'; ctx.strokeStyle = '#1D2A44'; ctx.lineWidth = 2; roundRect(-wid / 2, -len / 2, wid, len, wid * 0.25); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#9BD4FF'; roundRect(-wid * 0.38, -len * 0.47, wid * 0.76, len * 0.12, 4); ctx.fill(); }
  ctx.restore();
}
let bhum = null;
async function busHum(g) {
  if (!actx) return; // no sound before the first tap
  if (muted || !engineOn) g = 0;
  if (!bhum && g > 0.01) {
    bhum = { starting: true };
    const b = await sound('bus', IOS ? 'snd/bus.wav' : 'snd/bus.ogg'), a = audio();
    if (!b || !a) { setTimeout(() => { bhum = null; }, 5000); return; }
    const src = a.createBufferSource(), gain = a.createGain(); src.buffer = b; src.loop = true;
    gain.gain.value = 0; src.connect(gain).connect(a.destination); src.start();
    bhum = { src, gain, g: 0 };
  }
  if (bhum && bhum.gain && Math.abs(bhum.g - g) > 0.02) { bhum.g = g; bhum.gain.gain.setTargetAtTime(g * 0.5, actx.currentTime, 0.3); }
}
// ---------- Santa: in winter his sleigh flies over the city about every 10 minutes, with the holiday song ----------
let santa = null, santaTimer = 60;
function startSanta() {
  // fly straight across what is on the screen now, so Kostya sees it
  const a = Math.random() * TAU, d = [Math.cos(a), Math.sin(a)], span = Math.hypot(W, H) / cam.scale * 0.5 + 250;
  const c = [cam.x, cam.y], from = [c[0] - d[0] * span, c[1] - d[1] * span];
  santa = { x: from[0], y: from[1], d, h: a, v: AIR_V * 2 / 3, // a third slower than the plane
    left: 2 * span, sparks: [] };
  playSong('santa');
}
function drawSanta(dt) {
  if (!newYearNow() || !winter) { if (santa) { santa = null; stopSong(); } return; }
  if (!santa) { santaTimer -= dt; if (santaTimer <= 0 && mode !== 'preview') { santaTimer = 540 + Math.random() * 120; startSanta(); } return; }
  const S = santa, im = IMG.santa;
  S.x += S.d[0] * S.v * dt; S.y += S.d[1] * S.v * dt; S.left -= S.v * dt;
  if (S.left <= 0) { santa = null; return; }
  const len = Math.max(190, 300 * cam.scale), wid = im ? len * im.width / im.height : len * 0.35, bob = Math.sin(performance.now() / 300) * 4;
  // golden sparkles fall behind the sleigh
  if (Math.random() < dt * 25) S.sparks.push({ x: S.x - S.d[0] * 110, y: S.y - S.d[1] * 110, life: 1 });
  ctx.save();
  for (const k of S.sparks) {
    k.life -= dt * 0.8; if (k.life <= 0) continue;
    const [px, py] = w2s(k.x, k.y); ctx.globalAlpha = k.life; ctx.fillStyle = '#FFD23F';
    ctx.beginPath(); for (let j = 0; j < 4; j++) { const an = j * Math.PI / 2, r = 6 * k.life + 2; ctx.lineTo(px + Math.cos(an) * r, py + Math.sin(an) * r); ctx.lineTo(px + Math.cos(an + Math.PI / 4) * r * 0.35, py + Math.sin(an + Math.PI / 4) * r * 0.35); } ctx.fill();
  }
  S.sparks = S.sparks.filter(k => k.life > 0);
  ctx.restore();
  const [sx, sy] = w2s(S.x, S.y);
  for (const shadow of [true, false]) {
    ctx.save(); ctx.translate(sx + (shadow ? 60 : 0), sy + (shadow ? 90 : bob)); ctx.rotate(S.h + cam.rot + Math.PI / 2);
    if (shadow) { ctx.globalAlpha = 0.15; ctx.filter = 'brightness(0)'; }
    if (im) ctx.drawImage(im, -wid / 2, -len / 2, wid, len);
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
// local picture point of a lot -> world
function lotPt(L, fx, fy) { const c = Math.cos(L.ang), sn = Math.sin(L.ang), x = fx * L.W, y = fy * L.H; return [L.x + c * x - sn * y, L.y + sn * x + c * y]; }
const roundCorner = (a, p, b, r) => { const d1 = dist(a, p), d2 = dist(p, b), c1 = Math.min(r, d1 * .45), c2 = Math.min(r, d2 * .45); const p1 = [p[0] + (a[0] - p[0]) * c1 / d1, p[1] + (a[1] - p[1]) * c1 / d1], p2 = [p[0] + (b[0] - p[0]) * c2 / d2, p[1] + (b[1] - p[1]) * c2 / d2]; const o = []; for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; o.push([u * u * p1[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * p[1] + t * t * p2[1]]); } return o; };
function samplePts(key, extra) { const pts = []; for (let i = 1; i < key.length; i++) { const a = key[i - 1], b = key[i], n = Math.max(1, Math.ceil(dist(a, b) / 3)); for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push({ x: lerp(a[0], b[0], k / n), y: lerp(a[1], b[1], k / n), vmax: 14, ...extra }); } return pts; }
// a slow drive from the road into a free spot
function lotIn(L, spot, from) {
  const S = LOT_SPOTS[L.sp], mouth = lotPt(L, 0.56, S.aisle), turn = lotPt(L, spot[0], S.aisle), park = lotPt(L, spot[0], spot[1]);
  return samplePts([from, ...roundCorner(from, mouth, turn, 22), ...roundCorner(mouth, turn, park, Math.abs(spot[1] - S.aisle) * L.H * 0.6), park]);
}
// back out of the spot turning so the car ends up facing the exit, then drive forward onto the road
function lotOut(L, spot, to) {
  const S = LOT_SPOTS[L.sp], mouth = lotPt(L, 0.56, S.aisle), turn = lotPt(L, spot[0], S.aisle), park = lotPt(L, spot[0], spot[1]);
  const back = lotPt(L, spot[0] - 38 / L.W, S.aisle);
  const rev = samplePts([park, ...roundCorner(park, turn, back, Math.abs(spot[1] - S.aisle) * L.H * 0.8), back], { rev: true });
  const fwd = samplePts([back, ...roundCorner(back, mouth, to, 22), to]);
  return rev.concat(fwd.slice(1));
}
function startPreview(poi) {
  stopSong();
  if (poi.node === car.node && !car.parked) return;
  if (poi === car.parked?.poi) return;
  const route = findRoute(car.node, poi.node, car.h);
  if (!route) return;
  let path = buildPath(route);
  if (car.parked || poi.lot) {
    let pts = path.map(q => ({ x: q.x, y: q.y, vmax: q.vmax }));
    if (car.parked) pts = lotOut(car.parked.poi.lot, car.parked.spot, [pts[0].x, pts[0].y]).concat(pts.slice(1));
    if (poi.lot) { const S = LOT_SPOTS[poi.lot.sp], spot = S.spots[Math.floor(Math.random() * S.spots.length)]; poi.spot = spot; const end = pts[pts.length - 1]; pts = pts.concat(lotIn(poi.lot, spot, [end.x, end.y]).slice(1)); }
    path = profile(pts);
  }
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
  setSpecial();
  $('btnHazard').classList.toggle('on', hazard);
  say(kidName ? `${kidName}, поехали! ${trip.poi.phrase}!` : trip.poi.phrase + '! Поехали!', true, ['a01', clip(trip.poi.phrase) || 'g02']);
  requestWake();
  ui();
}
function stopNav() {
  if (mode === 'nav' && trip) {
    const r = nearestRoad([car.x, car.y]);
    if (r) car.node = nodeAtRoad(r); // the car stays here; the next trip starts from this spot
    if (trip.s > 30) car.parked = null;
  }
  mode = 'idle'; trip = null;
  engineStop(); sirenStop(); saveFuel();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseWake();
  tgt.x = car.x; tgt.y = car.y; tgt.rot = 0; tgt.scale = baseScale() * userZoom; tgt.fy = 0.5;
  ui();
}
// a song plays once on arrival; it stops as soon as the next trip is planned
let songSrc = null;
async function playSong(name) {
  stopSong();
  if (muted || !voiceOn) return;
  const a = audio(), b = await sound(name, 'snd/' + name + '.mp3'); if (!a || !b) return;
  const src = a.createBufferSource(), g = a.createGain(); g.gain.value = 1.1; src.buffer = b; src.connect(g).connect(a.destination); src.start(); songSrc = src;
}
function stopSong() { try { songSrc?.stop(); } catch (e) { } songSrc = null; }
function arrive() {
  mode = 'arrived';
  car.node = trip.poi.node;
  car.parked = trip.poi.lot ? { poi: trip.poi, spot: trip.poi.spot } : null;
  if (trip.poi.key === 'pineapples') playSong('song_ananasi'); // Kostya's own song, no words before it
  else say(kidName ? `Ура, ${kidName}, мы приехали! ${trip.poi.name}!` : 'Вы прибыли! ' + trip.poi.name + '!', true, ['a02', clip(trip.poi.name) || (Math.random() < 0.5 ? 'g05' : 'g06')]);
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
  engineStop(); sirenStop(); saveFuel();
  if (trip.poi.key === 'service' && broken) startRepair();
  if (isGas(trip.poi) && fuel < 0.99) { say(isEV() ? 'Заряжаемся!' : 'Заправляемся!'); setTimeout(() => { refuelAnim = true; }, 2500); }
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
const ENGINE_FILE = IOS ? 'snd/engine.wav' : 'snd/engine.ogg';
addEventListener('pointerdown', () => { audio(); sound('ign', 'snd/ignition.mp3'); sound('eng', ENGINE_FILE); }, { once: true });
let eng = null; // {src, gain}
async function engineStart() {
  if (muted || !engineOn || eng || mode !== 'nav') return;
  const robot = carSkin === 'car_robot';
  const b = robot ? await sound('robot', IOS ? 'snd/robot.wav' : 'snd/robot.ogg') : await sound('eng', ENGINE_FILE); const a = audio(); if (!b || !a || eng || mode !== 'nav') return;
  const src = a.createBufferSource(), gain = a.createGain();
  src.buffer = b; src.loop = true; src.connect(gain).connect(a.destination);
  gain.gain.setValueAtTime(0, a.currentTime); gain.gain.linearRampToValueAtTime(0.5, a.currentTime + 0.6);
  src.start(); eng = { src, gain };
}
function engineSpeed(v) {
  if (!eng) return;
  const k = Math.min(1, v / 110), a = actx;
  // robot: steps follow the walking speed (one step every 14 m), quiet when standing
  if (carSkin === 'car_robot') { eng.src.playbackRate.setTargetAtTime(clamp(v / 40, 0.55, 1.8), a.currentTime, 0.3); eng.gain.gain.setTargetAtTime(v < 3 ? 0.1 : 0.55, a.currentTime, 0.2); return; }
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
  const robot = carSkin === 'car_robot'; // the robot powers up instead of turning a key
  const b = robot ? await sound('robot_on', 'snd/robot_on.mp3') : await sound('ign', 'snd/ignition.mp3'), a = audio();
  if (b && a) { const s = a.createBufferSource(), g = a.createGain(); g.gain.value = 0.9; s.buffer = b; s.connect(g).connect(a.destination); s.start(); }
  setTimeout(() => { btn.disabled = false; btn.classList.remove('turning'); startNav(); engineStart(); }, robot ? 1000 : 1600);
}

// ---------- fuel ----------
const FUEL_METERS = 35000, FUEL_MIN = 0.05; // a full tank is about 8 trips; never runs dry
let fuel = 1, fuelSaved = 0, refuelAnim = null;
// the Tesla has its own battery; all the other cars share one fuel tank
const fuelKey = () => carSkin === 'car_robot' ? 'battery_robot' : isEV() ? 'battery' : 'fuel';
function loadFuel() { fuel = 1; try { const f = parseFloat(localStorage.getItem(fuelKey())); if (f >= 0) fuel = Math.max(FUEL_MIN, Math.min(1, f)); } catch (e) { } }
loadFuel();
const saveFuel = () => { try { localStorage.setItem(fuelKey(), fuel.toFixed(3)); } catch (e) { } };
const isGas = p => p && (isEV() ? p.key === 'chargeW' || p.key === 'chargeE' : p.key === 'gas' || p.key === 'gas2');
function burnFuel(meters) {
  const before = fuel;
  fuel = Math.max(FUEL_MIN, fuel - meters / FUEL_METERS);
  const who = kidName ? kidName + ', ' : '';
  if (before > 0.15 && fuel <= 0.15) say(cap(who + (isEV() ? 'батарея садится! Поехали на зарядку!' : 'бензин заканчивается! Поехали на заправку!')), false, [isEV() ? 'h02' : 'f01']);
  if (performance.now() - fuelSaved > 3000) { fuelSaved = performance.now(); saveFuel(); }
}
function drawFuel(dt) {
  drawBoostButton();
  if (refuelAnim) {
    fuel = Math.min(1, fuel + dt / (isEV() ? 9 : 4));
    if (fuel >= 1) { refuelAnim = null; saveFuel(); say(isEV() ? 'Батарея заряжена!' : 'Бак полный! Можно ехать!'); }
  }
  const el = $('fuel'), low = fuel < 0.25;
  $('fuelBar').style.width = Math.round(fuel * 100) + '%';
  $('fuelBar').style.background = fuel < 0.25 ? '#F2545B' : fuel < 0.5 ? '#FFB020' : '#27AE60';
  el.classList.toggle('low', low && mode === 'idle');
  $('fuelWarn').classList.toggle('hidden', !(low && mode === 'idle'));
  $('fuelWarn').classList.toggle('ev', isEV());
  el.classList.toggle('hidden', mode === 'preview');
}
// ---------- breakdowns: after 12-18 minutes of driving the car breaks, drives slower and smokes until it is repaired ----------
let broken = false, driveSec = 0, breakAt = 0, repairAnim = null;
const newBreakAt = () => (12 + Math.random() * 6) * 60;
try { broken = localStorage.getItem('broken') === '1'; driveSec = +localStorage.getItem('driveSec') || 0; breakAt = +localStorage.getItem('breakAt') || 0; } catch (e) { }
if (!breakAt) breakAt = newBreakAt();
const saveBreak = () => { try { localStorage.setItem('broken', broken ? '1' : '0'); localStorage.setItem('driveSec', Math.round(driveSec)); localStorage.setItem('breakAt', Math.round(breakAt)); } catch (e) { } };
let breakSaved = 0;
function updateBreak(dt) {
  if (mode === 'nav' && !broken && POIS.some(p => p.key === 'service')) {
    driveSec += dt;
    if (driveSec - breakSaved > 10) { breakSaved = driveSec; saveBreak(); }
    if (driveSec >= breakAt) {
      broken = true; saveBreak();
      playOnce('breakdown', 'snd/breakdown.mp3', 1);
      say(kidName ? `Ой, ${kidName}! Машинка сломалась! Поехали в автосервис!` : 'Ой! Машинка сломалась! Поехали в автосервис!', true, ['h08']);
    }
  }
  if (repairAnim) {
    repairAnim.t += dt;
    if (repairAnim.t > 5) { repairAnim = null; broken = false; driveSec = 0; breakSaved = 0; breakAt = newBreakAt(); saveBreak(); say('Машинка как новая! Можно ехать!'); }
  }
  $('fixWarn').classList.toggle('hidden', !(broken && mode === 'idle'));
}
function startRepair() {
  say('Чиним машинку!');
  setTimeout(() => { repairAnim = { t: 0 }; playOnce('repair', 'snd/repair.mp3', 1); }, 2000);
}
// smoke from a broken car: cartoon puffs that leave the exhaust, grow, drift up and fade
function drawSmoke(t, sx, sy, h, hh) {
  ctx.save();
  const N = 5, speed = 0.45;
  const puffs = [];
  for (let i = 0; i < N; i++) {
    const k = (t * speed + i / N) % 1;
    const seed = Math.floor(t * speed + i / N) * 7 + i;
    const wob = Math.sin(seed * 12.9898);
    const back = hh * (0.55 + k * 1.5);
    puffs.push({ k, x: sx - Math.cos(h) * back + Math.sin(h) * hh * 0.35 * wob * k, y: sy - Math.sin(h) * back - k * hh * 0.9, r: hh * (0.13 + k * 0.36), a: k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88 });
  }
  puffs.sort((p, q) => q.k - p.k); // older puffs behind
  const blobs = [[0, 0, 1], [-0.62, 0.18, 0.72], [0.6, 0.2, 0.68], [0.05, -0.55, 0.62]];
  for (const P of puffs) {
    ctx.globalAlpha = 0.95 * P.a;
    // outline first, then the fill, so the blobs merge into one cloud
    ctx.fillStyle = '#7C828D';
    ctx.beginPath(); for (const [ox, oy, rr] of blobs) { const cx = P.x + ox * P.r, cy = P.y + oy * P.r; ctx.moveTo(cx + P.r * rr + 2, cy); ctx.arc(cx, cy, P.r * rr + 2, 0, TAU); } ctx.fill();
    ctx.fillStyle = P.k < 0.3 ? '#A7ADB7' : '#C9CDD4';
    ctx.beginPath(); for (const [ox, oy, rr] of blobs) { const cx = P.x + ox * P.r, cy = P.y + oy * P.r; ctx.moveTo(cx + P.r * rr, cy); ctx.arc(cx, cy, P.r * rr, 0, TAU); } ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.arc(P.x - P.r * 0.3, P.y - P.r * 0.35, P.r * 0.32, 0, TAU); ctx.fill();
  }
  ctx.restore();
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
  let vt = Math.min(lim, ahead) * (sirenOn ? 1.2 : 1) * (broken ? 0.6 : 1);
  const boosting = performance.now() < boostUntil;
  if (boosting) { let cl = 999; for (let i = trip.idx; i < Math.min(P.length, trip.idx + 14); i++) cl = Math.min(cl, P[i].cl); vt = Math.max(vt, Math.min(vt * 2, cl)); }
  if (trip.v < vt) trip.v = Math.min(vt, trip.v + (boosting ? 70 : 22) * dt); else trip.v = Math.max(vt, trip.v - 40 * dt);
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
    if (nd > 1300) say(`Прямо ${sayDist(nd).replace('через ', '')}`, false, ['e01']);
  }
  const m = trip.man[trip.mi];
  const d = (m ? m.s : trip.L) - trip.s;
  const v = trip.v, far = Math.max(260, v * 7), near = Math.max(70, v * 2.4);
  const key = trip.mi;
  if (m && m.kind === 'ring') {
    if (!trip.said['f' + key] && d < far && d > near * 1.5) { trip.said['f' + key] = 1; say(`${cap(sayDist(d))} ${m.say}`, false, m.exit <= 4 ? ['d0' + m.exit] : null); }
    if (!trip.said['n' + key] && d < near) { trip.said['n' + key] = 1; trip.said['f' + key] = 1; say(cap(m.say), true, m.exit <= 4 ? ['d0' + (4 + m.exit)] : null); }
  } else if (!m && !trip.said.fin && d < far && d > 60) { trip.said.fin = 1; say(`${cap(sayDist(d))} вы на месте`, false, ['e02']); }

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
  drawGauge(v); drawFuelGauge(fuel);
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- UI ----------
function setPic(el, poi) {
  el.innerHTML = '';
  if (IMG[poi.sprite]) { const i = document.createElement('img'); i.src = IMG[poi.sprite].src; el.appendChild(i); }
  else el.textContent = poi.emoji;
}
function nearestLot() {
  let best = null, bd = 1e9;
  for (const p of POIS) { if (!p.lot || p === car.parked?.poi) continue; const d = Math.hypot(p.x - car.x, p.y - car.y); if (d < bd) { bd = d; best = p; } }
  return best;
}
function buildDests() {
  const box = $('dests'); box.innerHTML = '';
  let lotBtn = false;
  for (const p of POIS) {
    if (p.lot && lotBtn) continue;
    if (/^bus\d/.test(p.key)) continue;
    const b = document.createElement('button'); b.className = 'dest'; b.dataset.key = p.lot ? 'parking' : p.key;
    const pic = document.createElement('div'); pic.className = 'pic'; setPic(pic, p);
    const l = document.createElement('div'); l.className = 'lbl'; l.textContent = p.name;
    b.append(pic, l);
    b.onclick = () => startPreview(p.lot ? nearestLot() : p);
    if (p.lot) lotBtn = true;
    box.appendChild(b);
  }
}
function ui() {
  document.body.classList.toggle('nav', mode === 'nav');
  $('dests').classList.toggle('hidden', mode !== 'idle');
  $('preview').classList.toggle('hidden', mode !== 'preview');
  $('arrived').classList.toggle('hidden', mode !== 'arrived');
  $('banner').classList.toggle('hidden', mode !== 'nav');
  $('dash').classList.toggle('hidden', mode !== 'nav');
  $('speed').classList.toggle('hidden', mode !== 'nav');
  $('btnStop').classList.toggle('hidden', mode !== 'nav');
  $('btnCenter').classList.toggle('hidden', mode !== 'idle');
  $('btnCar').classList.toggle('hidden', mode !== 'idle');
  if (mode !== 'idle') { $('garage').classList.add('hidden'); $('settings').classList.add('hidden'); }
  $('btnSettings').classList.toggle('hidden', mode !== 'idle');
  for (const b of document.querySelectorAll('#dests .dest')) b.classList.toggle('here', b.dataset.key === 'parking' ? !!car.parked : POIS.find(p => p.key === b.dataset.key)?.node === car.node && !car.parked);
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
    b.onclick = () => { saveFuel(); refuelAnim = null; carSkin = name; try { localStorage.setItem('carSkin', name); } catch (e) { } loadFuel(); buildGarage(); };
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
$('btnCar').onclick = () => { buildGarage(); $('garage').classList.toggle('hidden'); $('settings').classList.add('hidden'); };
// settings: opens on a long press so the child does not open it by accident
function openSettings() {
  buildGarage(); showMuteToggle(); showDriver(); showEngineToggle(); showVoiceToggle(); showDayMode(); showDiag();
  $('settings').classList.remove('hidden'); $('garage').classList.add('hidden');
}
(() => {
  const b = $('btnSettings'); let t = 0;
  const start = e => { e.preventDefault(); b.classList.add('holding'); t = setTimeout(() => { b.classList.remove('holding'); openSettings(); }, 900); };
  const stop = () => { clearTimeout(t); b.classList.remove('holding'); };
  b.addEventListener('pointerdown', start); b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
  b.addEventListener('contextmenu', e => e.preventDefault());
})();
$('settingsClose').onclick = () => $('settings').classList.add('hidden');
const WINTER_NAMES = { auto: '❄️ Зима: сама (1 дек - 15 янв)', on: '❄️ Зима: включена', off: '🌳 Зима: выключена' };
function showWinter() { $('winterMode').textContent = WINTER_NAMES[winterMode]; }
$('winterMode').onclick = () => { winterMode = { auto: 'on', on: 'off', off: 'auto' }[winterMode]; try { localStorage.setItem('winterMode', winterMode); } catch (e) { } showWinter(); showWeather(); };
function showWeather() { $('weatherMode').textContent = { auto: '🌦️ Погода: сама меняется', clear: '☀️ Погода: ясно', wet: winterNow() ? '🌨️ Погода: снегопад' : '🌧️ Погода: дождь' }[weatherMode]; }
$('weatherMode').onclick = () => { weatherMode = { auto: 'clear', clear: 'wet', wet: 'auto' }[weatherMode]; try { localStorage.setItem('weatherMode', weatherMode); } catch (e) { } showWeather(); };
const NY_NAMES = { auto: '🎅 Новый год: 15 дек - 15 янв', on: '🎅 Новый год: включен', off: '🎅 Новый год: выключен' };
function showNewYear() { $('newYearMode').textContent = NY_NAMES[newYearMode]; }
$('newYearMode').onclick = () => { newYearMode = { auto: 'on', on: 'off', off: 'auto' }[newYearMode]; try { localStorage.setItem('newYearMode', newYearMode); } catch (e) { } showNewYear(); };
showWinter(); showWeather(); showNewYear();
const DAY_NAMES = { auto: '🌗 Время суток: как на часах', day: '☀️ Время суток: всегда день', night: '🌙 Время суток: всегда ночь' };
function showDayMode() { $('dayMode').textContent = DAY_NAMES[dayMode]; }
$('dayMode').onclick = () => { dayMode = { auto: 'day', day: 'night', night: 'auto' }[dayMode]; try { localStorage.setItem('dayMode', dayMode); } catch (e) { } showDayMode(); };
function showMuteToggle() { $('muteToggle').textContent = muted ? '🔇 Весь звук: выкл' : '🔊 Весь звук: вкл'; }
$('muteToggle').onclick = () => { muted = !muted; try { localStorage.setItem('muted', muted ? '1' : '0'); } catch (e) { } if (muted) { speechSynthesis?.cancel(); engineStop(); sirenStop(); } showMuteToggle(); };
function showVoiceToggle() { $('voiceToggle').textContent = voiceOn ? '🗣️ Голос навигатора: вкл' : '🤐 Голос навигатора: выкл'; }
$('voiceToggle').onclick = () => { voiceOn = !voiceOn; try { localStorage.setItem('voiceOn', voiceOn ? '1' : '0'); } catch (e) { } if (!voiceOn) { speechSynthesis?.cancel(); vQueue = []; try { vNow?.stop(); } catch (e) { } } showVoiceToggle(); };
function testPhrase() { return kidName ? `Проверка голоса, ${kidName}` : 'Проверка голоса'; }
function speakNow(text) {
  if (!('speechSynthesis' in window)) { diagNote('синтез речи недоступен'); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'ru-RU'; if (ruVoice) u.voice = ruVoice;
  speechSynthesis.speak(u);
}
$('testVoice').onclick = async () => { if (!(await playClips(['a01'], true))) speakNow(testPhrase()); };
$('refuel').onclick = () => { fuel = 1; saveFuel(); diagNote(isEV() ? 'батарея заряжена' : 'бак полный'); };
$('forceUpdate').onclick = async () => {
  diagNote('обновляю...');
  try { const regs = await navigator.serviceWorker?.getRegistrations(); for (const r of regs || []) await r.unregister(); } catch (e) { }
  try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { }
  location.reload();
};
function diagNote(t) { $('diagNote').textContent = t; }
function showDiag() { $('diag').innerHTML = `Версия: <b>${APP_VERSION}</b>`; }

$('garageClose').onclick = () => $('garage').classList.add('hidden');
$('pvGo').onclick = ignition;
function clickSound(vol = 0.9, freq = 2400) {
  if (muted) return;
  const a = audio(); if (!a) return;
  const n = Math.floor(a.sampleRate * 0.03), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
  const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2; g.gain.value = vol;
  src.buffer = buf; src.connect(f).connect(g).connect(a.destination); src.start();
}
// hazard relay: tick when the lamps go on, tock when they go off (only while driving)
let hazPhase = -1;
function hazardTick() {
  const ph = hazard || turnSig ? Math.floor(performance.now() / 350) % 2 : -1;
  // buttons blink on the same clock as the lamps on the car
  const lit = ph === 0;
  $('btnHazard').classList.toggle('lit', hazard && lit);
  $('btnTurnL').classList.toggle('lit', (hazard || turnSig === -1) && lit);
  $('btnTurnR').classList.toggle('lit', (hazard || turnSig === 1) && lit);
  if (ph !== hazPhase) { if ((hazard || turnSig) && hazPhase !== -1 && mode === 'nav') clickSound(0.35, ph === 0 ? 2600 : 1700); hazPhase = ph; }
}
function setTurn(v) {
  turnSig = v; turnH0 = car.h;
  $('btnTurnL').classList.toggle('on', v === -1); $('btnTurnR').classList.toggle('on', v === 1);
}
// like a real car: the blinker switches itself off once the turn is done
function turnAutoOff() { if (turnSig && mode === 'nav' && Math.abs(angDiff(car.h, turnH0)) > 1.1) setTurn(0); }
$('btnTurnL').onclick = () => { clickSound(); setTurn(turnSig === -1 ? 0 : -1); };
$('btnTurnR').onclick = () => { clickSound(); setTurn(turnSig === 1 ? 0 : 1); };
$('btnHazard').onclick = () => { clickSound(); hazard = !hazard; $('btnHazard').classList.toggle('on', hazard); };
$('btnLights').onclick = () => { clickSound(); lightsOn = !lightsOn; $('btnLights').classList.toggle('on', lightsOn); };
// ---------- special button: siren for police, meow for the cat, horn for the others ----------
const SIREN_FILE = IOS ? 'snd/siren.wav' : 'snd/siren.ogg';
const HORNS = { car_top: 'snd/horn1.mp3', car_blue: 'snd/horn2.mp3' };
let hazard = false, turnSig = 0, turnH0 = 0; // -1 left, 1 right
let sirenOn = false, siren = null, meowUntil = 0, boostUntil = 0, boostReady = 0;
const BOOST_MS = 5000, BOOST_CD = 10000;
function setSpecial() {
  sirenOn = false; $('btnSpecial').classList.remove('on');
  boostUntil = 0; boostReady = 0; $('btnSpecial').style.background = '';
  $('btnSpecial').textContent = { car_police: '🚨', car_cat: '🐾', car_race: '🔥', car_tesla: '⚡', car_robot: '🛡️' }[carSkin] || '📯';
  if (carSkin === 'car_race' || carSkin === 'car_tesla') sound('nitro', 'snd/nitro.mp3');
  else if (carSkin === 'car_police') sound('siren', SIREN_FILE);
  else if (carSkin === 'car_cat') sound('meow', 'snd/meow.mp3');
  else sound('horn_' + carSkin, HORNS[carSkin] || HORNS.car_top);
}
async function playOnce(name, file, vol) {
  if (muted) return;
  const b = await sound(name, file), a = audio(); if (!b || !a) return;
  const s = a.createBufferSource(), g = a.createGain(); g.gain.value = vol; s.buffer = b; s.connect(g).connect(a.destination); s.start();
}
async function sirenStart() {
  if (muted || siren) return;
  siren = { starting: true };
  const b = await sound('siren', SIREN_FILE), a = audio();
  if (!b || !a || !sirenOn) { siren = null; return; }
  const src = a.createBufferSource(), gain = a.createGain(); src.buffer = b; src.loop = true;
  gain.gain.setValueAtTime(0, a.currentTime); gain.gain.linearRampToValueAtTime(0.45, a.currentTime + 0.3);
  src.connect(gain).connect(a.destination); src.start(); siren = { src, gain };
}
function drawBoostButton() {
  // the button is grey while the boost recharges and fills up from the bottom
  if (mode !== 'nav' || (carSkin !== 'car_race' && carSkin !== 'car_tesla')) return;
  const b = $('btnSpecial'), now = performance.now(), col = carSkin === 'car_race' ? '#FF7A1A' : '#2FB8FF';
  let bg;
  if (now < boostUntil) bg = col;
  else if (now < boostReady) { const k = Math.round(100 * (1 - (boostReady - now) / BOOST_CD)); bg = `linear-gradient(to top, ${col}88 ${k}%, #2A303C ${k}%)`; }
  else bg = '#3A4152';
  if (b.dataset.bg !== bg) { b.dataset.bg = bg; b.style.background = bg; b.style.filter = now < boostReady && now >= boostUntil ? 'grayscale(.7)' : ''; }
}
function sirenStop() {
  sirenOn = false; $('btnSpecial').classList.remove('on');
  const s = siren; siren = null;
  if (s && s.gain) { s.gain.gain.setTargetAtTime(0, actx.currentTime, 0.1); setTimeout(() => { try { s.src.stop(); } catch (e) { } }, 600); }
}
$('btnSpecial').onclick = () => {
  if (mode !== 'nav') return;
  if (carSkin === 'car_police') {
    if (sirenOn) { sirenStop(); return; }
    sirenOn = true; $('btnSpecial').classList.add('on'); sirenStart();
    say('Внимание, полиция едет!');
  } else if (carSkin === 'car_race' || carSkin === 'car_tesla') {
    const now = performance.now(); if (now < boostReady) return;
    boostUntil = now + BOOST_MS; boostReady = now + BOOST_MS + BOOST_CD; playOnce('nitro', 'snd/nitro.mp3', 0.9);
  } else if (carSkin === 'car_robot') {
    robotGlowUntil = performance.now() + 3500;
    say(kidName ? `Я робот-защитник! Защищаю ${kidName}!` : 'Я робот-защитник!', true, ['k02']);
  } else if (carSkin === 'car_cat') {
    meowUntil = performance.now() + 1800; playOnce('meow', 'snd/meow.mp3', 1);
  } else playOnce('horn_' + carSkin, HORNS[carSkin] || HORNS.car_top, 0.8);
};
$('fixWarn').onclick = () => { if (mode !== 'idle') return; const g = POIS.find(p => p.key === 'service'); if (g) startPreview(g); };
$('fuelWarn').onclick = () => { if (mode !== 'idle') return; const g = nearestGas(); if (g) startPreview(g); };
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
  movePeople(dt);
  updateBus(dt);
  updateCaravan(dt);
  drawFuel(dt);
  hazardTick();
  turnAutoOff();
  updateBreak(dt);
  updateCamera(dt);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  winter = winterNow();
  ctx.fillStyle = wc(GRASS); ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H * cam.fy); ctx.rotate(cam.rot); ctx.scale(cam.scale, cam.scale); ctx.translate(-cam.x, -cam.y);
  const c0 = s2w(0, 0), c1 = s2w(W, 0), c2 = s2w(0, H), c3 = s2w(W, H);
  const view = [Math.min(c0[0], c1[0], c2[0], c3[0]), Math.min(c0[1], c1[1], c2[1], c3[1]), Math.max(c0[0], c1[0], c2[0], c3[0]), Math.max(c0[1], c1[1], c2[1], c3[1])];
  drawGround(view);
  drawRoads(view);
  drawDrifts(view);
  drawGroundLots();
  drawTrain(dt);
  drawBoats(dt);
  drawRoute();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  night += (nightTarget() - night) * Math.min(1, dt * 0.8);
  drawNightOverlay();
  drawStreetLights();
  drawBillboards();
  drawPin(t);
  drawHeadlights();
  drawBus();
  drawCaravan();
  drawCar(t);
  drawPlane(dt);
  drawSanta(dt);
  drawWeather(dt);
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
  buildLamps();
  placeTower();
  buildPeople();
  buildBus();
  buildWinterDecor();
  night = nightTarget();
  const home = POIS.find(p => p.key === 'home');
  car.node = home.node; car.x = nodes[home.node].x; car.y = nodes[home.node].y + RT.street.lane; car.h = Math.PI;
  cam.x = tgt.x = car.x; cam.y = tgt.y = car.y; cam.scale = tgt.scale = baseScale();
  buildDests();
  buildGarage();
  ui();
  requestAnimationFrame(frame);
  window.__nav = { setGarland(p) { garlandShift = p ? 60 - (performance.now() / 1000) % 120 + 1 : -(performance.now() / 1000) % 120 + 1; }, startCaravan: w => startCaravan(w), get caravan() { return caravan; }, startSanta: () => startSanta(), get santa() { return santa; }, setTurn: v => setTurn(v), get decor() { return decor; }, setHazard(v) { hazard = v; document.getElementById('btnHazard').classList.toggle('on', v); }, clip, VOICE_TEXT, tgt, get bus() { return BUS; }, people, get plane() { return plane; }, setPlane(p) { plane = p; }, POIS, decor, startPreview, startNav, nodes, edges, get trip() { return trip; }, get mode() { return mode; }, cam, car };
}
boot();
