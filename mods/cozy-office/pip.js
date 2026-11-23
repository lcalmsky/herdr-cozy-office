// The PiP window's place, size and keyboard hand-off. The PiP is a window overlay (openOverlay
// with kind "window") that stays where it was put; the office and the strip's copy open it when it
// is off, and its own copy keeps it inside the terminal area and moves it by opening a new window
// at the new place and closing the old (Herdr has no command that moves an open window).
import { shared, setShared } from "herdr";

export const PIP_SIZE = { w: 360, h: 196, minW: 240, minH: 132, maxW: 800, maxH: 450, step: 1.25 };
// The window's frame around the scene and the gap the PiP keeps from the terminal area's edges,
// both in the layout's logical px.
export const PIP_EDGE = 6;
export const PIP_MARGIN = 8;
// A window copy beats on every tick; one that has not beaten for this long is gone (its overlay
// closed, or the app restarted). Opening counts too, so two copies cannot open the same window twice.
export const PIP_ALIVE_MS = 1500;
// After the pointer stops on the window and after the app window changes size, the PiP waits this
// long before it writes the place it was dragged to or moves itself back inside.
export const PIP_SETTLE_MS = 300;

const PLACE_KEY = "cozy-office.pip-place";
const SIZE_KEY = "cozy-office.pip-size";
const KEYS_KEY = "cozy-office.pip-keys";
// A demo copy keeps its PiP under its own keys, like cozy-office.pip.demo.
const keyOf = (base, demo) => (demo ? `${base}.demo` : base);
export const pipKeys = (demo = false) => ({ place: keyOf(PLACE_KEY, demo), size: keyOf(SIZE_KEY, demo), keys: keyOf(KEYS_KEY, demo) });

