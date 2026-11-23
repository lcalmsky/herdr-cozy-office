// The person's own look at the office: a zoom and a centre laid over the camera place.js picks.
// No look (null) is place.js's camera untouched, so the office reads as it always has until a pinch,
// a ⌘ + scroll or a drag changes it. Pure: nothing here reads Herdr or module state.
//
// look: { z, c: [x, y] }, z the zoom against the base camera's width (1 is the base, more is closer)
// and c the world point at the centre of the view. The view never leaves the room (padded, and
// grown to hold the base camera, whose overview may sit a little past the room's top or bottom).

export const LOOK = {
  minW: 320, // the narrowest view, in world px: about one island of desks
  step: 1.25, // one zoom_in / zoom_out
  pan: 0.2, // one pan_<dir>, as a share of the view
  wheel: 0.01, // ⌘ + scroll: zoom factor e^(delta.y × wheel)
  most: 2, // no single pinch or wheel event zooms by more than this, or its inverse
  pad: 8,
  drag: 3, // screen px a press moves before it counts as a drag, not a click
  live: 400, // ms after a pinch, a wheel or a drag step during which the scene follows without easing
};

function bounds(base, room) {
  const p = LOOK.pad;
  const r = room && room.every?.(Number.isFinite) ? room : [base.x, base.y, base.x + base.w, base.y + base.h];
  return [Math.min(r[0] - p, base.x), Math.min(r[1] - p, base.y), Math.max(r[2] + p, base.x + base.w), Math.max(r[3] + p, base.y + base.h)];
}

/** The zoom range for this base camera: down to the whole room in view, up to LOOK.minW world px wide. */
export function zoomRange(base, room) {
  const R = bounds(base, room), aspect = base.h / base.w;
  const fit = Math.max(R[2] - R[0], (R[3] - R[1]) / aspect);
  return { lo: Math.min(1, base.w / fit), hi: Math.max(1, base.w / LOOK.minW) };
}

const clamp = (v, lo, hi) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

/** The camera a look gives, in world px: base's aspect, w = base.w / z, kept inside the room. */
export function lookCamera(base, look, room) {
  if (!look) return base;
  const { lo, hi } = zoomRange(base, room);
  const z = clamp(Number(look.z) || 1, lo, hi);
  const R = bounds(base, room);
  const w = base.w / z, h = base.h / z;
  const cx = Number(look.c?.[0]), cy = Number(look.c?.[1]);
  const x = clamp((Number.isFinite(cx) ? cx : base.x + base.w / 2) - w / 2, R[0], R[2] - w);
  const y = clamp((Number.isFinite(cy) ? cy : base.y + base.h / 2) - h / 2, R[1], R[3] - h);
  return { x, y, w, h };
}

/** The look that shows `cam` (any camera of base's aspect): how a focus frame or the base becomes a look. */
export function lookOf(cam, base) {
  return { z: base.w / cam.w, c: [cam.x + cam.w / 2, cam.y + cam.h / 2] };
}

// A look settled against its camera, so a centre pushed past the room does not keep running on.
function settle(base, look, room) {
  return lookOf(lookCamera(base, look, room), base);
}

/**
 * Zooms by `factor` keeping the world point under screen point `at` ([x, y] in px of a W × H
 * view) where it is; no `at` zooms about the view's centre. Starts from `from`, the camera shown
 * now (a focus frame, say), when there is no look yet.
 */
export function zoomAt(look, base, room, W, H, factor, at = null, from = null) {
  const f = Number(factor);
  if (!(f > 0) || !Number.isFinite(f)) return look;
  const cur = look ? lookCamera(base, look, room) : from ?? base;
  const { lo, hi } = zoomRange(base, room);
  const z = clamp((base.w / cur.w) * f, lo, hi);
  const [px, py] = at && Number.isFinite(at[0]) && Number.isFinite(at[1]) ? at : [W / 2, H / 2];
  const wx = cur.x + (px / W) * cur.w, wy = cur.y + (py / H) * cur.h;
  const w = base.w / z, h = base.h / z;
  return settle(base, { z, c: [wx - (px / W) * w + w / 2, wy - (py / H) * h + h / 2] }, room);
}

/** Moves the view by a drag of dx, dy screen px of a W px wide view: the room follows the pointer. */
export function panBy(look, base, room, W, dx, dy, from = null) {
  const cur = look ? lookCamera(base, look, room) : from ?? base;
  const k = W / cur.w;
  const start = look ?? lookOf(cur, base);
  return settle(base, { z: base.w / cur.w, c: [start.c[0] - dx / k, start.c[1] - dy / k] }, room);
}

const PAN = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
/** One pan_<dir> command: the view goes LOOK.pan of its size toward `dir` (the room slides the other way). */
export function panStep(look, base, room, dir, from = null) {
  const d = PAN[dir];
  if (!d) return look;
  const cur = look ? lookCamera(base, look, room) : from ?? base;
  const start = look ?? lookOf(cur, base);
  return settle(base, { z: base.w / cur.w, c: [start.c[0] + d[0] * cur.w * LOOK.pan, start.c[1] + d[1] * cur.h * LOOK.pan] }, room);
}

const cap = (f) => Math.max(1 / LOOK.most, Math.min(LOOK.most, f));

/** A pinch step's zoom factor (delta 0.1 is 10% larger), or null when the event carries none. */
export function pinchFactor(event) {
  const d = Number(event?.delta);
  if (!Number.isFinite(d) || d === 0 || 1 + d <= 0) return null;
  return cap(1 + d);
}

/** ⌘ + scroll's zoom factor (scrolling up zooms in), or null: without ⌘ the wheel is not a zoom. */
export function wheelFactor(event) {
  if (!event?.modifiers?.platform) return null;
  const d = Number(event?.delta?.y);
  if (!Number.isFinite(d) || d === 0) return null;
  return cap(Math.exp(d * LOOK.wheel));
}
