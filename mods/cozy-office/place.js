// Where everything in the office goes. Pure functions: the mod draws the result with image(),
// tools/bake/compose.mjs draws the same result as one SVG for checking.
import S from "./scene-data.js";

/** Tile coordinates to world px (the room picture's top left is 0,0). */
export function world(c, i, z = 0) {
  const { cx, cy, ix, iy } = S.proj;
  return [c * cx + i * ix - S.room[0], c * cy + i * iy - z * S.T - S.room[1]];
}
/** How near the viewer a floor point is: larger is nearer. Drawables sort by it, back to front. */
export const depth = (c, i) => c * S.proj.dc + i * S.proj.di;
export const roomSize = () => [S.room[2] - S.room[0], S.room[3] - S.room[1]];
/** The room without its ground shadow, in world px. */
export const roomView = () => [S.view[0] - S.room[0], S.view[1] - S.room[1], S.view[2] - S.room[0], S.view[3] - S.room[1]];
/** Every place a person can stand or sit with the head and bubble over it, in world px: what an
 *  overview frames. */
export const keepView = () => [S.keep[0] - S.room[0], S.keep[1] - S.room[1], S.keep[2] - S.room[0], S.keep[3] - S.room[1]];

export function lookIndex(id) {
  let h = 2166136261;
  for (const ch of String(id)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % S.looks;
}

function spriteAt(name, c, i, z, key, extra = {}) {
  const bb = S.sprites[name], [x, y] = world(c, i, z);
  return { kind: "sprite", name, x: x + bb[0], y: y + bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1], key, ...extra };
}
function fxAt(name, x, y, key, extra = {}) {
  const bb = S.fx[name];
  return { kind: "fx", name, x: x + bb[0], y: y + bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1], key, ...extra };
}
/** The shadow a standing person casts with their feet at [x, y] (world px): a walker's. */
export const shadowBox = ([x, y]) => fxAt("shadow", x, y, 0);
// A sign: the plate's anchor (x, y) and the foot of its post, both in world px.
function signAt(at, extra) {
  const [x, y] = world(at.c, at.i, at.z), [, foot] = world(at.c, at.i, at.z0);
  return { x, y, foot, ...extra };
}

const BUBBLE = { needs: "needs", approve: "ask", done: "done" };
const ON_CHAIR = new Set(["sit", "back", "cup"]);
const SPOT_KIND = { needs: "help", approve: "help", done: "stand", idle: "seat" };
const SPOT_KEY = /^(help|stand|seat):(\d+)$/;
const SEAT_POSE = (d) => (d.side === "far" ? "sit" : "back");

/**
 * sessions: [{ id, space, state: needs|approve|working|done|idle, topic, since }]
 * prev: the previous assign() result, so a session keeps its desk and spot.
 * Returns drawables sorted back to front, people by id, the two zone signs, the hidden count, the
 * world box an overview frames and the assignment it made.
 */
