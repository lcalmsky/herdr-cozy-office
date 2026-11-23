// The office scene: every session is a person in one isometric room. Placement is place.js's,
// pictures are tools/bake's; this file turns both into absolutely placed images under a camera.
import { div, image } from "gpui-kit";
import { agents, spaces, shared, setShared, theme, settings } from "herdr";
import { layout, camera, signPlates, shadowBox } from "./place.js";
import { LOOK, lookCamera, zoomAt, panBy, panStep, pinchFactor, wheelFactor } from "./zoom.js";

export const PIP_KEY = "cozy-office.pip";
const ART = "mods/cozy-office/art";
const FONT = "Nunito";
const MOVE = { duration: 450, easing: "ease-in-out" };
// While a pinch, a ⌘ + scroll or a drag is moving the view, the scene keeps up with the pointer.
const LIVE = 40;
// Walking, with nothing but .transition and .loop (Herdr runs both natively; no timer moves anyone).
// A person sent to a spot at least `still` world px away walks there in a straight line at `speed`
// world px per ms (min..max ms), standing with a bob of `bob` px every `step` ms. Their new pose,
// shadow, halo and bubble fade in over `fade` ms once they arrive: each person has two look slots,
// and a walk swaps them, the old slot showing the walker and fading out with a delay of the walk.
export const WALK = { speed: 0.22, min: 900, max: 4000, still: 40, fade: 160, step: 420, bob: 3 };

export function walkMs(from, to) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return Math.round(Math.min(WALK.max, Math.max(WALK.min, d / WALK.speed)));
}

/** One person's walk memory, kept on the view (never in shared(), so a demo copy cannot touch the
 *  window in use): { to: feet the person was last sent to, slot: the look slot now current, at, ms }.
 *  A spot `still` px or nearer (an overflowing person changing pose at their own desk) is no walk. */
export function stepWalk(rec, feet, now) {
  if (!rec) return { to: feet, slot: 0, at: -Infinity, ms: 0 };
  const d = Math.hypot(feet[0] - rec.to[0], feet[1] - rec.to[1]);
  if (d === 0) return rec;
  if (d < WALK.still) return { ...rec, to: feet };
  // Sent on again mid-walk, they keep walking in the walker's slot.
  const walking = now < rec.at + rec.ms;
  return { to: feet, slot: walking ? rec.slot : 1 - rec.slot, at: now, ms: walkMs(rec.to, feet) };
}
const STATE_HEX = { needs: "#E0603F", approve: "#D9805F", working: "#E5B54F", done: "#79A877", idle: "#A39A90" };
const STATE_WORD = { needs: "Needs you", approve: "Approve", working: "Working", done: "Done", idle: "Idle" };

// Speech bubbles. As on the chiikawa beach, everyone in the office says one line: the last thing
// their session said (sayLine). Needs you and Approve lead with their glyph and say the most, Done
// leads with its tick, Working says a shorter line and Idle says the shortest, faded. Someone with
// nothing to say shows only a glyph, or no bubble when there is none.
// Line lengths in em (sayText), sized for a sentence rather than a title: at 10 em a sentence kept
// only its first two words ("Tiles now…"), which tells a glance nothing.
export const SAY_LIMIT = { needs: 24, approve: 24, working: 16, done: 16, idle: 12 };
export const SAY_GLYPH = { needs: "say-needs", approve: "say-ask", done: "say-done" };
// Screen px: the tail is tailW x tailH with its tip on the person's `say` point and its left edge
// tailIn px into the bubble; a bubble keeps `edge` px inside the view and floats `bob` px up and
// down, never into the band; a crowded one fades to `faded`.
export const SAY = { tailW: 11, tailH: 7, tailIn: 9, edge: 4, faded: 0.55, bob: 2 };
const SAY_INK = { text: "#3B2E2A", idle: "#3B2E2A8C", needs: "#B5402F", approve: "#A85A3C" };