const num = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
const zoomOf = (zoom) => (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
const sideOf = (value) => (Number.isFinite(value) && value > 0 ? value : null);

/** The place the PiP was put at (the home), in window px: { x, y, gen, vw, vh } where vw·vh are the
 *  app window's size when x·y were set, or null when nothing valid is kept. */
export function pipPlace(demo = false) {
  const place = shared(keyOf(PLACE_KEY, demo));
  if (!place || !Number.isFinite(place.x) || !Number.isFinite(place.y)) return null;
  const gen = place.gen;
  return {
    x: place.x, y: place.y, gen: Number.isInteger(gen) && gen >= 0 ? gen : 0,
    vw: sideOf(place.vw), vh: sideOf(place.vh),
  };
}

export function setPipPlace(place, demo = false) {
  const next = {
    x: Math.round(place.x), y: Math.round(place.y), gen: place.gen,
    vw: Number.isFinite(place.vw) && place.vw > 0 ? Math.round(place.vw) : null,
    vh: Number.isFinite(place.vh) && place.vh > 0 ? Math.round(place.vh) : null,
  };
  const cur = pipPlace(demo);
  if (cur && cur.x === next.x && cur.y === next.y && cur.gen === next.gen && cur.vw === next.vw && cur.vh === next.vh) return;
  setShared(keyOf(PLACE_KEY, demo), next);
}

/** The overlay key of the window at generation `gen`: a move opens a new one, so each is its own. */
export function pipWindowKey(gen, demo = false) {
  return demo ? `cozy-pip-demo-${gen}` : `cozy-pip-${gen}`;
}

/** The app window as a box: { x: 0, y: 0, w, h } in window px, or null when its size is unknown. */
export function windowBox(viewport) {
  const width = viewport?.width, height = viewport?.height;
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
  return { x: 0, y: 0, w: width, h: height };
}

function findNode(node, id) {
  if (!node || typeof node !== "object") return null;
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

/** The part of the app window the PiP may use: the terminal block's row, in window px. The layout
 *  tree gives the rail's width, the block's padding and the strip's height; `zoom` multiplies the
 *  logical px to window px. */
export function pipArea(viewport, tree, zoom = 1) {
  const win = windowBox(viewport);
  if (!win) return null;
  const z = zoomOf(zoom);
  const work = findNode(tree, "work");
  let x, y, w, h;
  if (work) {
    const pad = work.padding;
    const [padV, padH] = Array.isArray(pad) ? [num(pad[0], 8), num(pad[1], 8)] : [num(pad, 8), num(pad, 8)];
    const gap = num(work.gap, 8);
    const rail = findNode(tree, "rail");
    const railW = rail && !rail.hidden ? num(rail.size?.px, 0) : 0;
    const strip = findNode(tree, "office-strip");
    const stripH = strip ? num(strip.size?.px, 0) : 0;
    const left = railW + padH + PIP_MARGIN;
    const top = padV + (stripH > 0 ? stripH + gap : 0) + PIP_MARGIN;
    const rightInset = padH + PIP_MARGIN;
    const bottomInset = padV + PIP_MARGIN;
    x = left * z;
    y = top * z;
    w = win.w - (left + rightInset) * z;
    h = win.h - (top + bottomInset) * z;
  } else {
    x = PIP_MARGIN * z;
    y = PIP_MARGIN * z;
    w = win.w - 2 * PIP_MARGIN * z;
    h = win.h - 2 * PIP_MARGIN * z;
  }
  // A window too small for the PiP's own least size gets the whole app window instead.
  if (w < PIP_SIZE.minW * z || h < PIP_SIZE.minH * z) return win;
  return { x, y, w, h };
}

/** The size the PiP draws at (logical px): never larger than its box, never under 1. The kept size
 *  itself is not changed. */
export function fitSize(size, box, zoom = 1) {
  if (!box) return size;
  const z = zoomOf(zoom);
  return {
    w: Math.max(1, Math.min(size.w, Math.floor(box.w / z))),
    h: Math.max(1, Math.min(size.h, Math.floor(box.h / z))),
  };
}

function clampAxis(value, min, max) {
  return max < min ? min : Math.max(min, Math.min(value, max));
}

/** `place` moved so a `size` (logical px) window sits wholly inside `box` (window px). */
export function clampPlace(place, size, box, zoom = 1) {
  if (!box) return { x: Math.round(place.x), y: Math.round(place.y) };
  const z = zoomOf(zoom);
  return {
    x: Math.round(clampAxis(place.x, box.x, box.x + box.w - size.w * z)),
    y: Math.round(clampAxis(place.y, box.y, box.y + box.h - size.h * z)),
  };
}

/** The default place: the area's bottom-right corner. */
export function defaultPlace(size, area, zoom = 1) {
  if (!area) return { x: 0, y: 0 };
  return clampPlace({ x: area.x + area.w, y: area.y + area.h }, size, area, zoom);
}

/** `place` snapped to one side of `area`; the other axis keeps its value. */
export function snapPlace(place, dir, size, area, zoom = 1) {
  if (!area) return { x: Math.round(place.x), y: Math.round(place.y) };
  const z = zoomOf(zoom);
  const next = { x: place.x, y: place.y };
  if (dir === "left") next.x = area.x;
  else if (dir === "right") next.x = Math.max(area.x, area.x + area.w - size.w * z);
  else if (dir === "up") next.y = area.y;
  else if (dir === "down") next.y = Math.max(area.y, area.y + area.h - size.h * z);
  return { x: Math.round(next.x), y: Math.round(next.y) };
}

/** Two places within a pixel on each axis: the pointer's own rounding is not a move. */
export function samePlace(a, b) {
  return Boolean(a && b) && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

/** `home` moved with the app window's size change: a home in the right (bottom) half of the window
 *  it was put in keeps its distance to that edge. The home itself is not changed. */
export function restPlace(home, viewport, size, zoom = 1) {
  if (!home) return null;
  const z = zoomOf(zoom);
  let x = home.x, y = home.y;
  const vw = sideOf(home.vw), vh = sideOf(home.vh);
  const width = viewport?.width, height = viewport?.height;
  if (vw !== null && vh !== null && Number.isFinite(width) && Number.isFinite(height)) {
    if (home.x + (size.w * z) / 2 > vw / 2) x = home.x + (width - vw);
    if (home.y + (size.h * z) / 2 > vh / 2) y = home.y + (height - vh);
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** The place the window actually opens at: `home` at the app window's size now, kept inside the
 *  part of it the PiP may use. `size` is the size it will draw at. */
export function showPlace(home, viewport, tree, size, zoom = 1) {
  const rest = restPlace(home, viewport, size, zoom);
  if (!rest) return null;
  const win = windowBox(viewport);
  const area = pipArea(viewport, tree, zoom);
  return clampPlace(rest, size, boxFor(rest, area, win), zoom);
}

/** The top-left that keeps the near edges while the size goes from `from` to `to` (logical px). */
export function anchoredResize(place, from, to, half, zoom = 1) {
  const z = zoomOf(zoom);
  const right = Boolean(half?.right), bottom = Boolean(half?.bottom);
  return {
    x: Math.round(right ? place.x + (from.w - to.w) * z : place.x),
    y: Math.round(bottom ? place.y + (from.h - to.h) * z : place.y),
  };
}

/** Which halves of the app window the window's centre sits in: { right, bottom }. Unknown without a
 *  viewport, so the window is held by its top-left then. */
export function halfOf(place, size, viewport, zoom = 1) {
  if (!place || !viewport) return { right: false, bottom: false };
  const z = zoomOf(zoom);
  return {
    right: place.x + (size.w * z) / 2 > viewport.width / 2,
    bottom: place.y + (size.h * z) / 2 > viewport.height / 2,
  };
}

/** The window's top-left in window px, from a press on its root: `position` is against the app
 *  window and `local_position` against the element. Null when either is missing or not a number. */
export function originOf(event) {
  const p = event?.position, l = event?.local_position;
  if (!p || !l) return null;
  if (![p.x, p.y, l.x, l.y].every((value) => Number.isFinite(value))) return null;
  return { x: p.x - l.x, y: p.y - l.y };
}

/** True when `place` starts inside `box` on its left and top edges. */
export function inside(place, box) {
  return Boolean(place && box) && place.x >= box.x - 1 && place.y >= box.y - 1;
}

/** The box a window at `place` keeps to: the terminal area while it starts inside it, else the app
 *  window (a window dragged over the rail or the band may be pushed back into the window). */
export function boxFor(place, area, win) {
  if (!area) return win;
  return inside(place, area) ? area : win;
}

/** The canvas a corner's drag paints on, in window px: the window as it is, grown to the side the
 *  corner drags towards so the pointer stays over the canvas while the window grows. The canvas
 *  always holds the window; with no box it is the window itself. */
export function dragCanvas(rect, corner, box) {
  const left = corner === "tl" || corner === "bl";
  const top = corner === "tl" || corner === "tr";
  const x = left ? Math.min(box ? box.x : rect.x, rect.x) : rect.x;
  const y = top ? Math.min(box ? box.y : rect.y, rect.y) : rect.y;
  const right = left ? rect.x + rect.w : Math.max(box ? box.x + box.w : rect.x + rect.w, rect.x + rect.w);
  const bottom = top ? rect.y + rect.h : Math.max(box ? box.y + box.h : rect.y + rect.h, rect.y + rect.h);
  return { x, y, w: right - x, h: bottom - y };
}

/** The window's rect while a corner is dragged to `pointer`: the opposite corner of `drag` stays
 *  put, and the size (logical px) is the distance from it to the pointer's corner, kept within the
 *  least and largest sizes and inside the canvas. `x`·`y` come back in window px, `w`·`h` in
 *  logical px — the same units `drag.rect` holds. */
export function cornerRect(drag, pointer, zoom = 1) {
  const z = zoomOf(zoom);
  const left = drag.corner === "tl" || drag.corner === "bl";
  const top = drag.corner === "tl" || drag.corner === "tr";
  const px = pointer.x - drag.grab.x;
  const py = pointer.y - drag.grab.y;
  const anchor = drag.anchor, canvas = drag.canvas;
  const roomW = (left ? anchor.x - canvas.x : canvas.x + canvas.w - anchor.x) / z;
  const roomH = (top ? anchor.y - canvas.y : canvas.y + canvas.h - anchor.y) / z;
  const fit = clampSize({ w: (left ? anchor.x - px : px - anchor.x) / z, h: (top ? anchor.y - py : py - anchor.y) / z });
  const w = Math.max(1, Math.min(fit.w, Math.floor(roomW)));
  const h = Math.max(1, Math.min(fit.h, Math.floor(roomH)));
  return {
    x: Math.round(left ? anchor.x - w * z : anchor.x),
    y: Math.round(top ? anchor.y - h * z : anchor.y),
    w, h,
  };
}

export function clampSize(size) {
  const w = Math.round(Number(size?.w));
  const h = Math.round(Number(size?.h));
  if (!Number.isFinite(w) || !Number.isFinite(h)) return { w: PIP_SIZE.w, h: PIP_SIZE.h };
  return {
    w: Math.min(PIP_SIZE.maxW, Math.max(PIP_SIZE.minW, w)),
    h: Math.min(PIP_SIZE.maxH, Math.max(PIP_SIZE.minH, h)),
  };
}

export function pipSize(demo = false) {
  const size = shared(keyOf(SIZE_KEY, demo));
  return size && typeof size === "object" ? clampSize(size) : { w: PIP_SIZE.w, h: PIP_SIZE.h };
}

export function setPipSize(size, demo = false) {
  setShared(keyOf(SIZE_KEY, demo), clampSize(size));
}

/** One −/= press: shrink (-1), grow (+1) by `step` keeping the shape, or reset (0). */
export function stepSize(size, dir) {
  if (dir === 0) return { w: PIP_SIZE.w, h: PIP_SIZE.h };
  const f = dir > 0 ? PIP_SIZE.step : 1 / PIP_SIZE.step;
  const next = clampSize({ w: size.w * f, h: size.h * f });
  // A side that hits its bound stops the other one too, so the shape stays.
  const fw = next.w / size.w, fh = next.h / size.h;
  const r = dir > 0 ? Math.min(fw, fh) : Math.max(fw, fh);
  return clampSize({ w: size.w * r, h: size.h * r });
}

// Whether a window is alive is the module's memory, not shared(): only this copy's ticks and opens
// say so, and a demo window never keeps the window in use from opening.
const WINDOWS = { live: { beat: 0, opened: 0 }, demo: { beat: 0, opened: 0 } };
const windowOf = (demo) => WINDOWS[demo ? "demo" : "live"];

/** A window copy says it is alive; its tick calls this every time. */
export function pipBeat(demo = false, now = Date.now()) {
  windowOf(demo).beat = now;
}

export function markPipOpened(demo = false, now = Date.now()) {
  windowOf(demo).opened = now;
}

/** True while a window copy is beating or has just been opened: another must not open one too. */
export function pipWindowLive(demo = false, now = Date.now()) {
  const win = windowOf(demo);
  return now - win.beat < PIP_ALIVE_MS || now - win.opened < PIP_ALIVE_MS;
}

export function resetPipWindows() {
  for (const win of Object.values(WINDOWS)) { win.beat = 0; win.opened = 0; }
}

/** A window copy that closed itself says so, so PiP switched back on at once opens a window without
 *  waiting out PIP_ALIVE_MS for the closed copy's memory to lapse. */
export function pipGone(demo = false) {
  const win = windowOf(demo);
  win.beat = 0;
  win.opened = 0;
}

// Keyboard hand-off between the office and the PiP window: the copy giving up the keyboard names
// who takes it ("office" or "pip") and the pane to give it back to; the taker focuses itself once
// it is drawn.
const HANDOFF_MS = 3000;
export function handKeys(to, demo = false, back = null, now = Date.now()) {
  setShared(keyOf(KEYS_KEY, demo), { to, back, at: now });
}

export function keysFor(me, demo = false, now = Date.now()) {
  const hand = shared(keyOf(KEYS_KEY, demo));
  return hand && typeof hand === "object" && hand.to === me && now - Number(hand.at) < HANDOFF_MS ? hand : null;
}

/** Takes a hand-off meant for `me` (once): returns it and clears it, or null. */
export function takeKeys(me, demo = false, now = Date.now()) {
  const hand = keysFor(me, demo, now);
  if (hand) setShared(keyOf(KEYS_KEY, demo), null);
  return hand;
}

// The look (zoom and centre, zoom.js) travels with the PiP: a copy that moves the window hands its
// look along, and the copy that opens at the new place takes it (once) when it starts.
const LOOK_KEY = "cozy-office.pip-look";
export function handLook(to, look, demo = false) {
  setShared(keyOf(LOOK_KEY, demo), { to, look: look ?? null });
}

/** Takes the look handed to `me`: { look } (look may be null, the default view), or null if none was. */
export function takeLook(me, demo = false) {
  const hand = shared(keyOf(LOOK_KEY, demo));
  if (!hand || typeof hand !== "object" || hand.to !== me) return null;
  setShared(keyOf(LOOK_KEY, demo), null);
  return { look: hand.look ?? null };
}