export function layout(sessions, prev) {
  const out = [], people = {};
  const seats = assign(sessions, {
    desks: S.desks, help: S.help.spots.length, stand: S.lounge.stand.length, seats: S.lounge.seats.length,
  }, prev);
  const deskOf = (id) => {
    const n = seats.desk[id];
    return Number.isInteger(n) && n >= 0 && n < S.desks.length ? S.desks[n] : null;
  };
  const spotOf = (s, kind) => {
    const m = typeof seats.spot[s.id] === "string" ? SPOT_KEY.exec(seats.spot[s.id]) : null;
    return m && m[1] === kind ? Number(m[2]) : -1;
  };

  const person = (s, pose, c, i, z, key, o = {}) => {
    const [fx, fy] = world(c, i, z), bb = S.people;
    out.push({ kind: "person", id: s.id, look: lookIndex(s.id), pose, x: fx + bb[0], y: fy + bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1], key, feet: [fx, fy] });
    const head = [fx, fy - (pose === "cup" ? S.head.seat : S.head.stand)];
    // `say` is where a bubble's tail ends, over the head: the glyph bubble's origin here, and the
    // office's speech bubbles' tail tip (office-view.js).
    const say = [head[0] + 2, head[1] - (S.head.top - S.head.stand) - 3];
    people[s.id] = { id: s.id, feet: [fx, fy], head, say, state: s.state, pose };
    // The halo lies on the floor, the shadow falls across it.
    if (o.halo) out.push(fxAt("halo", fx, fy, key - 0.002, { id: s.id }));
    if (o.shadow ?? !ON_CHAIR.has(pose)) out.push(fxAt("shadow", fx, fy, key - 0.001, { id: s.id }));
    const bubble = BUBBLE[s.state];
    if (bubble) out.push(fxAt(`bubble-${bubble}`, say[0], say[1], 1000, { id: s.id }));
  };

  // An island keeps its desks and chairs; one with nobody at a desk is drawn grey.
  const occupied = new Set();
  for (const s of sessions) {
    const d = deskOf(s.id);
    if (d) occupied.add(d.island);
  }
  S.islands.forEach((is, n) => out.push(spriteAt(occupied.has(n) ? `island-${n}` : "island-idle", is.c, is.i, 0, depth(is.c + S.IW / 2, is.i + S.ID / 2))));
  for (const d of S.desks) {
    if (d.side === "far") { out.push(spriteAt("chair-far", d.c, d.i, 0, depth(d.c, d.i) - 0.05)); continue; }
    // The near chair's back is in front of whoever sits in it.
    out.push(spriteAt("chair-seat", d.c, d.i, 0, depth(d.c, d.i) - 0.05));
    out.push(spriteAt("chair-back-near", d.c, d.i, 0, depth(d.c, d.i + 0.3)));
  }

  for (const s of sessions) {
    const d = deskOf(s.id);
    if (s.state === "working") {
      if (!d) continue;
      person(s, SEAT_POSE(d), d.c, d.i, 0, depth(d.c, d.i));
      if (d.side === "near") {
        const is = S.islands[d.island];
        out.push(spriteAt("screen-on", is.c + d.sc, is.i, 0, depth(is.c + S.IW / 2, is.i + S.ID / 2) + 0.01));
      }
      continue;
    }
    if (s.state === "needs" || s.state === "approve") {
      const k = spotOf(s, "help");
      if (k >= 0 && k < S.help.spots.length) {
        const sp = S.help.spots[k];
        person(s, "wave", sp.c, sp.i, 0, depth(sp.c, sp.i), { halo: s.state === "needs" });
      } else if (d) {
        // Standing at an occupied desk, the furniture hides the feet: no halo and no shadow.
        person(s, "wave", d.c, d.i, 0, depth(d.c, d.i), { shadow: false });
      }
      continue;
    }
    if (s.state === "done") {
      const k = spotOf(s, "stand");
      if (k >= 0 && k < S.lounge.stand.length) {
        const sp = S.lounge.stand[k];
        person(s, "cheer", sp.c, sp.i, 0, depth(sp.c, sp.i));
      } else if (d) person(s, SEAT_POSE(d), d.c, d.i, 0, depth(d.c, d.i));
      continue;
    }
    if (s.state === "idle") {
      const k = spotOf(s, "seat");
      if (k >= 0 && k < S.lounge.seats.length) {
        const sp = S.lounge.seats[k];
        person(s, "cup", sp.c, sp.i, sp.z ?? 0, sp.key ?? depth(sp.c, sp.i));
      } else if (d) person(s, "cup", d.c, d.i, 0.45, depth(d.c, d.i));
    }
  }

  for (const d of S.decor) out.push(spriteAt(d.s, d.c, d.i, d.z, d.key));
  out.sort((a, b) => a.key - b.key);
  const [rw, rh] = roomSize();
  out.unshift({ kind: "room", name: "room", x: 0, y: 0, w: rw, h: rh, key: -1e9 });
  const signs = [
    signAt(S.help.sign, { label: "Help desk", zone: true }),
    signAt(S.lounge.sign, { label: "Lounge", zone: true }),
  ];
  return { drawables: out, people, signs, hidden: seats.hidden.length, bounds: roomView(), seats };
}

/** Who a small view should look at: the first person who needs you, then one waiting for approval. */
export function attention(people) {
  const list = Object.values(people);
  return list.find((p) => p.state === "needs") ?? list.find((p) => p.state === "approve") ?? null;
}