const WIDE = /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef\u2600-\u27bf\u{1f000}-\u{1faff}]/u;
const BROAD = /[A-Z0-9mwMW@%&#]/;
/** How wide a character is in em, an upper bound for Nunito: a full em for Hangul, other wide
 *  characters and emoji, 0.72 em for capitals, digits and the broad letters, 0.62 em for the rest. */
export function sayEm(ch) { return WIDE.test(ch) ? 1 : BROAD.test(ch) ? 0.72 : 0.62; }

/** One line of a bubble: at most `limit` em wide (so ten Hangul syllables or about sixteen Latin
 *  letters), cut at the last space in that window so a word is never split when there is a space to
 *  break on, and marked with an ellipsis. */
export function sayText(text, limit = 16) {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  const chars = [...line];
  let em = 0, fit = 0;
  for (const ch of chars) { if (em + sayEm(ch) > limit) break; em += sayEm(ch); fit++; }
  if (fit === chars.length) return line;
  const head = chars.slice(0, fit).join("");
  const space = head.lastIndexOf(" ");
  return `${(space > 0 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** The bubbles' font size at `k` screen px per world px: 11 px at the usual scale, 9 to 12. */
export function sayFont(k) { return Math.max(9, Math.min(12, Math.round(7 + 4 * k))); }

/** A bubble's size at font size fs: [w, h]. The width is an upper bound (sayEm), so a bubble kept
 *  inside the view by it is. */
export function saySize(text, fs, glyph) {
  let em = 0;
  for (const ch of String(text ?? "")) em += sayEm(ch);
  const pad = Math.round(fs * 0.75), mark = glyph ? Math.round(fs * 1.1) + (text ? Math.round(fs * 0.35) : 0) : 0;
  return [Math.ceil(em * fs) + 2 * pad + mark, Math.round(fs * 2)];
}

/**
 * Where the speech bubbles go, in screen px, and how they stack. list: [{ id, state, text, tip: [x, y] }]
 * with `tip` the person's `say` point on screen. A bubble sits over its tip with the tail tailIn px
 * in, slides left or right to keep inside the view and down to keep under the band (`top`), and is
 * left out when that would push it more than half its height down or the tip is off the view. Bubbles are drawn Working and Idle
 * first, then Done, then Needs you and Approve, the hovered person's last; as on the beach a bubble
 * fades where it is crowded, here when one drawn over it overlaps it, so the top one always reads.
 * Needs you's, Approve's and the hovered one never fade.
 * Returns [{ id, state, text, glyph, fs, x, y, w, h, tail, opacity }] in drawing order.
 */
export function sayBoxes(list, { W, H, k = 1, top = BAND, hovered = null } = {}) {
  const fs = sayFont(k);
  const boxes = [];
  for (const it of list) {
    const glyph = SAY_GLYPH[it.state] ?? null;
    const limit = SAY_LIMIT[it.state];
    const text = limit ? sayText(it.text, limit) : "";
    if (!text && !glyph) continue;
    const [tx, ty] = it.tip;
    const [w, h] = saySize(text, fs, glyph);
    // A head just under the band (a back-row seat on a short view) pushes its bubble down a little,
    // over the top of the head; one further up (zoomed in under the band) has no room and says nothing.
    const want = ty - SAY.tailH - h + 1, y = Math.max(want, top + SAY.bob);
    if (!(tx >= 0 && tx <= W && ty + 1 <= H && y - want <= h / 2)) continue;
    const x = Math.max(SAY.edge, Math.min(tx - SAY.tailIn - SAY.tailW / 2, W - w - SAY.edge));
    const tail = Math.max(h / 2, Math.min(tx - x - SAY.tailW / 2, w - h / 2 - SAY.tailW));
    boxes.push({ id: it.id, state: it.state, text, glyph, fs, x, y, w, h, tail, tx, lift: 0 });
  }
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const loud = (b) => b.state === "needs" || b.state === "approve";
  // Loud bubbles never fade, so two callers side by side would cover each other's line (a sentence
  // runs wide): the one on the left opens to the left of its tail instead, away from its neighbour.
  for (const b of boxes) {
    if (!loud(b) || !boxes.some((o) => o !== b && loud(o) && o.tx > b.tx && hit(b, o))) continue;
    b.x = Math.max(SAY.edge, Math.min(b.tx - b.w + b.h / 2 + SAY.tailW / 2, W - b.w - SAY.edge));
    b.tail = Math.max(b.h / 2, Math.min(b.tx - b.x - SAY.tailW / 2, b.w - b.h / 2 - SAY.tailW));
  }
  // With no room to open apart (two callers at the view's edge, a small PiP), the left one rises above
  // its neighbour on a longer stem, as long as it stays under the band; its tail still ends on the head.
  for (const b of boxes) {
    const o = loud(b) && boxes.find((o) => o !== b && loud(o) && o.tx > b.tx && hit(b, o));
    if (!o) continue;
    const y = o.y - b.h - 2;
    if (y < top + SAY.bob || y >= b.y) continue;
    b.lift = b.y - y;
    b.y = y;
  }
  const rank = (b) => (b.id === hovered ? 3 : loud(b) ? 2 : b.state === "done" ? 1 : 0);
  const order = boxes.map((b, n) => ({ b, n })).sort((a, z) => rank(a.b) - rank(z.b) || a.n - z.n).map(({ b }) => b);
  return order.map((b, n) => ({
    ...b, opacity: !loud(b) && b.id !== hovered && order.slice(n + 1).some((o) => hit(b, o)) ? SAY.faded : 1,
  }));
}

/** A speech bubble's inside: the glyph, the line, and the tail under it. */
function sayBubble(b) {
  const fs = b.fs, idle = b.state === "idle";
  const ink = idle ? SAY_INK.idle : SAY_INK[b.state] ?? SAY_INK.text;
  const bold = b.state === "needs" || b.state === "approve";
  let pill = div().absolute().left(0).top(0).w(b.w).h(b.h).flex().items_center().justify_center()
    .gap(Math.round(fs * 0.35)).px(Math.round(fs * 0.75)).rounded(b.h / 2).bg("#FFFFFF").shadow_sm();
  if (b.glyph) pill = pill.child(div().flex_none().w(Math.round(fs * 1.1)).h(Math.round(fs * 1.2)).child(imageOf(`${ART}/fx/${b.glyph}.svg`)));
  if (b.text) {
    pill = pill.child(div().whitespace_nowrap().text_size(fs).font_family(FONT).text_color(ink)
      .when(bold, (el) => el.font_bold()).when(!bold, (el) => el.font_semibold()).child(b.text));
  }
  const lift = b.lift ?? 0;
  return div().absolute().left(0).top(0).size_full()
    .when(lift > 0, (el) => el.child(div().absolute().left(b.tail + SAY.tailW / 2 - 1).top(b.h - 1).w(2).h(lift + 1).bg("#FFFFFF")))
    .child(div().absolute().left(b.tail).top(b.h - 1 + lift).w(SAY.tailW).h(SAY.tailH).opacity(idle ? 0.7 : 1)
      .child(imageOf(`${ART}/fx/say-tail.svg`)))
    .child(pill);
}

const TOKENS = {
  light: { stage: "#F3EADA", chip: "#FFF6E6F2", chipText: "#3B2E2A", chipMuted: "#8A7868", line: "#E3D2B8", memo: "#FFFBF4", sign: "#2B3350", signText: "#FFFFFF" },
  dark: { stage: "#1D2032", chip: "#262434F0", chipText: "#F1E8DA", chipMuted: "#A9A2B8", line: "#49445E", memo: "#2E2B3D", sign: "#F4EEDF", signText: "#2B3350" },
};

export function appearance() {
  const bg = String(theme()?.background ?? "#ffffff").replace("#", "");
  if (bg.length < 6) return "light";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.45 ? "dark" : "light";
}

// A preview window's demo copies keep PiP under their own keys: shared values can travel between
// that window and the one in use, and the window in use never reads the demo keys.
export const DEMO_PIP_KEY = "cozy-office.pip.demo";
export function pipOn(demo = false) { return shared(demo ? DEMO_PIP_KEY : PIP_KEY) === true; }
// The office shows only as the PiP: a window overlay (openOverlay, pip.js) that the strip's copy opens.
export function setPip(on, demo = false) {
  setShared(demo ? DEMO_PIP_KEY : PIP_KEY, on);
}

/** The office state of a card item. */
export function officeState(item) {
  if (item.group === "attention") return item.raw?.waitingFor === "permission prompt" ? "approve" : "needs";
  if (item.group === "done") return item.viewed ? "idle" : "done";
  return "working";
}

/** Herdr space of an item (by its terminal), else a key built from its folder. */
export function spaceOf(item, agentList) {
  const agent = item.terminal ? agentList.find((a) => a.address === item.terminal) : null;
  if (agent) return { key: `space:${agent.space}`, label: agent.space_name };
  const name = item.spot?.repo || String(item.raw?.cwd ?? "").replace(/\/+$/, "").split("/").pop() || "elsewhere";
  return { key: `dir:${name}`, label: name };
}

/** Sessions and spaces in the shape place.layout takes, in rail order. */
export function sceneInput(items, agentList = agents(), spaceList = spaces()) {
  const order = new Map(spaceList.map((s, n) => [`space:${s.id}`, n]));
  const labels = new Map();
  const sessions = items.map((item) => {
    const sp = spaceOf(item, agentList);
    if (!labels.has(sp.key)) labels.set(sp.key, sp.label);
    return { id: item.sessionId, space: sp.key, state: officeState(item), item };
  });
  const keys = [...labels.keys()].sort((a, b) => (order.get(a) ?? 1e6) - (order.get(b) ?? 1e6) || (a < b ? -1 : 1));
  // Herdr spaces keep the rail's colour (their spaces() index); folder-only groups follow them.
  let extra = spaceList.length;
  return { sessions, spaces: keys.map((key) => ({ key, label: labels.get(key), color: order.has(key) ? order.get(key) : extra++ })) };
}

function src(tone, d) {
  if (d.kind === "room") return `${ART}/${tone}/room.svg`;
  if (d.kind === "person") return `${ART}/${tone}/people/${d.look}-${d.pose}.svg`;
  if (d.kind === "fx") return `${ART}/fx/${d.name}.svg`;
  return `${ART}/${tone}/${d.name}.svg`;
}

// The top band: the office block's first 52 px (place.js keeps people, bubbles and zone plates
// below it). cozy-tabs floats at its left, 12 px in, no wider than its COMPACT_MAX (360) plus
// Herdr's frame; the chips sit right of it, one row, centred on the bar.
export const BAND = 52;
export const CHIP_TOP = 18, CHIP_H = 28, CHIP_GAP = 6, BAND_RIGHT = 12;
export const TABS_RESERVE = 12 + 360 + 4 + 8;
// The chrome metrics of a full office and of the small PiP window. The PiP's band is 34 px and its
// chips are a little smaller; the rest of the view is the same office drawn at its size.
const FULL = { band: BAND, chipTop: CHIP_TOP, chipH: CHIP_H, reserve: TABS_RESERVE, right: BAND_RIGHT };
export const MINI = { band: 34, chipTop: 5, chipH: 24, reserve: 6, right: 6 };
// Left to right as drawn; `drop` is the order chips leave a narrow band in (PiP leaves last, and only
// when it no longer fits).
// The head row's space name and branch are gone (the rail marks the space, the pane header shows the
// branch, and an unnamed space's name can be a folder id), and so is the bare "?" (the ? key and the
// search chip's tip still say how to list the keys). The three state chips read like the people's
// hover lines: a state dot, the state's word, how many.
const BAND_CHIPS = [
  { id: "o-overview", w: 100, drop: 3 },
  { id: "o-read", w: 96, drop: 1 },
  { id: "o-search", w: 112, drop: 2 },
  { id: "o-working", w: 104, drop: 4 },
  { id: "o-needs", w: 118, drop: 6 },
  { id: "o-done", w: 84, drop: 5 },
];
// In the small window a typed query keeps the search chip to the last, so what is typed stays
// visible; a full office keeps its own order.
const SEARCH_QUERY_DROP = 7;

/** The band's chips for a W px wide view: [{id, x, y, w, h}], right-aligned, widest set that fits in
 *  the room the row leaves. parts: { pages (pages to read), focus (someone is framed), query, mini }
 *  (no pages, no read chip; Overview only while someone is framed),
 *  and reserve, right, top, h, which default to the full office's band. */
export function bandChips(W, parts = {}) {
  const mini = Boolean(parts.mini);
  let list = BAND_CHIPS
    .filter((c) => (c.id !== "o-read" || parts.pages > 0) && (c.id !== "o-overview" || parts.focus));
  const reserve = parts.reserve ?? TABS_RESERVE;
  const right = parts.right ?? BAND_RIGHT;
  const top = parts.top ?? CHIP_TOP, h = parts.h ?? CHIP_H;
  const dropOf = (c) => (c.id === "o-search" && mini && parts.query ? SEARCH_QUERY_DROP : c.drop);
  const room = W - reserve - right;
  const width = (l) => l.reduce((sum, c) => sum + c.w, 0) + CHIP_GAP * Math.max(0, l.length - 1);
  while (list.length > 1 && width(list) > room) {
    const worst = list.reduce((a, c) => (dropOf(c) < dropOf(a) ? c : a));
    list = list.filter((c) => c !== worst);
  }
  // A view too narrow for even one chip right of the tab bar shows none rather than one under the tabs.
  if (width(list) > room) return [];
  let x = W - right - width(list);
  return list.map((c) => {
    const out = { id: c.id, x, y: top, w: c.w, h };
    x += c.w + CHIP_GAP;
    return out;
  });
}

function bandChip(t, c, label, opts = {}) {
  return div().id(c.id).absolute().left(c.x).top(c.y).w(c.w).h(c.h).px(c.w > 40 ? 10 : 0).flex().items_center()
    .justify_center().gap(6).rounded(c.h / 2).bg(opts.on ? t.chipText : t.chip).border(1)
    .border_color(opts.ring ? STATE_HEX.approve : t.line)
    .when(Boolean(opts.click), (el) => el.cursor_pointer().hover((s) => s.border_color(t.chipMuted)))
    .when(Boolean(opts.dot), (el) => el.child(div().size(8).flex_none().rounded(4).bg(opts.dot)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_bold()
      .text_color(opts.muted ? t.chipMuted : opts.on ? t.chip : t.chipText).when(c.w <= 40, (el) => el.flex_none()).child(label))
    .when(Boolean(opts.tip), (el) => el.tooltip(opts.tip))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .when(Boolean(opts.click), (el) => el.on_click((_e, cx) => opts.click(cx)));
}

function band(view, t, M, W, counts, focus, opts = {}) {
  const parts = view.bandParts?.() ?? {};
  const pages = parts.pageCount ?? 0;
  const needs = counts.needs + counts.approve;
  const mini = Boolean(opts.mini);
  const spec = {
    "o-overview": () => ["← Overview", { tip: "Back to the whole office (Esc)", click: (cx) => { view.camFocus = false; cx.notify(); } }],
    "o-read": () => [`${pages} to read`, { tip: `${pages} ${pages === 1 ? "page" : "pages"} to read: open the oldest (Tab)`, click: (cx) => view.openPages?.(cx) }],
    "o-search": () => [parts.query || "⌕ Search", { muted: !parts.query, ring: parts.searching, tip: "Search people: type while the office has the keyboard · ? lists every key", click: (cx) => view.focusSearch?.(cx) }],
    "o-working": () => [`${STATE_WORD.working} ${counts.working}`, { dot: STATE_HEX.working, tip: `${counts.working} at their desks, working` }],
    "o-needs": () => [`${STATE_WORD.needs} ${needs}`, { dot: STATE_HEX.needs, tip: `${needs} waiting for you: go to who waited longest (Space)`, click: (cx) => view.officeJump("reply", cx) }],
    "o-done": () => [`${STATE_WORD.done} ${counts.done}`, { dot: STATE_HEX.done, tip: `${counts.done} finished: go to them, oldest first (⇧Space)`, click: (cx) => view.officeJump("done", cx) }],
  };
  return bandChips(W, { pages, focus: Boolean(focus), query: parts.query, mini, reserve: M.reserve, right: M.right, top: M.chipTop, h: M.chipH })
    .map((c) => bandChip(t, c, ...spec[c.id]()));
}

/**
 * view: the CozyOffice instance (sel, camFocus, stage, timeText, goTo, grabKeys, ...).
 * items: visible card items. mini: a small floating window, so the chrome takes MINI's metrics; the
 * scene is the same office.
 */
export function officeView(view, items, now, { mini = false } = {}) {
  const tone = appearance();
  const t = TOKENS[tone];
  const M = mini ? MINI : FULL;
  const W = Math.max(1, view.stage?.w ?? 800), H = Math.max(1, view.stage?.h ?? 300);
  const input = sceneInput(items);
  // The seat memory lives in shared(), which a preview window's demo copy may share with the
  // window in use: a demo copy keeps out of it, so the two never overwrite each other's seats.
  const L = layout(input.sessions, view.demo ? undefined : seatMemory());
  if (!view.demo) rememberSeats(L.seats);
  const byId = new Map(input.sessions.map((s) => [s.id, s]));
  const selected = view.sel && byId.has(view.sel) ? byId.get(view.sel) : null;
  const focus = view.camFocus && selected ? L.people[selected.id] : null;
  // The person's look (zoom.js: pinch, ⌘ + scroll, drag) lies over the overview; a focus frame sets
  // it aside. The PiP keeps the room's band free with its own, shorter one.
  const base = camera(W, H, null, L.bounds, mini ? { inset: MINI.band } : {});
  const cam = focus ? camera(W, H, focus, L.bounds, { at: focusAt(W) }) : lookCamera(base, view.look ?? null, L.bounds);
  view.cams = { base, shown: cam, room: L.bounds, W, H };
  const k = W / cam.w;
  const sx = (x) => (x - cam.x) * k, sy = (y) => (y - cam.y) * k;
  const glide = now - (view.lookAt ?? -Infinity) < LOOK.live ? LIVE : MOVE;
  const place = (el, id, x, y, w, h) => el.id(id).absolute().left(sx(x)).top(sy(y)).w(w * k).h(h * k)
    .transition("left", glide).transition("top", glide).transition("width", glide).transition("height", glide);

  // A person's halo, shadow and bubble travel with them, so they are drawn in the person's slots.
  const isWorn = (d) => d.kind === "fx" && Boolean(d.id) && (d.name === "halo" || d.name === "shadow" || d.name.startsWith("bubble"));
  const worn = new Map();
  for (const d of L.drawables) {
    if (!isWorn(d)) continue;
    if (!worn.has(d.id)) worn.set(d.id, {});
    if (d.name === "halo" || d.name === "shadow") worn.get(d.id)[d.name] = d;
  }
  view.walks ??= new Map();
  const scene = [], says = [];
  L.drawables.forEach((d, n) => {
    if (isWorn(d)) return;
    const id = d.kind === "person" ? `op-${d.id}` : d.kind === "fx" && d.id ? `of-${d.name}-${d.id}` : `od-${d.name}-${n}`;
    if (d.kind !== "person") {
      scene.push(place(div(), id, d.x, d.y, d.w, d.h).child(div().size_full().child(imageOf(src(tone, d)))));
      return;
    }
    const s = byId.get(d.id);
    const rec = stepWalk(view.walks.get(d.id), d.feet, now);
    view.walks.set(d.id, rec);
    const walking = now < rec.at + rec.ms + WALK.fade;
    const go = walking ? { duration: rec.ms, easing: "ease-in-out" } : glide;
    // The new look waits for the arrival; once the walk is over a change (a new bubble at the same
    // spot, a pose at an overflowing desk) shows at once instead of after the last walk's length.
    const fade = { duration: WALK.fade, delay: walking ? rec.ms : 0 };
    const g = worn.get(d.id) ?? {};
    // Halo and shadow sit at the feet, placed against the person's own box.
    const under = (f, fid) => div().id(fid).absolute().left((f.x - d.x) * k).top((f.y - d.y) * k).w(f.w * k).h(f.h * k)
      .child(imageOf(src(tone, f)));
    const looks = [0, 1].map((slot) => {
      const current = slot === rec.slot;
      // The other slot is the walker (standing, shadow under them) once this person has walked.
      const look = current ? { pose: d.pose, halo: g.halo, shadow: g.shadow } : rec.at > -Infinity ? { pose: "stand", shadow: shadowBox(d.feet) } : null;
      let body = div().id(`op-${d.id}-p${slot}`).absolute().left(0).top(0).size_full();
      if (look) body = body.child(imageOf(src(tone, { ...d, pose: look.pose })));
      // Whoever needs you bounces a little, so the wave reads as a wave; a walker bobs with each step.
      if (current && s.state === "needs") body = body.loop("top", { from: 0, to: -2.5 * k, period: 700, easing: "ease-in-out" });
      if (!current && walking) body = body.loop("top", { from: 0, to: -WALK.bob * k, period: WALK.step, easing: "ease-in-out" });
      let el = div().id(`op-${d.id}-s${slot}`).absolute().left(0).top(0).size_full()
        .opacity(current ? 1 : 0).transition("opacity", fade);
      if (look?.halo) el = el.child(under(look.halo, `op-${d.id}-h${slot}`));
      if (look?.shadow) el = el.child(under(look.shadow, `op-${d.id}-w${slot}`));
      return el.child(body);
    });
    // Bubbles go after the scene and its zone plates (see below for a framed view), placed and
    // stacked once everyone is known.
    const quiet = focus && selected?.id === d.id;
    const at = L.people[d.id]?.say ?? [d.x + d.w / 2, d.y];
    says.push({ id: d.id, state: quiet ? null : s.state, text: sayLine(s.item), tip: [sx(at[0]), sy(at[1])], slot: rec.slot, go, fade });
    const el = div().id(id).absolute().left(sx(d.x)).top(sy(d.y)).w(d.w * k).h(d.h * k)
      .transition("left", go).transition("top", go).transition("width", glide).transition("height", glide)
      .child(looks[0]).child(looks[1])
      .cursor_pointer()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); view.openLinks(`card-${s.id}`, cx); })
      .on_click((_e, cx) => view.clickPerson(s.item, cx))
      .on_hover((on, cx) => hoverPerson(view, s.id, on, cx))
      .tooltip(personTip(s.item, input.spaces.find((sp) => sp.key === s.space)?.label, s.state));
    scene.push(el);
  });
  const bubbles = sayLayer(view, says, W, H, k, M.band);
  // Bubbles go over the zone plates, so a plate never covers what someone says; while someone is
  // framed they stay in the scene, under the spotlight that dims everyone else.
  if (focus) scene.push(...bubbles);
  // A session that leaves is forgotten, so coming back it is placed, not walked in from where it was.
  for (const id of view.walks.keys()) if (!byId.has(id)) view.walks.delete(id);

  if (focus) {
    const r = 1000;
    scene.push(place(div(), "o-spot", focus.head[0] - r, focus.head[1] + 20 - r, 2 * r, 2 * r)
      .child(div().size_full().child(imageOf(`${ART}/fx/spot-${tone}.svg`))));
  }

  // A plate on a thin post: the plate's bottom centre sits on the post's top. The two zone plates
  // keep inside the camera, zoomed in or not, and slide (dx) so the plate hangs beside its post.
  const signs = signPlates(L.signs, k, cam).map((g) => div().id(`os-${g.label}-${g.n}`).absolute().left(sx(g.x)).top(sy(g.y) - g.h)
    .transition("left", glide).transition("top", glide)
    .child(div().absolute().left(-1).top(g.h - 1).w(2).h(g.post + 1).rounded(1).bg(t.sign))
    .child(div().relative().left(g.dx - 200).w(400).flex().justify_center()
      .child(div().h(g.h).px(g.fs * 0.75).flex().items_center().gap(5).rounded(g.h / 2).bg(t.sign).shadow_sm()
        .child(div().whitespace_nowrap().text_size(g.fs).font_family(FONT).font_weight(900).text_color(t.signText)
          .child(g.text)))));

  const counts = { working: 0, needs: 0, approve: 0, done: 0 };
  for (const s of input.sessions) if (s.state in counts) counts[s.state]++;

  // In the PiP only the band moves the window, so its move cursor and tip live there (the scene
  // root keeps the default arrow over the room); a press on it is not stopped, so Herdr drags.
  const chrome = mini
    ? [div().id("o-pip-bar").absolute().left(0).top(0).right(0).h(M.band).cursor_move().tooltip("Drag to move the PiP")]
    : [];
  chrome.push(...band(view, t, M, W, counts, focus, { mini }));
  if (L.hidden > 0) {
    chrome.push(div().id("o-hidden").absolute().left(10).bottom(8).h(22).px(9).flex().items_center().rounded(11).bg(t.chip)
      .border(1).border_color(t.line).text_size(11).font_family(FONT).font_bold().text_color(t.chipMuted)
      .child(`+${L.hidden} more in the hall`));
  }
  if (focus) chrome.push(memo(view, t, selected, focus, sx, sy, W, H, now, M.band));
  if (!input.sessions.length) {
    chrome.push(div().id("o-empty").absolute().left(0).right(0).bottom(14).flex().justify_center()
      .child(div().px(12).h(26).flex().items_center().rounded(13).bg(t.chip).border(1).border_color(t.line)
        .text_size(12).font_family(FONT).font_bold().text_color(t.chipMuted).child(view.emptyMessage?.() ?? "All quiet for now")));
  }

  // Pinch and ⌘ + scroll zoom about the pointer, and dragging the room moves the view, here and in
  // PiP. A press in the PiP's band is Herdr's own drag of the window, so it is not stopped and does
  // not start a pan; every other press of the PiP's scene stops before Herdr and pans the room.
  return div().id(mini ? "office-pip" : "office-stage").relative().size_full().overflow_hidden().bg(t.stage)
    .when(mini, (el) => el.cursor_default())
    .on_pinch((e, cx) => zoomGesture(view, pinchFactor(e), e, cx))
    .on_scroll_wheel((e, cx) => zoomGesture(view, wheelFactor(e), e, cx))
    .on_mouse_down("left", (e, cx) => {
      if (mini) {
        if (inBand(e, appZoom())) return;
        cx.stop_propagation();
        view.grabKeys?.(cx);
      }
      panStart(view, e, cx);
    })
    .on_mouse_move((e, cx) => panMove(view, e, cx))
    .on_mouse_up("left", () => panEnd(view))
    .on_hover((hovered) => { if (!hovered) panEnd(view); })
    .on_click((_e, cx) => {
      // The release that ends a drag is no click.
      if (view.panMoved) { view.panMoved = false; return; }
      if (view.camFocus) { view.camFocus = false; cx.notify(); }
    })
    .children(scene).children(signs).children(focus ? [] : bubbles).children(chrome);
}

// Pointer positions arrive in on-screen px, which carry the app's zoom; the stage is measured without it.
function appZoom() {
  const z = Number(settings()?.zoom);
  return z > 0 ? z : 1;
}

/** True when a press on the PiP's scene landed in its top band: Herdr's own window drag takes it,
 *  so the scene neither stops it nor starts a pan. `local_position` missing is no band. */
export function inBand(event, zoom = 1, band = MINI.band) {
  const p = event?.local_position;
  if (!p || !Number.isFinite(p.y)) return false;
  const z = Number(zoom) > 0 ? Number(zoom) : 1;
  return p.y < band * z;
}

// A look change that starts on a focus frame starts from that frame, and the frame gives way to it.
function fromShown(view) {
  if (!view.camFocus) return null;
  view.camFocus = false;
  return view.cams?.shown ?? null;
}

/** A pinch or ⌘ + scroll step: no factor (a wheel without ⌘) passes the event on untouched. */
export function zoomGesture(view, factor, event, cx) {
  const c = view.cams;
  if (factor == null || !c) return false;
  const z = appZoom(), p = event?.local_position;
  const at = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [p.x / z, p.y / z] : null;
  const from = fromShown(view);
  view.look = zoomAt(from ? null : view.look ?? null, c.base, c.room, c.W, c.H, factor, at, from);
  view.lookAt = Date.now();
  cx?.stop_propagation?.();
  cx?.notify?.();
  return true;
}

/** The view commands (cozy-office.zoom_in / zoom_out / zoom_reset / pan_<dir>): true when it was one. */
export function lookCommand(view, command) {
  const c = view.cams;
  if (!c) return false;
  if (command === "zoom_reset") { view.look = null; view.lookAt = null; return true; }
  if (command === "zoom_in" || command === "zoom_out") {
    const f = command === "zoom_in" ? LOOK.step : 1 / LOOK.step;
    const from = fromShown(view);
    view.look = zoomAt(from ? null : view.look ?? null, c.base, c.room, c.W, c.H, f, null, from);
    view.lookAt = null;
    return true;
  }
  const dir = /^pan_(left|right|up|down)$/.exec(command)?.[1];
  if (!dir) return false;
  const from = fromShown(view);
  view.look = panStep(from ? null : view.look ?? null, c.base, c.room, dir, from);
  view.lookAt = null;
  return true;
}

/** A press on the room: a double-click there gives the default view back; otherwise a drag may start. */
export function panStart(view, event, cx) {
  view.panMoved = false;
  if (Number(event?.click_count) >= 2) {
    view.pan = null;
    if (view.look) { view.look = null; view.lookAt = null; cx?.notify?.(); }
    return;
  }
  const p = event?.position;
  view.pan = p ? { from: [p.x, p.y], look: view.camFocus ? null : view.look ?? null, cam: view.cams?.shown ?? null, moved: false } : null;
}

export function panMove(view, event, cx) {
  const pan = view.pan, c = view.cams, p = event?.position;
  if (!pan || !c || !p) return;
  const z = appZoom();
  const dx = (p.x - pan.from[0]) / z, dy = (p.y - pan.from[1]) / z;
  if (!pan.moved) {
    if (Math.hypot(dx, dy) < LOOK.drag) return;
    pan.moved = true;
    view.panMoved = true;
    if (view.camFocus) view.camFocus = false;
  }
  view.look = panBy(pan.look, c.base, c.room, c.W, dx, dy, pan.cam);
  view.lookAt = Date.now();
  cx?.notify?.();
}

// Herdr delivers mouse moves only over the element, so leaving it ends the drag where it got to.
export function panEnd(view) { view.pan = null; }

/** The memo card's width in a `W` px wide view. */
export function memoWidth(W) {
  return Math.min(300, Math.max(220, W * 0.26));
}

/** The fraction of a `W` px wide view the framed head sits at: 0.36 while the memo card fits right
 *  of a head there, else as far left as the card's 46 px gap and width allow, never nearer than
 *  30 px to the view's left edge. */
export function focusAt(W) {
  const w = memoWidth(W);
  return 0.36 * W + 46 + w <= W - 10 ? 0.36 : Math.max(30 / W, (W - 10 - w - 46) / W);
}

function memo(view, t, s, focus, sx, sy, W, H, now, bandTop = BAND) {
  const item = s.item, state = s.state;
  const w = memoWidth(W);
  let left = sx(focus.head[0]) + 46, top = Math.max(bandTop, sy(focus.head[1]) - 30);
  if (left + w > W - 10) left = Math.max(10, sx(focus.head[0]) - 46 - w);
  top = Math.min(top, Math.max(bandTop, H - 150));
  const message = item.answer || item.message || item.topic || "";
  const steps = view.expanded?.has(item.sessionId) && item.steps?.length ? view.visibleSteps(item) : [];
  const glyph = { done: ["✓", STATE_HEX.done], blocked: ["!", STATE_HEX.needs], now: ["•", STATE_HEX.working], side: ["•", STATE_HEX.working] };
  return div().id("o-memo").absolute().left(left).top(top).w(w).p(12).flex().flex_col().gap(6).rounded(12)
    .bg(t.memo).border(1).border_color(t.line).shadow_md()
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(div().flex().items_center().gap(6)
      .child(div().size(8).rounded(4).bg(STATE_HEX[state]))
      .child(div().text_size(11).font_family(FONT).font_weight(900).text_color(STATE_HEX[state]).child(STATE_WORD[state]))
      .child(div().flex_1())
      .child(div().text_size(11).font_family(FONT).font_semibold().text_color(t.chipMuted).child(view.timeText(item, now) ?? "")))
    .child(div().text_size(14).font_family(FONT).font_weight(800).text_color(t.chipText).line_height("19px").max_h(38).overflow_hidden().child(item.title))
    .when(Boolean(message) && message !== item.title, (el) => el.child(div().text_size(12).font_family(FONT).font_semibold()
      .text_color(t.chipMuted).line_height("16px").max_h(48).overflow_hidden().child(message)))
    .children(steps.map((step, n) => {
      const [g, c] = glyph[step.state] ?? ["○", t.chipMuted];
      return div().id(`o-step-${n}`).flex().items_center().gap(6).min_w(0)
        .child(div().w(12).flex_none().text_size(11).font_family(FONT).font_weight(900).text_color(c).child(g))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_semibold()
          .text_color(step.state === "done" ? t.chipMuted : t.chipText).child(step.label));
    }))
    .when(!steps.length && item.steps?.length > 0, (el) => el.child(div().text_size(11).font_family(FONT).font_semibold()
      .text_color(t.chipMuted).child(`${item.steps.length} steps · ↓ to show`)))
    .child(div().flex().gap(10).pt(2)
      .child(div().text_size(11).font_family(FONT).font_bold().text_color(t.chipMuted).child("↩ open"))
      .child(div().text_size(11).font_family(FONT).font_bold().text_color(t.chipMuted).child("⌘↩ links"))
      .child(div().text_size(11).font_family(FONT).font_bold().text_color(t.chipMuted).child("⌫ done")));
}

const FENCE = /^\s*(?:```|~~~)/;
const LEAD_IN = [
  // Filler words go only with their comma ("OK, ..."), so "Next release ..." keeps its "Next".
  /^(?:ok(?:ay)?|alright|so|next|first|then)[,.!:]\s+/i,
  /^now,?\s+/i,
  /^(?:let me|let's|let us|i'll|i will|i'm going to|i am going to|going to)\s+/i,
  /^(?:이제|먼저|그럼|그러면|다음으로|우선)\s+/,
];
const LINE_LEAD = [/^#{1,6}\s+/, /^>\s*/, /^[-*+•]\s+/, /^\d+[.)]\s+/];

/** One bubble line from the session's raw message text: fenced code, markdown marks, bare URLs and a
 *  spoken lead-in ("Let me", "이제") are dropped, a link keeps its label and a file path its last part,
 *  so the line reads as what it said. Length is left to sayText. */
export function sayMessage(text) {
  if (typeof text !== "string" || !text.trim()) return "";
  const kept = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) { fenced = !fenced; continue; }
    if (!fenced) kept.push(line);
  }
  let out = kept.join("\n").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // A bare URL goes with the space before it; brackets, quotes and punctuation after it stay.
    .replace(/\s*https?:\/\/[^\s)\]>"'`]*[^\s)\]>"'`.,;:!?]/g, "");
  // A path keeps its last part: a word with two or more slashes that starts with /, ~/, ./ or ../, or
  // ends in a file name (an extension that starts with a letter, maybe with :line or :line:col). Brackets, quotes and punctuation
  // around it stay. "2026/11/20", "CI/CD/build", "1/2/3.5" and "...and/or/so" are not paths.
  out = out.replace(/\S+/g, (word) => {
    const [, lead, core, trail] = word.match(/^([`'"(\[<]*)(.*?)([`'")\]>.,;:!?]*)$/);
    const parts = core.split("/");
    const named = parts.filter(Boolean);
    const path = /^(?:\/|~\/|\.\.?\/)/.test(core) || /\.[A-Za-z][A-Za-z0-9]*(?::\d+){0,2}$/.test(parts.at(-1));
    return parts.length > 2 && named.length && path ? lead + named.at(-1) + trail : word;
  });
  const lines = [];
  for (const line of out.split("\n")) {
    if (/^[\s|:-]+$/.test(line) && /[|:-]/.test(line)) continue;
    let stripped = line.replace(/\|/g, " ");
    for (const re of LINE_LEAD) stripped = stripped.replace(re, "");
    lines.push(stripped);
  }
  out = lines.join(" ").replace(/\*\*|__|~~|`/g, "")
    .replace(/(^|\s)([*_])(\S(?:.*?\S)?)\2(?=$|\s|[.,;:!?)])/g, "$1$3")
    .replace(/\s+/g, " ").trim();
  let led = false;
  for (;;) {
    const re = LEAD_IN.find((r) => r.test(out));
    if (!re) break;
    const rest = out.replace(re, "");
    if (!rest.trim()) break;
    out = rest;
    led = true;
  }
  if (led) out = out.replace(/^[a-z]/, (ch) => ch.toUpperCase());
  return out;
}

/** What a person says: the last thing the session said, the last sentence of its last message;
 *  while working with no message, the tool it is running; else its topic, else its title. */
export function sayLine(item) {
  return sayMessage(item?.lastSentence) || sayMessage(item?.replyTail)
    || (item?.group === "working" ? sayMessage(item?.raw?.currentAction) : "")
    || item?.topic || item?.title || "";
}

// The pointer on a person or their bubble brings that bubble to full strength on top.
function hoverPerson(view, id, on, cx) {
  const was = view.hovered ?? null;
  if (on) view.hovered = id;
  else if (view.hovered === id) view.hovered = null;
  if ((view.hovered ?? null) !== was) cx.notify();
}

/** The office's speech bubbles, two slots a person like the glyph bubbles: the current slot shows
 *  the bubble (fading in on arrival after a walk), the other stays empty. People without a bubble
 *  keep their empty slots, so a bubble that comes later fades in instead of popping. */
function sayLayer(view, says, W, H, k, top = BAND) {
  const boxes = sayBoxes(says, { W, H, k, top, hovered: view.hovered ?? null });
  const byId = new Map(boxes.map((b) => [b.id, b]));
  const spec = new Map(says.map((sp) => [sp.id, sp]));
  const order = [...says.filter((sp) => !byId.has(sp.id)).map((sp) => sp.id), ...boxes.map((b) => b.id)];
  const out = [];
  for (const id of order) {
    const sp = spec.get(id), b = byId.get(id);
    for (const slot of [0, 1]) {
      const on = Boolean(b) && slot === sp.slot;
      let el = div().id(`ob-${id}-${slot}`).absolute().left(b ? b.x : sp.tip[0]).top(b ? b.y : sp.tip[1])
        .w(b ? b.w : 0).h(b ? b.h + b.lift + SAY.tailH : 0)
        .transition("left", sp.go).transition("top", sp.go).opacity(on ? b.opacity : 0).transition("opacity", sp.fade);
      if (on) {
        el = el.on_hover((over, cx) => hoverPerson(view, id, over, cx))
          .child(div().absolute().left(0).top(0).size_full().loop("top", { from: 0, to: -SAY.bob, period: 1600, easing: "ease-in-out" })
            .child(sayBubble(b)));
      }
      out.push(el);
    }
  }
  return out;
}

function imageOf(path) { return image(path).size_full(); }

// The assignment memory lives in Herdr's shared values, not localStorage: the office block and
// its floating PiP copy are separate copies with separate localStorage.
export const SEATS_KEY = "cozy-office.seats";
const isMap = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** The assignment memory every copy reads; an empty one when nothing valid is stored. */
export function seatMemory() {
  const v = shared(SEATS_KEY);
  return isMap(v) && isMap(v.desk) && isMap(v.spot) ? v : { desk: {}, spot: {} };
}

// Canonical text for the map: assign() builds its keys in whatever order the scan found them, so
// raw JSON would differ for two equal assignments.
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** setShared re-renders every mod, so a value equal to the stored one is not written.
 *  Returns true when it wrote. */
export function rememberSeats(next) {
  if (stable(next) === stable(seatMemory())) return false;
  setShared(SEATS_KEY, next);
  return true;
}

/** A person's hover line: space, title and state, with the empty parts left out. */
export function personTip(item, spaceLabel, state) {
  const title = item?.title || item?.topic || item?.sessionId;
  return [spaceLabel, title, STATE_WORD[state]]
    .filter((p) => p !== undefined && p !== null && p !== "")
    .join(" · ");
}