/** Sign plates for a view at `k` screen px per world px: the `text` to show, font size, plate
 *  width and height, the slide `dx` of the plate's centre from its post and the post length, all
 *  in screen px, each with its index `n` in `signs`. Each plate keeps inside `cam` (the camera's
 *  world rectangle) by sliding `dx` away from its post; one whose post would then miss its flat
 *  underside is dropped. */
export function signPlates(signs, k, cam = null) {
  const fs = Math.max(9, Math.min(13, Math.round(8 + 2.6 * k))), h = fs + 6;
  const cw = fs * 0.6, pad = fs * 1.5;
  const out = signs.map((g, n) => {
    const text = String(g.label ?? ""), w = text.length * cw + pad;
    return { ...g, n, text, fs, h, w, dx: Math.max(0, w / 2 - 48 * k), post: Math.max(0, (g.foot - g.y) * k) };
  });
  out.sort((a, b) => a.n - b.n);
  return out.filter((g) => {
    if (!cam) return true;
    const m = 4, px = (g.x - cam.x) * k, y = (g.y - cam.y) * k - g.h;
    const cx = Math.max(m + g.w / 2, Math.min(cam.w * k - m - g.w / 2, px + g.dx));
    g.dx = cx - px;
    return Math.abs(g.dx) <= g.w / 2 - g.h / 2 && y >= m && y + g.h <= cam.h * k - m;
  });
}

/** The screen band the view's own chips keep at the top, in px. */
export const TOP_INSET = 52;

const FOCUS_W = 660;
/**
 * Camera rectangle in world px for a view of `vw` × `vh` screen px.
 * focus: a person from layout().people to frame. Else the overview, which never moves with the
 * sessions: it shows the room's whole width and fits what keepView() holds into the band the top
 * chips leave free, so a wide view crops the room's far and near corners instead of shrinking it.
 * bounds: the room, which the camera does not leave while it is smaller than the room.
 * o.inset: the px the view keeps free at the top for its own chips (TOP_INSET by default).
 * o.at: the fraction of the view's width the framed head sits at (0.36 by default): a narrow view
 *  moves the head left so that the memo card drawn right of it still fits.
 */
export function camera(vw, vh, focus, bounds, o = {}) {
  const aspect = vh / vw;
  if (focus) {
    const w = FOCUS_W, h = w * aspect, at = Number.isFinite(o.at) ? o.at : 0.36;
    return { x: focus.head[0] - w * at, y: focus.head[1] + 14 - h * 0.5, w, h };
  }
  const b = bounds && Number.isFinite(bounds[0]) ? bounds : roomView();
  const keep = keepView(), pad = 8;
  const clamp = (v, lo, hi) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  const inset = Number.isFinite(o.inset) ? o.inset : TOP_INSET;
  const band = Math.max(1, vh - inset);
  // as wide as the room, and wide enough that the keep box fits the band under the chips
  let w = Math.max(b[2] - b[0], keep[2] - keep[0]) + pad * 2;
  w = Math.max(w, ((keep[3] - keep[1]) + pad * 2) * vw / band);
  const h = w * aspect;
  const k = vw / w;
  // the keep box centred in the band, a room that fits on screen centred whole, and never a keep
  // box that leaves the band
  let y = (keep[1] + keep[3]) / 2 - (inset + band / 2) / k;
  if (h >= b[3] - b[1] + pad * 2) y = (b[1] + b[3]) / 2 - h / 2;
  if (keep[1] < y + inset / k) y = keep[1] - inset / k;
  else if (keep[3] > y + vh / k) y = keep[3] - vh / k;
  return {
    x: clamp((keep[0] + keep[2]) / 2 - w / 2, b[0] - pad, b[2] + pad - w),
    y,
    w, h,
  };
}

const SPOT_LIMIT = { help: "help", stand: "stand", seat: "seats" };
const countOf = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);

/**
 * Sticky places for one scan: a session keeps its desk for life, and its state picks a spot.
 * sessions: [{ id, space, state }] in input order; scene: { desks: [{ island }], help, stand,
 * seats } with desks listed island by island; prev: an earlier result, or a partial one.
 * Pure: it reads no module state and changes no argument.
 * Returns { desk: { [id]: n }, spot: { [id]: "help:k" | "stand:k" | "seat:k" }, hidden: [id] }.
 * The desk map also holds the desks of sessions missing this scan, so one that flickers out
 * gets its desk back; those entries are only given away when no desk is free any more.
 */
export function assign(sessions, scene, prev) {
  const list = Array.isArray(sessions) ? sessions : [];
  const desks = Array.isArray(scene?.desks) ? scene.desks : [];
  const islands = desks.map((d, n) => (Number.isFinite(d?.island) ? d.island : n));
  const deskCount = desks.length;
  const prevDesk = prev?.desk && typeof prev.desk === "object" ? prev.desk : {};
  const prevSpot = prev?.spot && typeof prev.spot === "object" ? prev.spot : {};

  const order = [], present = new Set();
  for (const s of list) {
    if (!s || s.id === undefined || s.id === null) continue;
    const id = String(s.id);
    if (present.has(id)) continue;
    present.add(id); order.push(s);
  }

  const desk = {}, held = new Map(), reserved = new Map(), waiting = [];
  for (const s of order) {
    const n = prevDesk[s.id];
    if (Number.isInteger(n) && n >= 0 && n < deskCount && !held.has(n)) { desk[s.id] = n; held.set(n, s); }
    else waiting.push(s);
  }
  for (const id of Object.keys(prevDesk)) {
    if (present.has(id)) continue;
    const n = prevDesk[id];
    if (!Number.isInteger(n) || n < 0 || n >= deskCount || held.has(n) || reserved.has(n)) continue;
    desk[id] = n; reserved.set(n, id);
  }

  // Lowest island first, then lowest desk; `null` when no candidate passes.
  const lowestOn = (cands, pred) => {
    let best = null;
    for (const n of cands) {
      if (!pred(n)) continue;
      if (best === null || islands[n] < islands[best] || (islands[n] === islands[best] && n < best)) best = n;
    }
    return best;
  };
  // The island a present session of the same space sits on, then an island nobody sits on,
  // then any desk; a reserved desk carries no island claim of its own.
  const chooseDesk = (cands, s) => {
    const same = new Set(), used = new Set();
    for (const [n, o] of held) {
      used.add(islands[n]);
      if (o.space === s.space) same.add(islands[n]);
    }
    return lowestOn(cands, (n) => same.has(islands[n]))
      ?? lowestOn(cands, (n) => !used.has(islands[n]))
      ?? cands.reduce((a, n) => (a === null || n < a ? n : a), null);
  };

  for (const s of waiting) {
    const free = [];
    for (let n = 0; n < deskCount; n++) if (!held.has(n) && !reserved.has(n)) free.push(n);
    let n = chooseDesk(free, s), gone = null;
    if (n === null) {
      n = chooseDesk([...reserved.keys()], s);
      if (n !== null) gone = reserved.get(n);
    }
    if (n === null) continue;
    if (gone !== null) { delete desk[gone]; reserved.delete(n); }
    desk[s.id] = n; held.set(n, s);
  }

  const spot = {}, groups = { help: [], stand: [], seat: [] };
  for (const s of order) { const kind = SPOT_KIND[s.state]; if (kind) groups[kind].push(s); }
  for (const kind of ["help", "stand", "seat"]) {
    const limit = countOf(scene?.[SPOT_LIMIT[kind]]);
    const used = new Set(), left = [];
    for (const s of groups[kind]) {
      const m = typeof prevSpot[s.id] === "string" ? SPOT_KEY.exec(prevSpot[s.id]) : null;
      const k = m && m[1] === kind ? Number(m[2]) : NaN;
      if (Number.isInteger(k) && k >= 0 && k < limit && !used.has(k)) { spot[s.id] = `${kind}:${k}`; used.add(k); }
      else left.push(s);
    }
    for (const s of left) {
      let k = 0;
      while (k < limit && used.has(k)) k++;
      if (k < limit) { spot[s.id] = `${kind}:${k}`; used.add(k); }
    }
  }

  // own keys only: a session id such as "constructor" must not count as holding a place
  const owns = (map, id) => Object.prototype.hasOwnProperty.call(map, String(id));
  const hidden = order.filter((s) => !owns(desk, s.id) && !owns(spot, s.id)).map((s) => s.id);
  return { desk, spot, hidden };
}
