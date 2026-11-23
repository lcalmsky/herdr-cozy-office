// Cozy office: every session is a pocket card, laid left to right in three groups
// (Needs you, Working, Done) and scrolled sideways. The data, grouping, sort, keys and
// opening are Pulse's (scan.sh every 3 s); Herdr agents Pulse doesn't list (other programs)
// join the same groups. The office copy draws the scene with the old head row's chips (space,
// branch, pages, search, PiP) in its top band. props().role "strip" is the button in the 30 px
// tab strip PiP leaves; props().role "pip" is the window overlay the office and the strip open
// while PiP is on (pip.js): it stays where it was put and closes itself when PiP goes off.

import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, h_virtual_list, VirtualListScrollHandle } from "gpui-base";
import { officeView, pipOn, setPip, appearance, lookCommand } from "./office-view.js";
import { typeJamo, eraseJamo } from "./hangul.js";
import { demoModel, demoFocus } from "./demo.js";
import { JIRA_BROWSE, SLACK_ARCHIVES, KEY_RE, KNOWN_REPOS, THREAD_LABEL, TOPIC_TAILS } from "./site.js";
import {
  pipSize, setPipSize, stepSize, dragCanvas, cornerRect, handKeys, keysFor, takeKeys, handLook, takeLook,
  pipPlace, setPipPlace, pipWindowKey, pipArea, windowBox, fitSize, clampPlace, defaultPlace, snapPlace, samePlace,
  showPlace, anchoredResize, halfOf,
  originOf, boxFor, pipBeat, pipGone, markPipOpened, pipWindowLive, PIP_EDGE, PIP_SETTLE_MS,
} from "./pip.js";
import { exec, run, appHome, settings, readTextFile, writeTextFile, terminals, panes, agents, focused, nextCommand, props, shared, setShared, openOverlay, closeOverlay, theme, layout } from "herdr";

const INK_TONES = {
  light: {
    bg: "#F6ECDC", chrome: "#F3E6D0", surface: "#FFF6E6", line: "#E3D2B8", edge: "#E8D9C2", rule: "#EADBC4",
    t1: "#3B2E2A", t2: "#5E4C42", t3: "#8A7868", amber: "#E5B54F", amberInk: "#D9805F",
    blue: "#7E9FC2", chipBg: "#FFFBF4",
  },
  dark: {
    bg: "#262433", chrome: "#2A2838", surface: "#302D40", line: "#49445E", edge: "#3E3A52", rule: "#3A3650",
    t1: "#F1E8DA", t2: "#D8CFC2", t3: "#A9A2B8", amber: "#E5B54F", amberInk: "#E5B54F",
    blue: "#8FB0D8", chipBg: "#383449",
  },
};
// Every INK lookup reads the theme shown now, so the strip button, links menu and legend follow light and dark.
const INK = new Proxy({}, { get: (_target, key) => INK_TONES[appearance()][key] });
const FLASH_KEY = "cozy-office.flash";
// cozy-office.<command> names the PiP answers (keys.json can bind them); the arrows are also ⌥ + arrow.
const PIP_COMMANDS = {
  pip_left: ["move", "left"], pip_right: ["move", "right"], pip_up: ["move", "up"], pip_down: ["move", "down"],
  pip_grow: ["size", 1], pip_shrink: ["size", -1], pip_size_reset: ["size", 0],
};
const PIP_GRIP = 22;
// The top grips' height: the PiP's chips start PIP_EDGE + MINI.chipTop = 11 px down the window.
export const PIP_GRIP_TOP = 11;
// A window copy reopened for a grip drag that hears no pointer at all (the pointer was let go
// while the window was being swapped) ends its drag after this long.
const GRIP_QUIET_MS = 1500;
// cozy-office.<command> names that zoom and pan the scene shown: the office, or the PiP while it is on.
export const LOOK_COMMANDS = new Set(["zoom_in", "zoom_out", "zoom_reset", "pan_left", "pan_right", "pan_up", "pan_down"]);
export const NOTICE_KEY = "cozy-office.notice";
export const NOTICE_ACT_KEY = "cozy-office.notice-act";
export const NO_PAGE_FLASH = "No page can open yet — try again after the scan";
// Band, chip ink and dot per lane.
const TONE = {
  needs: { band: "#fbe4de", ink: "#a84a40", dot: "#e07a6f", label: "Needs you" },
  stall: { band: "#f3ece2", ink: "#7a5a3c", dot: "#c9a27a", label: "Stalled" },
  working: { band: "#eef3fa", ink: "#3a68a6", dot: "#6f9fd8", label: "Working" },
  done: { band: "#e3f0e4", ink: "#41744c", dot: "#7fb88a", label: "Done" },
};
const SEG = { done: "#7fb88a", now: "#6f9fd8", side: "#6f9fd8", blocked: "#e07a6f", left: "#ebe3d6" };
const GROUP_COLOR = { attention: TONE.needs.dot, working: TONE.working.dot, done: TONE.done.dot };
const GROUP_TITLE = { attention: "Needs you", working: "Working", done: "Done" };
const FONT = "Nunito";
// No Regular ships with Nunito here, so running text uses Herdr's Geist for a true Regular.
const BODY_FONT = "Geist";
const POLL_MS = 3000;
const FOCUS_WATCH_MS = 100;
const STALL_MS = 10 * 60 * 1000;
const SNOOZE_MS = 10 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const MAX_DONE = 5;
const SEEN_KEY = "pulse.seen";
const VIEWED_KEY = "pulse.viewed";
// localStorage is per mod copy, so the office and its PiP copy share their marks through shared().
const SEEN_SHARED = "cozy-office.seen";
const VIEWED_SHARED = "cozy-office.viewed";
const strings = (list) => (Array.isArray(list) ? list.filter((key) => typeof key === "string") : null);
const UNDO_MS = 6000;
const NONE = "\u0000none";
const SHARED_KEY = "cozy-office";
const BADGES = { "herdr-app": "herdr", herdr: "herdr", tmux: "tmux", orca: "orca" };
const FACES = 24;
// The cards block's height at scale 1. geometry(k) gives every length and text size in the
// strip at another height; the block measures itself and scales to it.
export const BASE_BLOCK_H = 276;
export const BLOCK_H_MIN = 240, BLOCK_H_MAX = 420;
const STEP_ROWS = Math.floor((252 - 24 - 20) / 22);
const STRIP_ID = "cc-strip";
// Hairlines land on the half-pixel grid; a 1 px border stays 1.
const half = (value) => Math.round(value * 2) / 2;

export function geometry(k = 1) {
  const s = (value) => half(value * k);
  const CARD_W = s(240), CARD_H = s(252), STEPS_W = s(240), MORE_W = s(120);
  const BAND_H = s(82), CHAR_SIZE = s(62), CHAR_TOP = s(18), CHAR_LEFT = s(154);
  const PAD_X = s(20), GROUP_GAP = s(24), CARD_GAP = s(12), LANE_W = s(22);
  const STRIP_TOP_PAD = s(12), STRIP_BOTTOM_PAD = s(12), LEGEND_H = s(24);
  const BODY_PAD = s(12);
  const STRIP_H = half(CARD_H + STRIP_BOTTOM_PAD);
  return {
    k, CARD_W, CARD_H, STEPS_W, MORE_W, BAND_H, CHAR_SIZE, CHAR_TOP, CHAR_LEFT,
    STEP_ROWS, PAD_X, GROUP_GAP, CARD_GAP, LANE_W,
    STRIP_TOP_PAD, STRIP_BOTTOM_PAD, LEGEND_H, STRIP_H,
    STRIP_BLOCK_H: half(STRIP_TOP_PAD + STRIP_H),
    BODY_H: s(142), TOPIC_LINE: s(18), MSG_LINE: s(17), FOOT_H: s(14), TRAY_H: s(22),
    TEXT_W: half(CARD_W - 4 - 2 * BODY_PAD),
    BAND_PAD: s(6), BAND_RADIUS: s(12),
    BUBBLE_PAD: s(8), BUBBLE_H: s(22), BUBBLE_RADIUS: s(11), BUBBLE_TAIL: s(3),
    TAG_LEFT: s(12), TAG_BOTTOM: s(8), TAG_GAP: s(2), TAG_HEAD_LINE: s(16), TAG_SUB_LINE: s(14),
    PROGRESS_H: s(14), PROGRESS_GAP: s(8), BAR_H: s(5), BAR_GAP: s(3), BAR_RADIUS: s(3), PROGRESS_MB: s(4),
    TAG_H: s(22), TAG_MAX_W: s(110), TAG_PAD: s(8), TAG_RADIUS: s(11), TAG_CHIP_GAP: s(5), TAG_ICON: s(11),
    STEP_H: s(20), STEP_GAP: s(6), STEP_GLYPH_W: s(14), SPINNER: s(9), STEP_TRAIL_W: s(72),
    STEPS_PAD: s(12), STEPS_GAP: s(2), STEPS_HEAD_H: s(20), STEPS_HEAD_GAP: s(8),
    CARD_RADIUS: s(16), BODY_PT: s(9), BODY_PAD, BODY_PB: s(9), MSG_MT: s(5), MSG_SPINNER_MR: s(6),
    TRAY_MB: s(4), TRAY_GAP: s(4), CHIP_H: s(18), CHIP_PAD: s(6), CHIP_RADIUS: s(6), FOOT_GAP: s(8),
    DOT: s(8), MORE_GAP: s(4),
    LEGEND_PAD: s(20), LEGEND_GAP: s(14), LEGEND_ITEM_GAP: s(5),
    KEYCAP_H: s(18), KEYCAP_PAD: s(4), KEYCAP_RADIUS: s(5),
    TEXT: {
      base: s(13), persona: s(11), tagHead: s(13), tagSub: s(11),
      progress: s(11), page: s(11), stepGlyph: s(11), stepLabel: s(12), stepTrail: s(11),
      stepsHead: s(11), stepsCount: s(11),
      topic: s(13), message: s(12), chip: s(10), badge: s(10), foot: s(11),
      groupCount: s(12), moreCount: s(18), moreLabel: s(11),
      empty: s(13), legend: s(11), keycap: s(10),
    },
  };
}

// The hover label wraps only at newlines, so the heading and the details get a line each.
export function cardTooltip(topic, title, details) {
  const heading = [...new Set([topic, title].filter(Boolean))].join(" · ");
  return [heading, details.filter(Boolean).join(" · ")].filter(Boolean).join("\n");
}

// The block's measured height, clamped, is the strip's scale.
export function cardsScale(height) {
  return Math.max(BLOCK_H_MIN, Math.min(BLOCK_H_MAX, Math.round(height))) / BASE_BLOCK_H;
}

// Herdr measures a mod in on-screen px, which carry the app's zoom; the strip's lengths are
// written at zoom 1, so the measured height is divided back by it.
export function zoomOf(s = settings()) {
  const z = Number(s?.zoom);
  return z > 0 ? z : 1;
}

// The app window's size in window px; the PiP places itself against it. Window px, unlike the
// mod's logical px, do not carry the app's zoom.
function readViewport() {
  try {
    return globalThis.window?.viewport_size?.() ?? null;
  } catch {
    return null;
  }
}

function sameViewport(a, b) {
  if (!a || !b) return !a && !b;
  return a.width === b.width && a.height === b.height;
}

// cmd +/-/0 in this layout change the terminals' text size in settings.json, never the zoom,
// so the strip keeps its size. Herdr's own stepper clamps to the same 8..32.
export const TERM_FONT = 14, TERM_FONT_MIN = 8, TERM_FONT_MAX = 32;
export function nextSettings(person, command, shown = TERM_FONT) {
  const next = { ...person };
  if (command === "font_reset") {
    delete next.font_size;
    next.zoom = 1;
    return next;
  }
  const d = command === "font_in" ? 1 : command === "font_out" ? -1 : 0;
  if (!d) return null;
  const now = Number(next.font_size ?? shown) || TERM_FONT;
  next.font_size = Math.max(TERM_FONT_MIN, Math.min(TERM_FONT_MAX, Math.round(now) + d));
  return next;
}

export const STRIP_H = geometry(1).STRIP_H;
export const STRIP_BLOCK_H = geometry(1).STRIP_BLOCK_H;
export const TEXT_W = geometry(1).TEXT_W;

// A classic mouse wheel's notch is one card; a trackpad gathers WHEEL_STEP px per card, but the
// first movement of a gesture takes one at once so a small nudge is not swallowed. Downward moves right.
export const WHEEL_STEP = 60;
export const WHEEL_GESTURE_GAP = 200;

function stripStarts(widths) {
  const starts = [];
  let sum = 0;
  for (const width of widths) {
    starts.push(sum);
    sum += width;
  }
  return starts;
}

// The farthest the strip can scroll: any further and the last card already touches the right edge.
export function maxOffset(widths, viewportW) {
  if (!Array.isArray(widths) || !widths.length) return 0;
  const total = widths.reduce((sum, width) => sum + width, 0);
  return Math.max(0, total - (viewportW > 0 ? viewportW : 0));
}

export function clampOffset(off, widths, viewportW) {
  const value = Number.isFinite(off) ? off : 0;
  return Math.max(0, Math.min(maxOffset(widths, viewportW), value));
}

// The card at the left edge: the first whose END passes the offset, with 1 px of rounding tolerance.
export function leftIndexAt(off, widths) {
  if (!Array.isArray(widths) || !widths.length) return 0;
  const starts = stripStarts(widths);
  for (let i = 0; i < widths.length; i += 1) {
    if (starts[i] + widths[i] > off + 1) return i;
  }
  return widths.length - 1;
}

// The last card fully on screen: its END is within the right edge, with the same 1 px tolerance.
export function rightIndexAt(off, widths, viewportW) {
  if (!Array.isArray(widths) || !widths.length || !(viewportW > 0)) return -1;
  const starts = stripStarts(widths);
  const edge = off + viewportW + 1;
  let last = -1;
  for (let i = 0; i < widths.length; i += 1) {
    if (starts[i] + widths[i] > edge) break;
    last = i;
  }
  return last;
}

// Where centring `index` leaves the left edge; null while the viewport width is unknown.
export function centeredOffset(index, widths, viewportW) {
  if (!Array.isArray(widths) || !widths.length || !(viewportW > 0)) return null;
  const at = Math.max(0, Math.min(widths.length - 1, index ?? 0));
  const starts = stripStarts(widths);
  return clampOffset(starts[at] + widths[at] / 2 - viewportW / 2, widths, viewportW);
}

// `state.off` is the strip's scroll position in px. A native sideways swipe moves that estimate by its
// own delta; a wheel step asks the list to scroll to a card and sets the estimate to where the list
// then puts it (it aligns a partly visible card to its nearest edge). `state.index` is the card at the
// left edge only for the fallback when the viewport width is unknown.
export function wheelStepFor(state, event, now, widths, viewportW) {
  const list = Array.isArray(widths) ? widths : [];
  const count = list.length;
  const dx = event.delta?.x ?? 0;
  const dy = event.delta?.y ?? 0;
  const lines = event.delta_lines;
  const lx = lines?.x ?? 0;
  const ly = lines?.y ?? 0;
  const phase = event.touch_phase;

  const measured = count > 0 && viewportW > 0;
  const starts = measured ? stripStarts(list) : null;
  const off = measured ? clampOffset(state.off ?? 0, list, viewportW) : null;
  const index = measured ? leftIndexAt(off, list) : Math.max(0, Math.min(count - 1, state.index ?? 0));

  const settle = (acc, gesture, dir, step) => ({
    state: {
      ...state,
      acc,
      at: now,
      gesture,
      dir,
      index: measured ? leftIndexAt(step.off, list) : step.index,
      off: measured ? clampOffset(step.off, list, viewportW) : (state.off ?? 0),
    },
    target: step.target,
  });
  const still = { index, off, target: null };
  const move = (forward) => {
    if (!measured) {
      if (forward < 0) return index > 0 ? { index: index - 1, off, target: index - 1 } : still;
      if (index >= count - 1) return still;
      const target = index + 1;
      return { index: target, off, target };
    }
    if (forward < 0) {
      if (off <= 1) return still;
      const target = starts[index] < off - 1 ? index : index - 1;
      if (target < 0) return still;
      return { index: target, off: starts[target], target };
    }
    const right = rightIndexAt(off, list, viewportW);
    if (right >= count - 1) return still;
    const target = right + 1;
    return { index: target, off: starts[target] + list[target] - viewportW, target };
  };

  if (phase === "ended" || phase === "cancelled") return settle(0, false, 0, still);
  // Sideways-dominant travel is the native horizontal scroll: it already moved the content, so only
  // the estimate follows it.
  if ((lines && Math.abs(lx) > Math.abs(ly)) || Math.abs(dx) >= Math.abs(dy)) {
    if (!measured) return { state: { ...state, index }, target: null };
    const next = clampOffset(off - dx, list, viewportW);
    return { state: { ...state, off: next, index: leftIndexAt(next, list) }, target: null };
  }
  if (lines && ly !== 0) {
    // One notch, one card: a fast spin still asks for one card per event.
    return settle(0, false, 0, move(ly < 0 ? 1 : -1));
  }

  const dir = dy < 0 ? 1 : -1;
  // A new gesture, a pause, or a reversal takes a card at once; otherwise pixels accumulate.
  const fresh = phase === "started" || !state.gesture || now - (state.at ?? 0) > WHEEL_GESTURE_GAP || dir !== state.dir;
  if (fresh) return settle(0, true, dir, move(dir));

  const total = (state.acc ?? 0) - dy;
  if (Math.abs(total) < WHEEL_STEP) return settle(total, true, dir, still);
  // At most one card per event: the rest of a flick is dropped rather than carried.
  return settle(0, true, dir, move(total > 0 ? 1 : -1));
}

// One face slot per terminal (or per session outside Herdr): FNV-1a of the key modulo 24.
// The rail uses the same function on the agent's address, so a card and its rail face match.
export function faceIndex(key) {
  let h = 0x811c9dc5;
  for (const ch of String(key ?? "")) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % FACES;
}

export function toneKey(tone) {
  if (tone === TONE.done) return "done";
  if (tone === TONE.working) return "working";
  if (tone === TONE.stall) return "stall";
  return "needs";
}

// A selected card's accent: amber while the strip has the keyboard, the cool border otherwise.
export function selectedTone(focused) {
  return focused ? { border: INK.amberInk, title: INK.amberInk } : { border: INK.blue, title: INK.t1 };
}

function clean(value) {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().split(/\s+/).join(" ");
  return collapsed || null;
}

function clip(value, limit) {
  const text = clean(value);
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit) : text;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return null;
}

function fold(value) {
  const decomposed = String(value ?? "").normalize("NFKD");
  return Array.from(decomposed).filter((ch) => {
    const code = ch.codePointAt(0);
    return code < 0x300 || code > 0x36f;
  }).join("").toLowerCase();
}

// Shares of `size` sit a little above CoreText measures of Nunito SemiBold 13 and Geist 12 (wide 0.865,
// space/punctuation 0.25, capitals 0.67, digits 0.6), so a kept line still fits before gpui's truncate cuts it.
export function textWidth(text, size) {
  let width = 0;
  for (const ch of String(text ?? "")) {
    const code = ch.codePointAt(0);
    if (code >= 0x2e80) width += size * 0.9;
    else if (/[\s.,:;!'|]/.test(ch)) width += size * 0.3;
    else if (/[A-Z]/.test(ch)) width += size * 0.7;
    else if (/[0-9]/.test(ch)) width += size * 0.62;
    else width += size * 0.55;
  }
  return width;
}

// Lines of `text` at `size` px that fit `width`, at most `lines`; the last one ends in "…" when text is
// left over. gpui clips but has no multi-line ellipsis, so the card cuts its text itself.
export function wrapLines(text, size, width, lines, firstIndent = 0) {
  const source = clean(text);
  if (!source || lines <= 0) return [];
  const all = [];
  let current = "";
  let room = width - firstIndent;
  for (const ch of source) {
    if (textWidth(current + ch, size) <= room) { current += ch; continue; }
    const cut = current.lastIndexOf(" ");
    if (ch !== " " && cut > 0) {
      all.push(current.slice(0, cut));
      current = current.slice(cut + 1) + ch;
    } else {
      all.push(current);
      current = ch === " " ? "" : ch;
    }
    room = width;
  }
  if (current.trim()) all.push(current);
  if (all.length <= lines) return all.map((line) => line.trim());
  const kept = all.slice(0, lines).map((line) => line.trim());
  const lastRoom = lines === 1 ? width - firstIndent : width;
  let last = kept[lines - 1];
  while (last && textWidth(`${last}…`, size) > lastRoom) {
    const cut = last.lastIndexOf(" ");
    last = cut > 0 ? last.slice(0, cut) : last.slice(0, -1);
  }
  kept[lines - 1] = `${last.trimEnd()}…`;
  return kept;
}

// Where a session runs, ticket key first: `app-api-ABC-12` is ABC-12 / api / app. The card
// footer and the rail (through setShared) both use `label`.
export function placeOf(cwd, thread = null) {
  if (thread) return { key: null, rest: null, repo: null, label: THREAD_LABEL, slack: true };
  const parts = String(cwd ?? "").split("/").filter(Boolean);
  if (!parts.length) return { key: null, rest: null, repo: null, label: null, slack: false };
  let repo = null;
  let leaf = parts.at(-1);
  const workspaces = parts.indexOf("workspaces");
  const worktrees = parts.lastIndexOf("worktrees");
  if (workspaces >= 0 && parts[workspaces + 2]) {
    repo = parts[workspaces + 1];
    leaf = parts[workspaces + 2];
  } else if (worktrees >= 2 && parts[worktrees - 1] === ".claude" && parts[worktrees + 1]) {
    repo = parts[worktrees - 2];
    leaf = parts[worktrees + 1];
  } else {
    repo = KNOWN_REPOS.find((name) => leaf.startsWith(`${name}-`)) ?? null;
  }
  const match = leaf.match(KEY_RE);
  if (!match) return { key: null, rest: null, repo, label: leaf, slack: false };
  let rest = leaf.replace(match[1], " ");
  if (repo && rest.startsWith(`${repo}-`)) rest = rest.slice(repo.length + 1);
  rest = rest.split(/[\s-]+/).filter(Boolean).join("-")
    .replace(/(^|-)rd-\d{8}-\d{6}(?=-|$)/, "").replace(/(^|-)(?=[0-9a-f]*[a-f])[0-9a-f]{6}(?=-|$)/, "")
    .replace(/^-+|-+$/g, "") || null;
  return { key: match[1].toUpperCase(), rest, repo, label: [rest, repo].filter(Boolean).join(" · ") || match[1].toUpperCase(), slack: false };
}

// A Slack-thread bot session's folder is named <channel>-<thread seconds>_<fraction>.
export function slackThreadOf(cwd) {
  const match = String(cwd ?? "").split("/").pop().match(/^([A-Z0-9]+)-(\d+)_(\d+)$/);
  return match ? { channel: match[1], ts: `${match[2]}.${match[3]}` } : null;
}

export const LINKS_W = 264;
// The links popup's height: 6 px padding, a 50 px head, 30 px rows, then a separator and "Copy all".
// The checklist row leads the links and brings its own separator when links follow it.
export function linksMenuHeight(count, checklist = false, stop = false) {
  return 6 + 50 + (stop ? 30 + 9 : 0) + (checklist ? 30 + (count ? 9 : 0) : 0) + (count ? count * 30 + 9 + 30 : 30) + 6;
}

// The deadhd plugin's Enable button sends one of these (register.tsx): while a turn runs the prompt is
// queued and tells the skill to leave the checklist off when that work leaves nothing to do.
export const CHECKLIST_PROMPT = "deadhd 스킬로 이 세션의 체크리스트를 띄워 줘.";
export const CHECKLIST_QUEUED_PROMPT = "deadhd 스킬로 이 세션의 체크리스트를 띄워 줘. 이 요청은 앞 작업이 도는 동안 켜기 버튼으로 예약됐어. 그 작업이 끝나 남은 일이 없으면 켜지 말고 한 줄로만 알려 줘.";

// A card's links in the order its menu lists them: ticket, pull requests, Slack thread, pages. `hot` is
// the menu's letter key for the first of each kind.
export function linksOf(item) {
  const links = [];
  if (item.jiraKey && JIRA_BROWSE) links.push({ kind: "jira", label: "Jira ticket", meta: item.jiraKey, url: `${JIRA_BROWSE}${item.jiraKey}`, hot: "j" });
  (item.prLinks ?? []).forEach((pr, i) => links.push({ kind: "pr", label: "Pull request", meta: pr.tag, url: pr.url, hot: i === 0 ? "p" : null }));
  if (item.slack && SLACK_ARCHIVES) {
    links.push({ kind: "slack", label: "Slack thread", meta: item.lane ? `${item.lane} lane` : null,
      url: `${SLACK_ARCHIVES}${item.slack.channel}/p${item.slack.ts.replace(".", "")}`, hot: "s" });
  }
  (item.pages ?? []).filter((page) => page.openable).forEach((page, i) => links.push({ kind: "page", label: page.label || "Page", meta: null, url: page.url, hot: i === 0 ? "g" : null }));
  return links.filter((link) => link.url);
}

// The rail's names for the terminals the cards know: { [address]: { key, rest, topic, slack } }.
export function placesOf(items) {
  const places = {};
  for (const item of items) {
    if (!item.terminal || !item.spot) continue;
    places[item.terminal] = { key: item.spot.key, rest: item.spot.rest, topic: item.topic ?? null, slack: item.spot.slack };
  }
  return places;
}

// A session name someone chose (`claude -n`, `/rename`), not one a launcher generated: those end in
// -MMdd-NN, and the Slack-thread bot's are mv-<thread seconds>.
export function chosenTitle(name) {
  const text = clean(name);
  if (!text || /-(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])-\d{2}$/.test(text) || /^mv-\d+$/.test(text)) return null;
  return text;
}

// A group's lane: the dot colour, the count under it and the tooltip naming the group.
export function laneParts(group) {
  return { color: group.color, count: String(group.count), tip: group.title };
}

export function emptyText(query, filtering) {
  if (query) return "No matching sessions";
  return filtering ? "Nothing in this filter" : "All quiet for now";
}

export function filterGroups(groups, filter) {
  if (!Array.isArray(filter) || !filter.length) return groups;
  return groups.filter((group) => filter.includes(group.id));
}

// The tools role's parts: the branch chip only when the focused pane is on a branch, and the page count.
export function toolsParts(state = {}, branch = "") {
  const pages = Array.isArray(state.pages) ? state.pages : [];
  return { branch: Boolean(branch), pageCount: pages.length + (state.unreadable ?? 0) };
}

// What a session is about, from scan.sh's identity: the handoff it started from, the Slack thread it
// answers, a pasted brief's heading, else the first sentence of its first prompt.
export function topicOf(identity, key = null, objective = null) {
  if (!identity && !objective) return null;
  identity ??= {};
  const first = (value) => String(value).split(/(?<=[.?!])\s/)[0];
  let topic = objective ?? identity.handoff ?? (identity.thread?.topic ? first(identity.thread.topic) : null) ?? identity.paste ?? null;
  if (!topic && identity.firstPrompt) {
    topic = first(String(identity.firstPrompt).replace(/https?:\/\/\S+/g, " ").replace(/\[Image #\d+\]/g, " ").replace(/`/g, "")
      .replace(/(?:~|\/)[\w.-]*(?:\/[\w.-]+){2,}/g, " ").replace(/^\s*\/[\w-]+\s+/, "")
      .split(/\s+/).join(" ").trim().replace(/^(이거|지금|여기|내가|방금|아까)\s+/, ""));
  }
  if (!topic) return null;
  for (const tail of TOPIC_TAILS) topic = topic.replace(tail, "");
  topic = topic.replace(/<@[A-Z0-9]+>/g, "")
    .replace(/\s*(실행|본)?\s*핸드오프\s*$/, "").replace(/\s*\([^)]*(?:\d{4}-\d\d-\d\d|ts \d)[^)]*\)/g, "");
  topic = clean(topic);
  if (topic && key && topic.toUpperCase().startsWith(key)) topic = clean(topic.slice(key.length).replace(/^[\s—:-]+/, ""));
  return topic;
}

// The card footer's place text: a session that is not Claude Code names its agent first.
export function footerOf(item) {
  const place = item.spot?.label ?? item.place ?? "";
  const agent = item.raw?.agent === "codex" ? "Codex" : item.raw?.agent === "gemini" ? "Gemini" : null;
  if (!agent) return place;
  return place ? `${agent} · ${place}` : agent;
}

// A reply as one plain line: links, markdown marks and list bullets go; a bold heading right before a
// list ("**앞으로 할 것** - …") goes, a bold sentence stays.
export function cleanMessage(value) {
  if (typeof value !== "string") return null;
  return clean(value.replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*[^*]+\*\*\s*(?=-\s)/g, "")
    .replace(/\*\*/g, "").replace(/`/g, "")
    .replace(/(^|\s)-\s+/g, "$1"));
}

// The body's height is fixed by a selected card's 2 px border, the tightest case.
export function cardBudget({ topicLines = 0, tray = false, showProgress = false }, g = geometry(1)) {
  const fixed = topicLines * g.TOPIC_LINE + (topicLines ? g.MSG_MT : 0) + g.FOOT_H + g.TRAY_MB
    + (tray ? g.TRAY_H + g.TRAY_MB : 0) + (showProgress ? g.PROGRESS_H + g.PROGRESS_MB : 0);
  return { msgLines: Math.max(0, Math.min(6, Math.floor((g.BODY_H - fixed) / g.MSG_LINE))) };
}

function minutesOf(ms) {
  return Math.max(0, Math.floor(ms / 60000));
}

function shortDuration(ms) {
  const minutes = Math.max(1, Math.floor(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function agoText(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function etaText(eta, now) {
  if (!Number.isFinite(eta)) return null;
  const minutes = Math.ceil((eta - now) / 60000);
  return minutes > 0 ? `~${minutes}m left` : null;
}

function trailingComponent(path) {
  const text = String(path ?? "").replace(/\/+$/, "");
  if (!text) return "";
  const parts = text.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function normalizeLabel(value) {
  return String(value ?? "").toLowerCase().replace(/[-_]/g, "");
}

function ackSession(key) {
  const index = key.lastIndexOf("+");
  return index > 0 ? key.slice(0, index) : key;
}

// The tower's session name: the terminal title without leading symbols, else the tab, else the program.
function agentName(a) {
  const live = String(a.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
  if (live && !/^[~/]/.test(live) && !live.includes("@") && live !== a.program?.name) return live;
  return a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : a.program?.name ?? a.address;
}

const ATTACH_GRACE_MS = 15000;

// The pane already running `claude attach` for a background session, from the scan's view of it.
function attachedFocus(where) {
  if (where.paneId && panes().some((candidate) => candidate.pane === where.paneId)) return { pane: where.paneId };
  if (!where.terminalId || !liveTerminals().some((terminal) => terminal.address === where.terminalId)) return null;
  const pane = panes().find((candidate) => candidate.terminal === where.terminalId);
  return pane ? { pane: pane.pane } : { terminal: where.terminalId };
}

function liveTerminals() {
  return terminals().filter((terminal) => terminal.state === "live" && !String(terminal.address ?? "").includes("/"));
}

// The Herdr terminal a Pulse session runs in: by its foreground pid, else by its terminal id.
// The terminal id comes from HC_TERMINAL_ID, which background daemons and forks inherit from the
// terminal they were started in, so it is trusted only while that terminal still sits in the session's folder:
// its foreground process's cwd, or its own, which Herdr keeps from when the terminal started.
export function terminalOf(raw, live) {
  const byPid = live.find((terminal) => Number(terminal.foreground?.pid) === Number(raw.pid));
  if (byPid) return byPid;
  const id = raw.where?.terminalId;
  const terminal = id ? live.find((candidate) => candidate.address === id) : null;
  const folder = (path) => String(path ?? "").replace(/\/+$/, "");
  const here = [terminal?.foreground?.cwd, terminal?.cwd].filter(Boolean).map(folder);
  return terminal && raw.cwd && here.includes(folder(raw.cwd)) ? terminal : null;
}

// Sending a conversation to the background starts a "bg" session (`jobId`) and leaves the interactive
// record frozen at the hand-off, still "busy", with `parkedJobId` naming that job. The pair is one
// conversation: the background session keeps its id and state, takes the terminal and checklist of
// the record it replaced, and the frozen record is dropped.
export function foldHandoffs(sessions) {
  const jobs = new Map(sessions.filter((raw) => raw.kind === "bg" && raw.jobId).map((raw) => [raw.jobId, raw]));
  const heirs = new Map();
  for (const old of sessions) {
    const bg = old.kind !== "bg" && old.parkedJobId ? jobs.get(old.parkedJobId) : null;
    if (bg && !heirs.has(bg)) heirs.set(bg, old);
  }
  if (!heirs.size) return sessions;
  const replaced = new Set(heirs.values());
  return sessions.filter((raw) => !replaced.has(raw)).map((raw) => {
    const old = heirs.get(raw);
    return old ? { ...raw, where: old.where ?? raw.where, deadhd: raw.deadhd ?? old.deadhd } : raw;
  });
}

export const HISTORY_MAX = 50;
const NAV_SETTLE_MS = 1000;

// The terminals visited, in visit order; list[at] is where the user is and the entries after it are the forward ones.
export function visitHistory(history, terminal) {
  if (!terminal || history.list[history.at] === terminal) return history;
  let list = [...history.list.slice(0, history.at + 1), terminal];
  if (list.length > HISTORY_MAX) list = list.slice(list.length - HISTORY_MAX);
  return { list, at: list.length - 1 };
}

// A dead terminal is skipped rather than stopping the walk: the person asked for the previous one still open.
export function stepHistory(history, delta, alive) {
  const { list, at } = history;
  for (let index = at + delta; index >= 0 && index < list.length; index += delta) {
    const terminal = list[index];
    if (alive.has(terminal) && terminal !== list[at]) return { history: { list, at: index }, target: terminal };
  }
  return { history, target: null };
}

// The fade is as wide as the strip's end padding, so it covers only empty canvas until a card scrolls under it.
function edgeFade(side, width) {
  const rect = PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
  const [from, to] = side === "left" ? [INK.surface, `${INK.surface}00`] : [`${INK.surface}00`, INK.surface];
  // Kept 12 px off the top and bottom so its square fill stays clear of the panel's rounded corners.
  return div().absolute().top(12).bottom(12)[side](0).w(width)
    .child(window.paint_path(rect, Background.linear_gradient(90, from, to)).absolute().top(0).left(0).size_full());
}

function backgroundLabel(counts) {
  if (!counts) return null;
  const parts = [];
  if (counts.shells > 0) parts.push(`${counts.shells} shell${counts.shells === 1 ? "" : "s"}`);
  if (counts.agents > 0) parts.push(`${counts.agents} agent${counts.agents === 1 ? "" : "s"}`);
  if (counts.monitors > 0) parts.push(`${counts.monitors} monitor${counts.monitors === 1 ? "" : "s"}`);
  return parts.length ? parts.join(" · ") : null;
}

function dot(color, size) {
  return div().size(size).flex_none().rounded(size / 2).bg(color);
}

function keycap(label, k = 1) {
  const g = geometry(k);
  return h_flex().h(g.KEYCAP_H).min_w(g.KEYCAP_H).px(g.KEYCAP_PAD).rounded(g.KEYCAP_RADIUS).border(1).border_color(INK.line).bg(INK.surface)
    .items_center().justify_center()
    .child(div().text_size(g.TEXT.keycap).font_family(FONT).font_bold().text_color(INK.t2).child(label));
}

function pageIcon(size, color = INK.t3) {
  return svg("mods/workspace-chrome/file-text.svg").size(size).flex_none().text_color(color);
}

// Opens a page URL, then deletes the alert files behind it. Resolves true when it opened.
async function openPageFiles(page) {
  let opened = false;
  try {
    const result = await exec("open", [page.url]);
    opened = result.code === 0;
  } catch {}
  if (!opened) return false;
  try {
    await exec("rm", ["-f", ...(page.files ?? [])]);
  } catch {}
  return true;
}

export default class CozyOffice extends View {
  init(_props, cx) {
    this.role = props()?.role ?? "cards";
    this.demo = Boolean(props()?.demo);
    if (this.role === "strip") {
      // The office shows only as the PiP window, which this copy keeps open. shared() outlives the
      // app, and a PiP turned off by an older version would leave no window, so it is turned on here.
      setPip(true, this.demo);
      // A preview picture can ask for the window's size and a person framed in it.
      if (this.demo && props()?.size) setPipSize(props().size, true);
      // The terminal font and back/forward keys are answered here: this copy lives as long as the app,
      // while the window copy reopens on every move and would lose the visit history.
      this.history = { list: [], at: -1 };
      this.navTarget = null;
      cx.spawn(async () => {
        for (;;) await this.stripCommand(await nextCommand());
      });
      cx.timer.every(200, () => {
        this.ensurePip();
        this.trackVisit();
      });
      this.ensurePip();
      return;
    }
    if (this.role === "links") {
      this.handle = cx.focus_handle();
      this.active = 0;
      this.error = null;
      this.stopError = null;
      // Focus can't change during render; the timer catches the popup once it is on screen.
      this.handle.focus();
      cx.timer.after(50, () => this.handle.focus());
      return;
    }
    this.handle = cx.focus_handle();
    this.camFocus = false;
    this.stage = null;
    this.showAllDoneInOffice = true;
    this.scroll = VirtualListScrollHandle.new();
    this.wheel = { acc: 0, index: 0, off: 0, at: 0, gesture: false, dir: 0 };
    this.lastFlash = shared(FLASH_KEY)?.token ?? null;
    this.lastNoticeAct = shared(NOTICE_ACT_KEY)?.token ?? null;
    this.blockHeight = null;
    this.k = 1;
    this.geo = geometry(1);
    this.sessions = [];
    this.meta = { roots: 0, pages: [], unreadablePages: [] };
    this.err = null;
    this.notice = null;
    this.sel = null;
    this.selIndex = 0;
    // The preview can open framed on one demo person (build-layout.py --focus <id>).
    const focus = this.demo ? demoFocus(props()?.focus) : null;
    if (focus) {
      this.sel = focus;
      this.camFocus = true;
    }
    this.handoff = false;
    this.doneCursor = null;
    this.query = "";
    this.expanded = new Set();
    this.stepTop = {};
    this.replyCursor = null;
    this.noticeAction = null;
    this.showAllDone = false;
    this.showKeys = false;
    this.snoozed = {};
    this.since = {}; // agent address -> { s, at }: when this view saw its status change
    this.seen = this.loadSeen();
    this.viewed = this.loadViewed();
    // Marks kept only in this copy's localStorage move to shared() before the PiP copy can save over them.
    if (this.role !== "pip" && !this.demo) {
      if (!strings(shared(SEEN_SHARED))) setShared(SEEN_SHARED, this.seen);
      if (!strings(shared(VIEWED_SHARED))) setShared(VIEWED_SHARED, this.viewed);
    }
    this.scanning = false;
    this.published = null;
    this.history = { list: [], at: -1 };
    this.navTarget = null;
    if (this.role === "pip") {
      // The window copy's own state: the app window size it last saw, the place it was opened at,
      // and the place a pointer last put it (kept here until it settles, then written to shared()).
      this.vp = null;
      this.vpAt = Date.now();
      const at = props()?.at;
      this.shownAt = at && Number.isFinite(at.x) && Number.isFinite(at.y) ? { x: at.x, y: at.y } : null;
      this.seenAt = null;
      this.seenAtAt = 0;
      // A window opened for a grip drag carries the drag it must continue; a drag without the place
      // it started from keeps its rect as that place.
      const resize = props()?.resize;
      this.pipDrag = resize && typeof resize === "object" && resize.corner && resize.anchor && resize.grab && resize.canvas && resize.rect
        ? { ...resize, from: resize.from ?? { x: resize.rect.x, y: resize.rect.y } } : null;
      // A window reopened for a grip drag opens under the pointer, which sends no hover until it moves.
      this.pipHover = Boolean(this.pipDrag);
      this.dragAt = this.pipDrag ? Date.now() : null;
      this.dragHeard = false;
      const hand = takeLook("pip", this.demo);
      if (hand) this.look = hand.look;
      pipBeat(this.demo, Date.now());
    }
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (this.role === "pip") {
          // ctrl-alt-p while PiP shows: the window takes the keyboard or gives it back.
          if (command === "toggle" && this.pipShown()) {
            if (this.handle.is_focused()) this.leaveKeys();
            else this.grabKeys(cx);
            cx.notify();
          } else if (command === "focus") {
            // A window copy that is not showing hands the keyboard to the side now shown.
            if (this.pipShown()) this.grabKeys(cx);
            else handKeys(pipOn(this.demo) ? "pip" : "office", this.demo, null);
            cx.notify();
          } else if (PIP_COMMANDS[command] && this.pipShown()) {
            // The same moves and sizes as ⌥ + an arrow and −/= while PiP has the keyboard, for keys.json.
            const [kind, arg] = PIP_COMMANDS[command];
            if (kind === "move") this.pipMove(arg);
            else this.pipResize(arg);
            cx.notify();
          } else if (LOOK_COMMANDS.has(command) && this.pipShown() && lookCommand(this, command)) cx.notify();
          continue;
        }
        if ((command === "toggle" || LOOK_COMMANDS.has(command)) && pipOn(this.demo)) continue;
        if (LOOK_COMMANDS.has(command)) {
          if (lookCommand(this, command)) cx.notify();
          continue;
        }
        if (command === "focus") {
          if (this.sceneShown()) this.grabKeys(cx);
          else handKeys(pipOn(this.demo) ? "pip" : "office", this.demo, null);
          cx.notify();
        } else if (command === "toggle") {
          // Bound to ctrl-alt-p by the "layout:cozy-office" section of keys.json (see README).
          if (this.handle.is_focused()) this.leaveKeys();
          else this.grabKeys(cx);
          cx.notify();
        }
      }
    });
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    // Herdr's pane.go moves focus without notifying this view.
    cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchFocus(cx));
    this.poll(cx);
  }

  // The block's height is the strip row's, so the strip and its text scale with it.
  sizeChanged(size, cx) {
    if (!(size.height > 0)) return;
    const z = zoomOf();
    const stage = { w: Math.round(size.width / z), h: Math.round(size.height / z) };
    const stageMoved = !this.stage || stage.w !== this.stage.w || stage.h !== this.stage.h;
    this.stage = stage;
    const k = cardsScale(size.height / z);
    const height = Math.round(k * BASE_BLOCK_H);
    if (height === this.blockHeight && !stageMoved) return;
    this.blockHeight = height;
    this.k = k;
    this.geo = geometry(this.k);
    cx.notify();
  }

  // The strip copy's commands from the "layout:cozy-office" section of keys.json: cmd-=/cmd-+, cmd--
  // and cmd-0 change the terminals' text size, cmd-[ / cmd-] stand in for agent.prev / agent.next.
  async stripCommand(command) {
    if (command === "font_in" || command === "font_out" || command === "font_reset") await this.changeTermFont(command);
    else if (command === "back" || command === "forward") this.navigate(command === "back" ? -1 : 1);
  }

  // settings.json is the person's file; a stale snapshot is retried like Herdr's Settings does.
  async changeTermFont(command) {
    const file = `${appHome()}/settings.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await readTextFile(file);
        const person = raw ? JSON.parse(raw) : {};
        const next = nextSettings(person, command, Number(settings()?.font_size) || TERM_FONT);
        if (!next) return;
        await writeTextFile(file, JSON.stringify(next, null, 2) + "\n", raw);
        return;
      } catch {}
    }
  }

  loadSeen() {
    const common = strings(shared(SEEN_SHARED));
    if (common) return common;
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((key) => typeof key === "string") : [];
    } catch {
      return [];
    }
  }

  saveSeen() {
    setShared(SEEN_SHARED, this.seen);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(this.seen));
    } catch {}
  }

  loadViewed() {
    const common = strings(shared(VIEWED_SHARED));
    if (common) return common;
    try {
      const raw = localStorage.getItem(VIEWED_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter((key) => typeof key === "string") : [];
    } catch {
      return [];
    }
  }

  // Whether a finished session was looked at. Herdr answers for any terminal it has a status for:
  // "done" until someone looks at that terminal on any client, then "idle", the same word other
  // layouts show. The local list answers only for sessions Herdr has no status for.
  viewedOf(ackKey, terminal, list = agents()) {
    const status = terminal ? list.find((entry) => entry.address === terminal)?.status : null;
    if (status === "done") return false;
    if (status === "idle") return true;
    return this.viewed.includes(ackKey);
  }

  saveViewed() {
    setShared(VIEWED_SHARED, this.viewed);
    try {
      localStorage.setItem(VIEWED_KEY, JSON.stringify(this.viewed));
    } catch {}
  }

  poll(cx) {
    if (this.scanning || this.demo) return;
    if (this.role === "pip" && !this.pipShown()) return;
    this.scanning = true;
    cx.spawn(async (cx) => {
      let error = null;
      let sessions = this.sessions;
      let meta = this.meta;
      try {
        const result = await exec("sh", [`${appHome()}/mods/cozy-office/scan.sh`]);
        if (result.code !== 0) {
          throw new Error((result.stderr || result.stdout || "").trim() || `scan.sh exited ${result.code}`);
        }
        const parsed = this.parseScan(result.stdout ?? "");
        if (!parsed.meta) throw new Error("scan.sh returned no meta line");
        sessions = parsed.sessions;
        meta = parsed.meta;
      } catch (error_) {
        error = String(error_?.message ?? error_);
      }
      this.scanning = false;
      if (error) {
        this.err = String(error).replace(/\.$/, "");
      } else {
        this.err = meta.error ? String(meta.error).replace(/\.$/, "") : null;
        this.sessions = sessions;
        this.meta = meta;
        this.pruneSeen();
      }
      cx.notify();
    });
  }

  parseScan(output) {
    const sessions = [];
    let meta = null;
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      if (value?.t === "s") sessions.push(value);
      else if (value?.t === "meta") meta = value;
    }
    return { sessions, meta };
  }

  pruneSeen() {
    const live = new Set(this.sessions.map((session) => session.sessionId));
    for (const a of agents()) live.add(`agent:${a.address}`);
    const kept = this.seen.filter((key) => live.has(ackSession(key)));
    if (kept.length !== this.seen.length) {
      this.seen = kept;
      this.saveSeen();
    }
    const viewed = this.viewed.filter((key) => live.has(ackSession(key)));
    if (viewed.length !== this.viewed.length) {
      this.viewed = viewed;
      this.saveViewed();
    }
  }

  flash(cx, message, action = null, ms = 4000) {
    const token = {};
    this.notice = message;
    this.noticeAction = action;
    this.noticeToken = token;
    cx.notify();
    cx.timer.after(ms, (later) => {
      if (this.noticeToken === token) {
        this.notice = null;
        this.noticeAction = null;
        later.notify();
      }
    });
  }

  undoNotice() {
    if (!this.noticeAction) return;
    this.noticeAction.run();
    this.notice = null;
    this.noticeAction = null;
  }

  // Herdr agents Pulse doesn't list, as cards: blocked -> Needs you, working -> Working,
  // done and idle -> Done. Claude Code agents are left to Pulse's own rows.
  agentItems(now, claimed) {
    const items = [];
    const list = agents();
    const present = new Set(list.map((a) => a.address));
    for (const address of Object.keys(this.since)) if (!present.has(address)) delete this.since[address];
    for (const a of list) {
      if (this.since[a.address]?.s !== a.status) this.since[a.address] = { s: a.status, at: now };
      if (claimed.has(a.address) || a.app === "claude-code") continue;
      const group = a.status === "blocked" ? "attention" : a.status === "working" ? "working" : "done";
      const since = this.since[a.address].at;
      const sessionId = `agent:${a.address}`;
      const ackKey = `${sessionId}+${a.seq}`;
      items.push({
        sessionId,
        pid: null,
        agent: a,
        raw: { status: a.status, cwd: null, name: agentName(a) },
        bucket: group === "attention" ? "wait" : group,
        group,
        title: clip(agentName(a), 60) ?? a.address,
        since,
        updatedAt: since,
        sortDate: since,
        place: clip(a.space_name, 40),
        spot: { key: null, rest: null, repo: null, label: clip(a.space_name, 40), slack: false },
        topic: null,
        round: null,
        lane: null,
        keyTag: null,
        jiraKey: null,
        prTag: null,
        extraPRs: [],
        prLinks: [],
        slack: null,
        hasChecklist: false,
        counts: null,
        total: null,
        progress: null,
        stepStates: null,
        steps: [],
        progressStale: false,
        blocked: group === "attention",
        eta: null,
        nowLabel: null,
        nowLine: a.program?.name ? `${a.program.name} is working` : null,
        answer: "Waiting for your reply",
        prompt: null,
        replyTail: null,
        lastSentence: null,
        background: null,
        pages: [],
        where: { kind: "herdr", terminalId: a.address },
        terminal: a.address,
        ackKey,
        viewed: this.viewedOf(ackKey, a.address, list),
        badge: "herdr",
        charKey: a.address,
      });
    }
    return items;
  }

  buildModel(now) {
    if (this.demo) return demoModel(now);
    // Another copy may have marked sessions since this one loaded.
    this.seen = strings(shared(SEEN_SHARED)) ?? this.seen;
    this.viewed = strings(shared(VIEWED_SHARED)) ?? this.viewed;
    const seen = new Set(this.seen);
    const live = liveTerminals();
    const claimed = new Set();
    const items = [];
    for (const raw of foldHandoffs(this.sessions)) {
      const deadhd = raw.deadhd ?? null;
      const hasChecklist = Boolean(deadhd && !deadhd.off && deadhd.counts && (deadhd.total ?? 0) > 0);
      const counts = hasChecklist ? deadhd.counts : null;
      const background = raw.background ?? { shells: 0, agents: 0, monitors: 0, total: 0 };
      const terminal = terminalOf(raw, live);
      if (terminal) claimed.add(terminal.address);

      let bucket;
      if (raw.status === "waiting") bucket = "wait";
      else if (raw.status === "busy") {
        const hasBackground = (background.total ?? 0) > 0;
        const last = raw.lastMeaningfulAt;
        bucket = !hasBackground && last && now - last > STALL_MS ? "stall" : "working";
      } else if (raw.status === "shell") {
        bucket = (counts?.blocked ?? 0) > 0 ? "wait" : "working";
      } else if (raw.status === "idle") {
        bucket = "done";
      } else {
        bucket = "working";
      }
      // A native agent's approval prompt is never on disk; when the agent reports to Herdr, its
      // blocked status is what tells us the session is waiting for the person.
      if (raw.agent && raw.agent !== "claude" && terminal) {
        const spoke = agents().find((entry) => entry.address === terminal.address);
        if (spoke?.status === "blocked") bucket = "wait";
      }

      let group = bucket === "wait" || bucket === "stall" ? "attention" : bucket === "done" ? "done" : "working";
      if (group === "attention" && bucket === "stall" && (this.snoozed[raw.sessionId] ?? 0) > now) {
        group = "working";
      }

      const since = raw.statusUpdatedAt ?? raw.startedAt ?? null;
      const updatedAt = Math.max(raw.statusUpdatedAt ?? 0, raw.lastMeaningfulAt ?? 0) || null;
      const title = clip(firstNonEmpty(
        hasChecklist ? deadhd.title : null,
        raw.customTitle,
        raw.agentName,
        raw.name,
        raw.lastPrompt ? clip(raw.lastPrompt, 60) : null,
      ), 60) ?? "Untitled session";

      const location = clip(raw.location, 40);
      const place = location && normalizeLabel(location) !== normalizeLabel(title) ? location : null;
      const keyTag = deadhd?.key && deadhd.key.toLowerCase() !== title.trim().toLowerCase() ? deadhd.key : null;
      const identity = raw.identity ?? null;
      const spot = placeOf(raw.cwd, identity?.thread ?? null);
      if (!spot.key && !spot.slack && deadhd?.key) spot.key = String(deadhd.key).toUpperCase();
      const topic = clip(firstNonEmpty(chosenTitle(raw.customTitle), hasChecklist ? deadhd.title : null, topicOf(identity, spot.key, spot.key ? this.meta?.objectives?.[spot.key] : null)), 120);
      const round = spot.key && Number.isFinite(identity?.round) ? identity.round : null;
      const lane = clean(identity?.thread?.lane);

      const prs = [];
      if (hasChecklist && deadhd.pr?.href) {
        prs.push({ url: deadhd.pr.href, label: deadhd.pr.text ?? null, number: deadhd.pr.number ?? 0 });
      }
      if (raw.pr?.url && !prs.some((pr) => pr.url === raw.pr.url)) {
        prs.push({ url: raw.pr.url, label: raw.pr.label ?? null, number: raw.pr.number ?? 0 });
      }
      const prRepo = (url) => String(url ?? "").split("/")[4] ?? null;
      const prTag = prs[0] ? (prs[0].label ?? (prs[0].number
        ? `${spot.repo && prRepo(prs[0].url) && prRepo(prs[0].url) !== spot.repo ? prRepo(prs[0].url) : ""}#${prs[0].number}`
        : null)) : null;
      const extraPRs = prs.slice(1).map((pr) => pr.label ?? (pr.number ? `#${pr.number}` : pr.url)).filter(Boolean);

      const progress = hasChecklist && (deadhd.total ?? 0) > 0
        ? { done: Math.max(0, counts.done), total: deadhd.total }
        : null;
      const steps = hasChecklist && Array.isArray(deadhd.items) ? deadhd.items : [];
      const eta = hasChecklist && Number.isFinite(deadhd.eta) ? etaText(deadhd.eta, now) : null;
      const nowLabel = clean(hasChecklist ? deadhd.nowLabel : null);
      const currentAction = clean(raw.currentAction);
      const lastSentence = clean(raw.lastSentence);
      let nowLine = null;
      if (nowLabel) nowLine = `▶ ${nowLabel}`;
      else if (currentAction) nowLine = currentAction;
      else if (lastSentence) nowLine = lastSentence;

      let answer;
      if (bucket === "stall") {
        const quiet = Math.max(1, minutesOf(now - (raw.lastMeaningfulAt ?? since ?? now)));
        answer = `No new activity for ${quiet} minute${quiet === 1 ? "" : "s"}. Check whether it is stuck`;
      } else if (hasChecklist && (counts?.blocked ?? 0) > 0 && deadhd.blockedAsk) {
        answer = deadhd.blockedAsk;
      } else {
        answer = clean(raw.lastAnswer)
          ?? (raw.waitingFor === "permission prompt" ? "Waiting for permission approval" : "Waiting for your reply");
      }

      const pages = Array.isArray(raw.pages) ? raw.pages : [];
      const ackKey = `${raw.sessionId}+${since != null ? Math.floor(since / 1000) : "none"}`;
      const sortDate = since ?? updatedAt;

      if (group === "done" && seen.has(ackKey)) continue;

      items.push({
        sessionId: raw.sessionId,
        pid: raw.pid,
        raw,
        bucket,
        group,
        title,
        since,
        updatedAt,
        sortDate,
        place,
        spot,
        topic,
        round,
        lane,
        keyTag,
        jiraKey: deadhd?.key ?? spot.key ?? null,
        prTag,
        extraPRs,
        prLinks: prs.map((pr, i) => ({ url: pr.url, tag: (i === 0 ? prTag : extraPRs[i - 1]) ?? pr.url })),
        slack: spot.slack ? slackThreadOf(raw.cwd) : null,
        hasChecklist,
        counts,
        total: deadhd?.total ?? null,
        progress,
        stepStates: deadhd?.states ?? null,
        steps,
        progressStale: Boolean(deadhd?.dataAt && now - deadhd.dataAt > STALE_MS),
        blocked: (counts?.blocked ?? 0) > 0,
        eta,
        nowLabel,
        nowLine,
        answer,
        replyTail: clean(raw.lastAnswer),
        lastSentence,
        background,
        pages,
        where: raw.where ?? {},
        ackKey,
        viewed: this.viewedOf(ackKey, terminal?.address ?? null),
        badge: BADGES[raw.where?.kind] ?? null,
        terminal: terminal?.address ?? null,
        charKey: terminal?.address ?? raw.sessionId,
        backgrounded: raw.kind === "bg" && !attachedFocus(raw.where ?? {}),
      });
    }

    for (const item of this.agentItems(now, claimed)) {
      if (item.group === "done" && seen.has(item.ackKey)) continue;
      items.push(item);
    }

    const sortAsc = (a, b) => {
      if (a.sortDate == null && b.sortDate == null) return a.sessionId < b.sessionId ? -1 : 1;
      if (a.sortDate == null) return 1;
      if (b.sortDate == null) return -1;
      if (a.sortDate !== b.sortDate) return a.sortDate - b.sortDate;
      return a.sessionId < b.sessionId ? -1 : 1;
    };
    const sortDesc = (a, b) => {
      if (a.sortDate == null && b.sortDate == null) return a.sessionId < b.sessionId ? -1 : 1;
      if (a.sortDate == null) return 1;
      if (b.sortDate == null) return -1;
      if (a.sortDate !== b.sortDate) return b.sortDate - a.sortDate;
      return a.sessionId < b.sessionId ? -1 : 1;
    };

    // Replies first, then stalls, so Space (which skips stalls) always starts at the leftmost card.
    const stalled = (item) => (item.bucket === "stall" ? 1 : 0);
    const attention = items.filter((item) => item.group === "attention").sort((a, b) => stalled(a) - stalled(b) || sortAsc(a, b));
    const working = items.filter((item) => item.group === "working").sort(sortAsc);
    const done = items.filter((item) => item.group === "done").sort(sortDesc);
    return {
      attention,
      working,
      done,
      counts: { attention: attention.length, working: working.length, done: done.length },
    };
  }

  matches(item, tokens) {
    if (!tokens.length) return true;
    const fields = [
      item.title,
      item.topic,
      item.place,
      item.spot?.label,
      trailingComponent(item.raw.cwd),
      item.raw.name,
      item.keyTag,
      item.jiraKey,
      item.prTag,
      ...item.extraPRs,
    ].filter(Boolean).map(fold);
    return tokens.every((token) => fields.some((field) => field.includes(token)));
  }

  viewData(now = Date.now()) {
    const model = this.buildModel(now);
    this.places = placesOf([...model.attention, ...model.working, ...model.done]);
    const tokens = fold(this.query).split(/\s+/).filter(Boolean);
    const filter = (list) => (tokens.length ? list.filter((item) => this.matches(item, tokens)) : list);
    const attention = filter(model.attention);
    const working = filter(model.working);
    const doneAll = filter(model.done);
    const doneVisible = this.showAllDone || this.showAllDoneInOffice || tokens.length ? doneAll : doneAll.slice(0, MAX_DONE);
    const hiddenDone = doneAll.length - doneVisible.length;
    const groups = [
      { id: "attention", title: GROUP_TITLE.attention, color: GROUP_COLOR.attention, items: attention, count: attention.length },
      { id: "working", title: GROUP_TITLE.working, color: GROUP_COLOR.working, items: working, count: working.length },
      { id: "done", title: GROUP_TITLE.done, color: GROUP_COLOR.done, items: doneVisible, count: doneAll.length },
    ];
    const shown = filterGroups(groups, shared("cozy-filter"));
    const doneShown = shown.some((group) => group.id === "done");
    return { model, groups: shown, allGroups: groups, hiddenDone: doneShown ? hiddenDone : 0, now, counts: model.counts };
  }

  stepWindow(steps) {
    const states = steps.map((step) => step.state);
    const total = states.length;
    const first = (state) => { const at = states.indexOf(state); return at >= 0 ? at : null; };
    const focus = first("now") ?? first("side") ?? first("blocked") ?? first("left") ?? total - 1;
    return { total, focus };
  }

  stepMaxTop(item) {
    return Math.max(0, item.steps.length - STEP_ROWS);
  }

  openSteps(item) {
    const { focus } = this.stepWindow(item.steps);
    this.stepTop[item.sessionId] = Math.min(Math.max(focus - 1, 0), this.stepMaxTop(item));
    this.expanded.add(item.sessionId);
  }

  scrollSteps(item, delta) {
    const top = this.stepTop[item.sessionId] ?? 0;
    this.stepTop[item.sessionId] = Math.max(0, Math.min(this.stepMaxTop(item), top + delta));
  }

  // A checklist can lose steps while the column is open, so the top is clamped here too.
  visibleSteps(item) {
    const top = Math.min(this.stepTop[item.sessionId] ?? 0, this.stepMaxTop(item));
    return item.steps.slice(top, top + STEP_ROWS);
  }

  stepCounter(item) {
    const shown = this.visibleSteps(item).length;
    if (shown >= item.steps.length) return null;
    const top = Math.min(this.stepTop[item.sessionId] ?? 0, this.stepMaxTop(item));
    return `${top + 1}–${top + shown} / ${item.steps.length}`;
  }

  // The strip's items, left to right: one per card plus a "N more" tile after Done. Each
  // carries its width (its left gap included) so the virtual list can place it.
  buildStrip(data) {
    const g = this.geo ?? geometry(1);
    const strip = [];
    let firstGroup = true;
    for (const group of data.groups) {
      if (!group.items.length) continue;
      group.items.forEach((item, index) => {
        const lead = index > 0 ? g.CARD_GAP : firstGroup ? g.PAD_X : g.GROUP_GAP;
        const lane = index === 0 ? g.LANE_W : 0;
        const open = this.expanded.has(item.sessionId) && item.steps.length > 0;
        strip.push({
          kind: "card", item, group, head: index === 0, lead: lead + lane,
          w: lead + lane + g.CARD_W + (open ? g.STEPS_W : 0), key: `card-${item.sessionId}`,
        });
      });
      if (group.id === "done" && data.hiddenDone > 0) {
        strip.push({ kind: "more", group, head: false, lead: g.CARD_GAP, w: g.CARD_GAP + g.MORE_W, key: "more-done", count: data.hiddenDone });
      }
      firstGroup = false;
    }
    if (strip.length) strip[strip.length - 1].w += g.PAD_X;
    return strip;
  }

  focusKey() {
    return `${Boolean(this.handle?.is_focused?.())}|${focused()?.terminal ?? ""}`;
  }

  watchFocus(cx) {
    this.trackVisit();
    this.followScene();
    if (this.role === "pip") this.pipTick(cx);
    else this.ensurePip();
    if (this.focusKey() !== this.drawnFocus) cx.notify();
    // A page chip with nothing to open hands its notice here through the shared flash.
    const flash = shared(FLASH_KEY);
    if (flash?.token && flash.token !== this.lastFlash) {
      this.lastFlash = flash.token;
      this.flash(cx, flash.message);
    }
    const noticeAct = shared(NOTICE_ACT_KEY);
    if (noticeAct?.token && noticeAct.token !== this.lastNoticeAct) {
      this.lastNoticeAct = noticeAct.token;
      if (noticeAct.act === "retry") {
        this.err = null;
        this.poll(cx);
      } else if (noticeAct.act === "undo") {
        this.undoNotice();
      }
      cx.notify();
    }
  }

  // After a back/forward, the terminal being left can still show as focused for a few watches; recording it
  // would drop the forward entries. So until the target shows (or NAV_SETTLE_MS passes) nothing is recorded.
  trackVisit(now = Date.now()) {
    const terminal = focused()?.terminal ?? null;
    if (!terminal) return;
    if (this.navTarget) {
      if (terminal === this.navTarget) {
        this.navTarget = null;
        return;
      }
      if (now < this.navUntil) return;
      this.navTarget = null;
    }
    this.history = visitHistory(this.history, terminal);
  }

  navigate(delta) {
    const alive = new Set(liveTerminals().map((terminal) => terminal.address));
    const { history, target } = stepHistory(this.history, delta, alive);
    if (!target) return;
    this.history = history;
    this.navTarget = target;
    this.navUntil = Date.now() + NAV_SETTLE_MS;
    run("pane.focus", { terminal: target });
  }

  // While the strip doesn't have the keyboard, the selection moves to the card of the pane that just took focus.
  // A pane whose card hasn't been scanned yet stays pending, so the card is chosen once it appears.
  followFocus(data) {
    const terminal = focused()?.terminal ?? null;
    if (terminal === this.followed) return;
    if (!terminal || this.handle?.is_focused()) {
      this.followed = null;
      return;
    }
    const item = data.groups.flatMap((group) => group.items).find((row) => row.terminal === terminal);
    if (!item) return;
    this.followed = terminal;
    this.markViewed(item);
    this.sel = item.sessionId;
    this.reveal(item.sessionId, data);
  }

  selectedItem(data) {
    const rows = data.groups.flatMap((group) => group.items);
    if (this.sel === NONE) return null;
    // Nothing chosen yet starts at the first card. A card dismissed from the strip, or filtered out by the
    // search, hands the selection to the card now in its place; a card whose session ended on its own leaves nothing selected, so no other session looks
    // like the one closing.
    const kept = rows.find((item) => item.sessionId === this.sel);
    if (kept || !(this.sel == null || this.handoff || this.query)) return kept ?? null;
    return rows[Math.min(this.selIndex, rows.length - 1)] ?? null;
  }

  reveal(sessionId, data) {
    const strip = this.buildStrip(data);
    const index = strip.findIndex((entry) => entry.kind === "card" && entry.item.sessionId === sessionId);
    if (index < 0) return;
    this.scroll.scroll_to_item(index, "center");
    // Centring moves the left edge; the wheel continues from the offset it lands on.
    if (!this.wheel) return;
    const widths = strip.map((entry) => entry.w);
    const centered = centeredOffset(index, widths, this.wheel.viewportW);
    if (centered == null) {
      this.wheel.index = index;
      return;
    }
    this.wheel.off = centered;
    this.wheel.index = leftIndexAt(centered, widths);
  }

  markViewed(item) {
    if (!item || item.group !== "done") return false;
    if (this.viewed.includes(item.ackKey)) return false;
    this.viewed = [...this.viewed, item.ackKey];
    this.saveViewed();
    return true;
  }

  markSeen(item, cx) {
    if (!item || item.group !== "done") return false;
    if (this.seen.includes(item.ackKey)) return false;
    this.seen = [...this.seen, item.ackKey];
    this.saveSeen();
    const key = item.ackKey;
    if (cx) this.flash(cx, "Marked as seen", { label: "Undo", run: () => {
      this.seen = this.seen.filter((candidate) => candidate !== key);
      this.saveSeen();
    } }, UNDO_MS);
    return true;
  }

  acknowledge(item, cx) {
    if (!item) return;
    let left = false;
    if (item.group === "done") left = this.markSeen(item, cx);
    else if (item.group === "attention" && item.bucket === "stall") left = this.snooze(item);
    if (left && item.sessionId === this.sel) this.handoff = true;
  }

  // Space: the session that has waited longest for a reply, cycling on repeat; stalls are skipped.
  // Shift+Space: every Done card from the right end (the oldest) leftward, cycling on repeat, viewed or
  // not. Dimming only marks a card as opened; ⌫ is what takes one out of the cycle.
  jump(kind, data, cx) {
    let target = null;
    if (kind === "reply") {
      const candidates = data.model.attention.filter((item) => item.bucket !== "stall");
      if (candidates.length) {
        const at = candidates.findIndex((item) => item.sessionId === this.replyCursor);
        target = at < 0 ? candidates[0] : candidates[(at + 1) % candidates.length];
        this.replyCursor = target.sessionId;
      }
    } else {
      const candidates = [...data.model.done].reverse();
      if (candidates.length) {
        const at = candidates.findIndex((item) => item.sessionId === this.doneCursor);
        target = at < 0 ? candidates[0] : candidates[(at + 1) % candidates.length];
        this.doneCursor = target.sessionId;
      }
    }
    if (!target) {
      this.flash(cx, kind === "reply" ? "No session is waiting for a reply — check back later" : "No finished session — finish a turn first");
      return;
    }
    this.goTo(target, cx);
    if (kind === "done") this.showAllDone = true;
    this.sel = target.sessionId;
    this.reveal(target.sessionId, data);
  }

  snooze(item) {
    if (!item || item.bucket !== "stall") return false;
    this.snoozed[item.sessionId] = Date.now() + SNOOZE_MS;
    return true;
  }

  goTo(item, cx) {
    if (!item) return;
    // The person chose to leave the scene, so the catch does not pull the keyboard back.
    this.keysWanted = false;
    this.backPane = null;
    if (item.group === "done") this.markViewed(item);
    if (item.agent) {
      run("pane.focus", { pane: item.agent.pane });
      return;
    }
    const terminal = terminalOf(item.raw ?? item, liveTerminals());
    if (terminal) {
      const pane = panes().find((candidate) => candidate.terminal === terminal.address);
      run("pane.focus", pane ? { pane: pane.pane } : { terminal: terminal.address });
      return;
    }
    const where = item.where ?? {};
    if (where.kind === "claude-bg") {
      const focus = attachedFocus(where);
      if (focus) {
        run("pane.focus", focus);
        return;
      }
      // The scan that would report the new attach pane runs seconds later; a second click meanwhile must not open another.
      const opened = this.attachOpened?.[where.attachId];
      if (opened && Date.now() - opened < ATTACH_GRACE_MS) return;
      this.attachOpened = { ...this.attachOpened, [where.attachId]: Date.now() };
      run("pane.split", { direction: "right", argv: ["claude", "attach", where.attachId] });
      return;
    }
    if (where.kind === "tmux" && where.paneId) {
      const base = where.socket ? ["-S", where.socket] : [];
      const calls = [
        ["switch-client", "-t", where.paneId],
        ["select-window", "-t", where.paneId],
        ["select-pane", "-t", where.paneId],
      ];
      cx.spawn(async () => {
        for (const call of calls) {
          try {
            await exec("tmux", [...base, ...call]);
          } catch {}
        }
      });
      return;
    }
    if (where.handle) {
      cx.spawn(async (later) => {
        try {
          const result = await exec("/Applications/Orca.app/Contents/Resources/bin/orca",
            ["terminal", "switch", "--terminal", where.handle, "--json"]);
          if (result.code !== 0) this.flash(later, "Not in Herdr, tmux or Orca — open the session's terminal first");
          else await exec("open", ["-a", "Orca"]);
        } catch {
          this.flash(later, "Not in Herdr, tmux or Orca — open the session's terminal first");
        }
      });
      return;
    }
    this.flash(cx, "Not in Herdr, tmux or Orca — open the session's terminal first");
  }

  pageGroup(item) {
    return item?.pages?.[0] ?? null;
  }

  dropPage(page) {
    const same = (candidate) => candidate
      && candidate.pageId === page.pageId
      && candidate.worktree === page.worktree
      && candidate.url === page.url;
    if (this.meta?.pages) this.meta.pages = this.meta.pages.filter((candidate) => !same(candidate));
    for (const session of this.sessions) {
      if (Array.isArray(session.pages)) session.pages = session.pages.filter((candidate) => !same(candidate));
    }
  }

  openPage(page, cx) {
    if (!page) {
      this.flash(cx, "No page to open — try again after the scan");
      return;
    }
    if (!page.openable) {
      this.flash(cx, "Couldn't open this page — check the file still exists");
      return;
    }
    cx.spawn(async (later) => {
      if (!(await openPageFiles(page))) {
        this.flash(later, "Couldn't open this page — check the file still exists");
        return;
      }
      this.dropPage(page);
      later.notify();
      this.poll(later);
    });
  }

  openOldestPage(cx) {
    const pages = this.meta?.pages ?? [];
    if (!pages.length) {
      this.flash(cx, "No page to open — try again after the scan");
      return;
    }
    this.openPage(pages[0], cx);
  }

  key(event, cx) {
    const modifiers = event.modifiers ?? {};
    const alt = Boolean(modifiers.alt);
    const shift = Boolean(modifiers.shift);
    const command = Boolean(modifiers.platform);
    const control = Boolean(modifiers.control);
    const key = event.key;
    const data = this.viewData();
    const items = data.groups.flatMap((group) => group.items);
    const selected = this.selectedItem(data);
    if (selected && this.sel !== selected.sessionId) this.sel = selected.sessionId;
    const index = items.findIndex((item) => item.sessionId === selected?.sessionId);

    const choose = (next) => {
      if (!items.length) return;
      const target = items[Math.max(0, Math.min(items.length - 1, next))];
      this.sel = target.sessionId;
      this.camFocus = true;
      this.reveal(target.sessionId, data);
    };

    const plain = !command && !control && !alt;
    const searching = Boolean(this.query);
    let handled = true;
    if (key === "p" && control && alt && !command) {
      // ctrl-alt-p while the scene has the keyboard: the keys.json binding alone does not hand it back,
      // so the scene does it itself, like Esc's last step.
      this.leaveKeys();
    } else if (key === "escape" && this.camFocus && !searching) {
      this.camFocus = false;
    } else if (key === "escape") {
      const chipFilter = shared("cozy-filter");
      if (searching) this.query = "";
      else if (Array.isArray(chipFilter) && chipFilter.length) setShared("cozy-filter", []);
      else if (this.sel !== NONE && selected) this.sel = NONE;
      else {
        this.leaveKeys();
        handled = false;
      }
    } else if (key === "backspace" && plain) {
      if (searching) this.query = eraseJamo(this.query);
      else if (!event.is_held) this.acknowledge(selected, cx);
    } else if (key === "backspace" && searching && command && !control && !alt) {
      this.query = "";
    } else if (key === "backspace" && searching && alt && !command && !control) {
      this.query = this.query.replace(/\S*\s*$/, "");
    } else if (key === "left" && alt) choose(0);
    else if (key === "right" && alt) choose(items.length - 1);
    else if (key === "left") choose(index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length);
    else if (key === "right") {
      if (index === items.length - 1 && data.hiddenDone > 0) {
        this.showAllDone = true;
        const next = this.viewData();
        const target = next.groups.flatMap((group) => group.items)[items.length];
        if (target) {
          this.sel = target.sessionId;
          this.reveal(target.sessionId, next);
        }
      } else choose(index < 0 ? 0 : (index + 1) % items.length);
    } else if (key === "down") {
      if (selected?.steps.length) {
        if (this.expanded.has(selected.sessionId)) this.scrollSteps(selected, 1);
        else {
          this.openSteps(selected);
          this.reveal(selected.sessionId, this.viewData());
        }
      } else handled = false;
    } else if (key === "up") {
      if (selected?.steps.length && this.expanded.has(selected.sessionId)) {
        if ((this.stepTop[selected.sessionId] ?? 0) > 0) this.scrollSteps(selected, -1);
        else {
          this.expanded.delete(selected.sessionId);
          this.reveal(selected.sessionId, this.viewData());
        }
      } else handled = false;
    } else if (key === "enter") {
      if (command && !shift && !control && !alt) {
        // macOS has no context-menu key, so ⌘↩ opens the menu a right-click on the card opens.
        if (selected) this.openLinks(`card-${selected.sessionId}`, cx, this.cardMenuAt(selected.sessionId));
      } else if (shift) {
        const page = selected && selected.group !== "done" ? this.progressTarget(selected) : this.pageGroup(selected);
        if (page) this.openPage(page, cx);
        else this.flash(cx, "This row has no page — pick a card that has one");
      } else this.goTo(selected, cx);
    } else if (key === "space" && plain && !searching) {
      this.jump(shift ? "done" : "reply", data, cx);
      this.camFocus = true;
    } else if ((key === "?" || (key === "/" && shift)) && !searching) {
      this.showKeys = !this.showKeys;
    } else if (key === "tab" && plain && !shift) {
      if (searching) handled = false;
      else this.openOldestPage(cx);
    } else if (key === "z" && command && !shift && !control && !alt) {
      // The Undo button lives in the tab bar, out of the strip's keyboard reach, so ⌘Z stands in for it.
      if (this.noticeAction) this.undoNotice();
      else handled = false;
    } else if (event.key_char && event.key_char.length === 1 && plain) {
      const ch = event.key_char;
      if (searching || ch.trim()) {
        const code = ch.codePointAt(0);
        this.query = code >= 0x3131 && code <= 0x3163 ? typeJamo(this.query, ch) : this.query + ch;
      } else handled = false;
    } else {
      handled = false;
    }

    if (handled) {
      cx.stop_propagation();
      cx.notify();
    }
  }

  // What other mods read (the rail reads places): published only when it changes, since setShared redraws every mod.
  publish(_data, focused) {
    const value = {
      query: this.query,
      focused,
      pages: this.meta?.pages ?? [],
      unreadable: this.meta?.unreadablePages?.length ?? 0,
      places: this.places ?? {},
    };
    const text = JSON.stringify(value);
    if (text === this.published) return;
    this.published = text;
    setShared(SHARED_KEY, value);
  }

  // The tab bar draws the notice as a pill in the head row, so the strip hands it over the same way.
  // Only the copy whose scene is on screen writes, so a hidden copy never clears the shown one's notice.
  publishNotice() {
    if (!this.sceneShown()) {
      this.publishedNotice = undefined;
      return;
    }
    const value = this.err
      ? { tone: "err", text: this.err, action: "Retry" }
      : this.notice
        ? { tone: "note", text: this.notice, action: this.noticeAction?.label ?? null }
        : null;
    const text = JSON.stringify(value);
    if (text === this.publishedNotice) return;
    this.publishedNotice = text;
    setShared(NOTICE_KEY, value);
  }

  // ---- card ----

  tone(item) {
    if (item.group === "done") return TONE.done;
    if (item.group === "working") return TONE.working;
    return item.bucket === "stall" ? TONE.stall : TONE.needs;
  }

  timeText(item, now) {
    if (item.group === "done") return item.sortDate != null ? agoText(now - item.sortDate) : "";
    if (item.group === "working") return item.eta ?? (item.since != null ? shortDuration(now - item.since) : "");
    if (item.bucket === "stall") return `quiet ${shortDuration(now - (item.raw.lastMeaningfulAt ?? item.since ?? now))}`;
    return item.since != null ? shortDuration(now - item.since) : "";
  }

  // A placeholder face on the right, and bottom-left only what never truncates: the ticket key (or
  // Slack for a bot's thread) over its relay round and PR (or lane).
  band(item, tone) {
    const g = this.geo ?? geometry(1);
    const done = tone === TONE.done;
    const tag = this.bandTag(item);
    return div().relative().mx(g.BAND_PAD).mt(g.BAND_PAD).h(g.BAND_H).flex_none().rounded(g.BAND_RADIUS).bg(done ? INK.surface : tone.band)
      .when(done, (element) => element.border(1).border_color(INK.edge))
      .child(div().id(`face-${faceIndex(item.charKey)}`).absolute().left(g.CHAR_LEFT).top(g.CHAR_TOP).size(22).rounded(6).bg(theme().muted))
      .when(Boolean(tag), (element) => element.child(v_flex().absolute().left(g.TAG_LEFT).bottom(g.TAG_BOTTOM).gap(g.TAG_GAP)
        .child(div().text_size(g.TEXT.tagHead).line_height(`${g.TAG_HEAD_LINE}px`).font_family(FONT).font_bold().text_color(tone.ink).child(tag.head))
        .when(Boolean(tag.sub), (el) => el.child(div().text_size(g.TEXT.tagSub).line_height(`${g.TAG_SUB_LINE}px`).font_family(FONT)
          .font_semibold().text_color(tone.ink).child(tag.sub)))));
  }

  // The tray's chips. A PR the band tag already shows stays out; a Slack-thread band shows only its lane.
  trayChips(item) {
    const background = item.group !== "attention" ? backgroundLabel(item.background) : null;
    const loosePR = this.bandTag(item) && !item.spot?.slack ? null : item.prTag;
    return [item.backgrounded ? "Background" : null, background, loosePR, ...item.extraPRs.slice(0, 1).map((pr) => `+${item.extraPRs.length} ${pr}`)].filter(Boolean);
  }

  bandTag(item) {
    const head = item.spot?.key ?? (item.spot?.slack ? "Slack" : null);
    if (!head) return null;
    const sub = item.spot.slack
      ? (item.lane ? `${item.lane} 레인` : null)
      : [item.round ? `${item.round}회차` : null, item.prTag].filter(Boolean).join(" · ") || null;
    return { head, sub };
  }

  metaText(item) {
    return [item.spot?.key, item.spot?.label ?? item.place, item.prTag].filter(Boolean).join("  ·  ");
  }

  progressRow(item) {
    const g = this.geo ?? geometry(1);
    const total = item.progress?.total ?? 0;
    const counts = item.counts ?? { done: 0, now: 0, blocked: 0 };
    const states = [];
    if (Array.isArray(item.stepStates) && item.stepStates.length === total) {
      states.push(...item.stepStates);
    } else {
      for (let i = 0; i < Math.max(0, counts.done); i++) states.push("done");
      for (let i = 0; i < Math.max(0, counts.now); i++) states.push("now");
      for (let i = 0; i < Math.max(0, counts.blocked); i++) states.push("blocked");
      while (states.length < total) states.push("left");
      if (states.length > total) states.splice(total);
    }
    return h_flex().h(g.PROGRESS_H).flex_none().gap(g.PROGRESS_GAP).items_center()
      .when(item.progressStale, (element) => element.opacity(0.45))
      .child(h_flex().flex_1().min_w(0).gap(g.BAR_GAP).h(g.BAR_H)
        .children(states.map((state) => div().flex_1().h(g.BAR_H).rounded(g.BAR_RADIUS).bg(SEG[state] ?? SEG.left))))
      .child(div().flex_none().text_size(g.TEXT.progress).font_family(FONT).font_bold().text_color(INK.t3)
        .child(`${item.progress.done}/${total}`));
  }

  progressTarget(item) {
    const path = item.raw.deadhd?.pagePath;
    if (path) return { url: path, openable: true, files: [] };
    return this.pageGroup(item);
  }

  pageTag(item) {
    const g = this.geo ?? geometry(1);
    const page = item.pages[0];
    const extra = item.pages.length - 1;
    const label = extra > 0 ? `${page.label} +${extra}` : page.label;
    return h_flex().id(`tag-${item.sessionId}`).h(g.TAG_H).flex_none().max_w(g.TAG_MAX_W).px(g.TAG_PAD).rounded(g.TAG_RADIUS).gap(g.TAG_CHIP_GAP).items_center()
      .bg(INK.chipBg)
      .tooltip(page.url)
      .child(pageIcon(g.TAG_ICON, INK.t2))
      .child(div().min_w(0).truncate().text_size(g.TEXT.page).font_family(FONT).font_bold().text_color(INK.t2).child(label));
  }

  stepRow(step) {
    const g = this.geo ?? geometry(1);
    const color = step.state === "done" ? INK.t3 : step.state === "left" ? INK.t2 : INK.t1;
    const glyph = step.state === "done"
      ? div().text_size(g.TEXT.stepGlyph).font_family(FONT).font_bold().text_color(SEG.done).child("✓")
      : step.state === "blocked"
        ? div().text_size(g.TEXT.stepGlyph).font_family(FONT).font_bold().text_color(TONE.needs.ink).child("!")
        : step.state === "now" || step.state === "side"
          ? svg("mods/workspace-chrome/spinner.svg").size(g.SPINNER).flex_none().text_color(TONE.working.dot).spin(900)
          : div().text_size(g.TEXT.stepGlyph).font_family(FONT).text_color(INK.line).child("○");
    const trailing = step.state === "blocked" ? step.ask ?? step.sub ?? null : step.sub ?? null;
    return h_flex().h(g.STEP_H).flex_none().gap(g.STEP_GAP).items_center().min_w(0)
      .child(h_flex().w(g.STEP_GLYPH_W).flex_none().items_center().justify_center().child(glyph))
      .child(div().flex_1().min_w(0).truncate().text_size(g.TEXT.stepLabel).font_family(FONT).font_semibold().text_color(color).child(step.label))
      .when(Boolean(trailing), (element) => element.child(
        div().flex_none().max_w(g.STEP_TRAIL_W).truncate().text_size(g.TEXT.stepTrail).font_family(FONT).text_color(INK.t3).tooltip(trailing).child(trailing)));
  }

  // The step list, beside the card's body when ↓ opens it (the card doubles its width).
  stepsColumn(item) {
    const g = this.geo ?? geometry(1);
    const counter = this.stepCounter(item);
    const rows = this.visibleSteps(item).map((step) => this.stepRow(step));
    return v_flex().id(`steps-${item.sessionId}`).w(g.STEPS_W).flex_none().h_full().py(g.STEPS_PAD).pr(g.STEPS_PAD).pl(g.STEPS_PAD).gap(g.STEPS_GAP)
      .border_l(1).border_color(INK.rule).overflow_y_scroll()
      .child(h_flex().h(g.STEPS_HEAD_H).flex_none().gap(g.STEPS_HEAD_GAP).items_center()
        .child(div().flex_1().min_w(0).text_size(g.TEXT.stepsHead).font_family(FONT).font_weight(800).text_color(INK.t3).child("Steps"))
        .when(Boolean(counter), (element) => element.child(
          div().flex_none().text_size(g.TEXT.stepsCount).font_family(FONT).text_color(INK.t3).child(counter))))
      .children(rows);
  }

  // The line under the meta: what a Working session does now, what a waiting one asks, what a Done one said.
  leadOf(item) {
    if (item.group === "working") {
      const waiting = item.raw.status === "shell";
      if (waiting && item.nowLabel) return { text: `▶ ${item.nowLabel}`, waiting: false, spinner: false };
      if (!waiting && !item.nowLine) return null;
      return { text: waiting ? "Waiting on background tasks" : item.nowLine, waiting, spinner: !waiting };
    }
    if (item.group === "attention") return { text: item.answer, waiting: false, spinner: false };
    return item.replyTail ? { text: item.replyTail, waiting: false, spinner: false } : null;
  }

  // Herdr is where nearly every session runs, so only another host earns a badge.
  kindBadge(item) {
    return item.badge && item.badge !== "herdr" ? item.badge : null;
  }

  // The message slot: what the session says now, else its last prompt in the quiet colour.
  messageOf(item) {
    const lead = this.leadOf(item);
    const text = cleanMessage(lead?.text);
    if (text) return { text, quiet: Boolean(lead.waiting), spinner: Boolean(lead.spinner) };
    const prompt = item.raw.lastPrompt;
    if (!prompt || /\.claude\/handoff\//.test(prompt)) return null;
    const quiet = cleanMessage(prompt.replace(/\[Image #\d+\]/g, " ").replace(/(?:~|\/)[\w.-]*(?:\/[\w.-]+){2,}/g, " "));
    return quiet ? { text: `↳ ${quiet}`, quiet: true, spinner: false } : null;
  }

  card(item, selected, now, focused = false) {
    const g = this.geo ?? geometry(1);
    const tone = this.tone(item);
    const timeText = this.timeText(item, now);
    const message = this.messageOf(item);
    const showProgress = Boolean(item.progress && (item.group !== "done" || item.progress.done < item.progress.total));
    const chips = this.trayChips(item);
    const tray = chips.length > 0 || item.pages.length > 0 || Boolean(this.kindBadge(item));
    const topic = wrapLines(item.topic ?? item.title, g.TEXT.topic, g.TEXT_W, 2);
    const budget = cardBudget({ topicLines: topic.length, tray, showProgress }, g);
    const spin = Boolean(message?.spinner);
    const lines = message ? wrapLines(message.text, g.TEXT.message, g.TEXT_W, budget.msgLines, spin ? 15 * g.k : 0) : [];

    const accent = selected ? selectedTone(focused) : null;
    const titleColor = accent?.title ?? INK.t1;
    const msgColor = message?.quiet ? INK.t3 : INK.t2;
    const body = [
      v_flex().flex_none().children(topic.map((text) => div().h(g.TOPIC_LINE).truncate().text_size(g.TEXT.topic)
        .line_height(`${g.TOPIC_LINE}px`).font_family(FONT).font_semibold().text_color(titleColor).child(text))),
    ];
    if (lines.length) {
      body.push(v_flex().flex_none().mt(g.MSG_MT).children(lines.map((text, index) => h_flex().h(g.MSG_LINE).min_w(0).items_center()
        .when(index === 0 && spin, (row) => row.child(svg("mods/workspace-chrome/spinner.svg").size(g.SPINNER).flex_none().mr(g.MSG_SPINNER_MR)
          .text_color(TONE.working.dot).spin(900)))
        .child(div().min_w(0).truncate().text_size(g.TEXT.message).line_height(`${g.MSG_LINE}px`).font_family(BODY_FONT)
          .font_weight(400).text_color(msgColor).child(text)))));
    }
    body.push(div().flex_1().min_h(0));
    if (showProgress) body.push(this.progressRow(item).mb(g.PROGRESS_MB));
    if (tray) {
      body.push(h_flex().h(g.TRAY_H).flex_none().mb(g.TRAY_MB).gap(g.TRAY_GAP).items_center().min_w(0).overflow_hidden()
        .children(chips.map((label) => h_flex().h(g.CHIP_H).flex_none().px(g.CHIP_PAD).rounded(g.CHIP_RADIUS).items_center().bg(INK.chipBg)
          .child(div().text_size(g.TEXT.chip).font_family(FONT).font_bold().text_color(INK.t2).child(label))))
        .when(item.pages.length > 0, (element) => element.child(this.pageTag(item)))
        .when(Boolean(this.kindBadge(item)), (element) => element.child(
          h_flex().h(g.CHIP_H).flex_none().px(g.CHIP_PAD).rounded(g.CHIP_RADIUS).items_center().bg(INK.chipBg)
            .child(div().text_size(g.TEXT.badge).font_family(FONT).font_bold().text_color(INK.t2).child(item.badge)))));
    }
    body.push(h_flex().h(g.FOOT_H).flex_none().gap(g.FOOT_GAP).items_center().min_w(0)
      .child(div().flex_1().min_w(0).truncate().text_size(g.TEXT.foot).font_family(FONT).font_semibold().text_color(INK.t3)
        .child(footerOf(item)))
      .child(div().flex_none().text_size(g.TEXT.foot).font_family(FONT).font_semibold().text_color(INK.t3).child(timeText)));

    const open = this.expanded.has(item.sessionId) && item.steps.length > 0;
    return h_flex().id(`card-${item.sessionId}`).w(g.CARD_W + (open ? g.STEPS_W : 0)).h(g.CARD_H).flex_none()
      .rounded(g.CARD_RADIUS).bg(INK.surface).overflow_hidden().cursor_pointer()
      .border(selected ? 2 : 1).border_color(accent?.border ?? INK.edge)
      .when(!selected, (element) => element.hover((style) => style.border_color(INK.line)))
      .when(item.group === "done" && item.viewed && !selected, (element) => element.opacity(0.55))
      .tooltip(cardTooltip(item.topic, item.title, [this.metaText(item), tone.label]))
      .child(v_flex().w(g.CARD_W - (selected ? 4 : 2)).flex_none().h_full()
        .child(this.band(item, tone))
        .child(v_flex().flex_1().min_h(0).pt(g.BODY_PT).px(g.BODY_PAD).pb(g.BODY_PB).children(body)))
      .when(open, (element) => element.child(this.stepsColumn(item)));
  }

  laneColumn(group) {
    const g = this.geo ?? geometry(1);
    const lane = laneParts(group);
    return v_flex().w(g.LANE_W).flex_none().items_center().pt(half(8 * g.k)).gap(half(2 * g.k)).tooltip(lane.tip)
      .child(dot(lane.color, g.DOT))
      .child(div().text_size(g.TEXT.groupCount).font_family(FONT).font_bold().text_color(INK.t3).child(lane.count));
  }

  moreTile(count) {
    const g = this.geo ?? geometry(1);
    return v_flex().id("cc-more").w(g.MORE_W).h(g.CARD_H).flex_none().rounded(g.CARD_RADIUS).items_center().justify_center().gap(g.MORE_GAP)
      .border(1).border_color(INK.line).bg(INK.chrome).cursor_pointer()
      .hover((style) => style.bg(INK.rule))
      .child(div().text_size(g.TEXT.moreCount).font_family(FONT).font_weight(800).text_color(INK.t2).child(`+${count}`))
      .child(div().text_size(g.TEXT.moreLabel).font_family(FONT).font_bold().text_color(INK.t2).child("more done"));
  }

  stripView(data) {
    const g = this.geo ?? geometry(1);
    const strip = this.buildStrip(data);
    const chipFilter = shared("cozy-filter");
    const filtering = Array.isArray(chipFilter) && chipFilter.length > 0;
    if (!strip.length) {
      return h_flex().h(g.STRIP_H).flex_none().w_full().items_center().justify_center()
        .child(div().text_size(g.TEXT.empty).font_family(FONT).font_bold().text_color(INK.t3)
          .child(emptyText(this.query, filtering)));
    }
    const now = data.now;
    const focused = Boolean(this.handle?.is_focused?.());
    // A head entry's lead already counts the lane column, which is drawn inside it.
    const draw = (entry) => h_flex().h_full().flex_none().w(entry.w).pl(entry.head ? entry.lead - g.LANE_W : entry.lead).items_start()
      .when(entry.head, (el) => el.child(this.laneColumn(entry.group)))
      .child(entry.kind === "more" ? this.moreTile(entry.count) : this.card(entry.item, entry.item.sessionId === this.sel, now, focused));
    return div().relative().w_full().h(g.STRIP_H).flex_none()
      .child(h_virtual_list(STRIP_ID, strip.length, strip.map((entry) => entry.w),
        (index) => strip[index]?.key ?? String(index),
        (range) => strip.slice(range.start, range.end).map(draw))
        .on_item_click((key, cx) => this.clickStrip(key, cx))
        .on_item_secondary_click((key, _event, cx) => this.openLinks(key, cx))
        .track_scroll(this.scroll).size_full())
      .on_scroll_wheel((event, cx) => this.wheelRow(strip.map((entry) => entry.w), event, cx))
      .on_mouse_move((event) => this.trackStrip(event))
      .child(edgeFade("left", g.PAD_X))
      .child(edgeFade("right", g.PAD_X));
  }

  // The list only scrolls by item, so both wheel kinds still move whole cards, and the offset
  // estimate is what keeps a wheel step aligned with a native sideways swipe. The bounds are
  // on-screen px carrying the app's zoom, while the entry widths are written at zoom 1.
  wheelRow(widths, event, cx) {
    const viewportW = event.bounds?.width > 0 ? event.bounds.width / zoomOf() : null;
    if (viewportW != null) this.wheel.viewportW = viewportW;
    const next = wheelStepFor(this.wheel, event, Date.now(), widths, viewportW);
    this.wheel = next.state;
    if (next.target == null) return;
    this.scroll.scroll_to_item(next.target, "top");
    cx.notify();
  }

  // GPUI gives a list no item bounds, so the strip's window box comes from the last pointer move over it.
  trackStrip(event) {
    const box = event.bounds;
    if (!box || !(box.width > 0) || !event.local_position) return;
    this.stripBox = { x: event.position.x - event.local_position.x, y: event.position.y - event.local_position.y,
      width: box.width, height: box.height };
    if (this.wheel) this.wheel.viewportW = box.width / zoomOf();
  }

  // Where ⌘↩ opens a card's menu: under the card, inside the strip. Unknown until the pointer has crossed the
  // strip once, and then the popup falls back to the pointer.
  cardMenuAt(sessionId) {
    const box = this.stripBox;
    if (!box) return undefined;
    const strip = this.buildStrip(this.viewData());
    const index = strip.findIndex((entry) => entry.kind === "card" && entry.item.sessionId === sessionId);
    if (index < 0) return undefined;
    const zoom = zoomOf();
    const left = (stripStarts(strip.map((entry) => entry.w))[index] + strip[index].lead - (this.wheel?.off ?? 0)) * zoom;
    const x = Math.max(0, Math.min(left, box.width - LINKS_W * zoom));
    return { x: Math.round(box.x + x), y: Math.round(box.y + box.height - 8 * zoom) };
  }

  // A right-click on a card: the card's links in a menu at the pointer (or at `at`), and the card selected.
  openLinks(key, cx, at) {
    const item = this.viewData().groups.flatMap((group) => group.items).find((entry) => `card-${entry.sessionId}` === key);
    if (!item) return;
    this.sel = item.sessionId;
    cx.notify();
    const links = linksOf(item);
    // A Claude Code session in a live terminal with no checklist yet can be asked to show one.
    const showChecklist = Boolean(item.terminal) && item.raw?.t === "s" && !item.hasChecklist;
    const stopId = item.backgrounded ? item.raw.jobId ?? item.where.attachId ?? null : null;
    openOverlay({ mod: "cozy-office", kind: "popup", ...(at ? { at } : {}), width: LINKS_W, height: linksMenuHeight(links.length, showChecklist, Boolean(stopId)),
      props: { role: "links", head: item.jiraKey ?? (item.spot?.slack ? "Slack" : item.spot?.label ?? "Session"),
        topic: item.topic ?? item.title ?? null, links, showChecklist, stopId, terminal: item.terminal ?? null,
        working: item.raw?.status === "busy" } });
  }

  // props().role "links": the popup openLinks() opens. X stops a background session no pane shows, C asks
  // for the checklist, J, P, S and G open the first link of each kind.
  linksMenu() {
    const { head, topic, links = [], showChecklist = false, stopId = null } = props() ?? {};
    const open = (link, cx) => this.openLink(link, cx);
    const copy = (cx) => this.copyLinks(links, cx);
    const rows = [...(stopId ? [{ stop: true }] : []), ...(showChecklist ? [{ checklist: true }] : []), ...links];
    const icons = { jira: "mods/cozy-office/icons/ticket.svg", pr: "mods/cozy-office/icons/pull.svg",
      slack: "mods/cozy-office/icons/thread.svg", page: "mods/workspace-chrome/file-text.svg" };
    const row = (id, icon, label, meta, hot, active, action) => h_flex().id(id).h(30).flex_none().px(8).gap(8).rounded(8)
      .items_center().cursor_pointer()
      .when(active, (el) => el.bg(INK.chipBg))
      .hover((h) => h.bg(INK.chipBg))
      .on_click((_event, cx) => action(cx))
      .child(svg(icon).size(14).flex_none().text_color(INK.t2))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_semibold().text_color(INK.t1).child(label))
      .when(Boolean(meta), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11).font_family(FONT)
        .font_semibold().text_color(INK.t2).child(meta)))
      .when(Boolean(hot), (el) => el.child(keycap(String(hot).toUpperCase())));
    const checklistRow = h_flex().id("link-checklist").h(30).flex_none().px(8).gap(8).rounded(8)
      .items_center().cursor_pointer()
      .when(this.active === (stopId ? 1 : 0), (el) => el.bg(INK.chipBg))
      .hover((h) => h.bg(INK.chipBg))
      .on_click((_event, cx) => this.enableChecklist(cx))
      .child(svg("mods/workspace-chrome/file-text.svg").size(14).flex_none().text_color(INK.t2))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_semibold().text_color(INK.t1)
        .child("Show checklist"))
      .when(Boolean(this.error), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11)
        .font_family(FONT).font_semibold().text_color(TONE.needs.ink).child(this.error)))
      .child(keycap("C"));
    const stopRow = h_flex().id("link-stop").h(30).flex_none().px(8).gap(8).rounded(8)
      .items_center().cursor_pointer()
      .when(this.active === 0, (el) => el.bg(INK.chipBg))
      .hover((h) => h.bg(INK.chipBg))
      .on_click((_event, cx) => this.stopSession(cx))
      .child(svg("mods/cozy-office/icons/stop.svg").size(14).flex_none().text_color(TONE.needs.ink))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family(FONT).font_semibold().text_color(INK.t1)
        .child("Stop background session"))
      .when(Boolean(this.stopError), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(11)
        .font_family(FONT).font_semibold().text_color(TONE.needs.ink).child(this.stopError)))
      .child(keycap("X"));
    const offset = (stopId ? 1 : 0) + (showChecklist ? 1 : 0);
    return v_flex().id("card-links").size_full().p(6).track_focus(this.handle)
      .on_key_down((event, cx) => this.linksKey(event.key, rows, cx))
      .child(v_flex().h(45).flex_none().px(8).pt(6)
        .child(div().text_size(12).font_family(FONT).font_bold().text_color(INK.t1).child(head ?? ""))
        .when(Boolean(topic), (el) => el.child(div().truncate().text_size(11).font_family(BODY_FONT).text_color(INK.t3).child(topic))))
      .child(div().h(1).mx(6).mb(4).flex_none().bg(INK.rule))
      .when(Boolean(stopId), (el) => el.child(stopRow).child(div().h(1).mx(6).my(4).flex_none().bg(INK.rule)))
      .when(showChecklist, (el) => el.child(checklistRow))
      .when(showChecklist && links.length > 0, (el) => el.child(div().h(1).mx(6).my(4).flex_none().bg(INK.rule)))
      .when(links.length === 0, (el) => el.child(h_flex().h(30).px(8).items_center()
        .child(div().text_size(12).font_family(FONT).font_semibold().text_color(INK.t3).child("No links on this card"))))
      .children(links.map((link, index) => row(`link-${index}`, icons[link.kind], link.label, link.meta, link.hot,
        index + offset === this.active, (cx) => open(link, cx))))
      .when(links.length > 0, (el) => el
        .child(div().h(1).mx(6).my(4).flex_none().bg(INK.rule))
        .child(row("link-copy", "mods/cozy-office/icons/copy.svg", "Copy all links", null, null, false, copy)));
  }

  // The links popup's keys: a row's letter runs it, ↑↓ move, ↩ runs the highlighted row, Esc closes.
  linksKey(key, rows, cx) {
    const hot = rows.find((row) => (row.stop ? key === "x" : row.checklist ? key === "c" : row.hot === key));
    if (hot?.stop) this.stopSession(cx);
    else if (hot?.checklist) this.enableChecklist(cx);
    else if (hot) this.openLink(hot, cx);
    else if (key === "down" && rows.length) this.active = (this.active + 1) % rows.length;
    else if (key === "up" && rows.length) this.active = (this.active - 1 + rows.length) % rows.length;
    else if (key === "enter" && rows[this.active]) {
      if (rows[this.active].stop) this.stopSession(cx);
      else if (rows[this.active].checklist) this.enableChecklist(cx);
      else this.openLink(rows[this.active], cx);
    } else if (key === "escape") closeOverlay(props().overlay);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  // Asks the session to show its checklist through Herdr's CLI. The terminal and prompt are positional
  // args, so neither is parsed by the shell. Claude Code queues input typed during a turn.
  enableChecklist(cx) {
    const { terminal, working, overlay } = props() ?? {};
    if (!terminal) return;
    const prompt = working ? CHECKLIST_QUEUED_PROMPT : CHECKLIST_PROMPT;
    this.error = null;
    cx.spawn(async (cx) => {
      let result = null;
      try { result = await exec("sh", ["-lc", 'hc send "$1" "$2"', "x", terminal, prompt]); } catch {}
      if (!result || result.code !== 0) {
        this.error = (((result?.stderr || result?.stdout) ?? "").trim().replace(/\.$/, ""))
          || "Could not reach the terminal — focus it in Herdr and retry";
        cx.notify();
        return;
      }
      closeOverlay(overlay);
    });
  }

  // `claude stop` keeps the conversation, so `claude attach` can bring it back. The popup is closed only
  // after the command returns: closing it ends this copy.
  stopSession(cx) {
    const { stopId, overlay } = props() ?? {};
    if (!stopId) return;
    this.stopError = null;
    cx.spawn(async (cx) => {
      let result = null;
      try { result = await exec("sh", ["-lc", 'claude stop "$1"', "x", stopId]); } catch {}
      if (!result || result.code !== 0) {
        this.stopError = (((result?.stderr || result?.stdout) ?? "").trim().replace(/\.$/, ""))
          || "Could not stop it — run claude stop in a terminal";
        cx.notify();
        return;
      }
      closeOverlay(overlay);
    });
  }

  // http(s) goes to the system's URL handler; a local page file (scan.sh vouched it openable) to `open`.
  openLink(link, cx) {
    if (/^https?:\/\//.test(link.url)) cx.open_url(link.url);
    else exec("open", [link.url]);
    closeOverlay(props().overlay);
  }

  copyLinks(links, cx) {
    cx.write_to_clipboard(links.map((link) => link.url).join("\n"));
    closeOverlay(props().overlay);
  }

  // Clicks on the strip arrive here by row key: Herdr refuses handlers inside a virtual list's rows.
  clickStrip(key, cx) {
    if (key === "more-done") {
      this.showAllDone = true;
    } else {
      const item = this.viewData().groups.flatMap((group) => group.items)
        .find((entry) => `card-${entry.sessionId}` === key);
      if (!item) return;
      this.sel = item.sessionId;
      this.goTo(item, cx);
    }
    this.grabKeys(cx);
    cx.notify();
  }

  legend() {
    const g = this.geo ?? geometry(1);
    const item = (keys, label) => h_flex().flex_none().gap(g.LEGEND_ITEM_GAP).items_center()
      .child(keycap(keys, g.k))
      .child(div().text_size(g.TEXT.legend).font_family(FONT).font_semibold().text_color(INK.t3).child(label));
    return h_flex().absolute().left(0).right(0).bottom(0).h(g.LEGEND_H).px(g.LEGEND_PAD).gap(g.LEGEND_GAP).items_center()
      .bg(INK.surface).border_t(1).border_color(INK.rule).rounded_bl(12).rounded_br(12).overflow_hidden()
      .child(item("←→", "Select"))
      .child(item("↩", "Go to"))
      .child(item("↑↓", "Steps"))
      .child(item("⌫", "Dismiss"))
      .child(item("⌘Z", "Undo"))
      .child(item("Space", "Go to waiting"))
      .child(item("⇧Space", "Go to done"))
      .child(item("Tab", "Next to read"))
      .child(item("⌘↩", "Links"))
      .child(item("Esc", "Back"))
      .child(item("?", "Keys"));
  }

  // ---- the PiP window ----

  /** True for the window copy while PiP is on: the one that draws and scans. */
  pipShown() { return this.role === "pip" && pipOn(this.demo); }

  // The office and the strip open the window when PiP is on and no window copy is alive.
  ensurePip(now = Date.now()) {
    if (this.role === "pip" || this.role === "links") return;
    if (!pipOn(this.demo)) return;
    if (pipWindowLive(this.demo, now)) return;
    this.openPip(now);
  }

  // Opens the window at the place the home gives at the app window's size now; the first time, the
  // home is the terminal area's bottom-right corner at that size. A window at generation `gen` has
  // its own overlay key, so a move can open a new one.
  openPip(now = Date.now()) {
    const z = zoomOf();
    const viewport = readViewport();
    const tree = layout();
    const area = pipArea(viewport, tree, z);
    const drawn = fitSize(pipSize(this.demo), area ?? windowBox(viewport), z);
    let home = pipPlace(this.demo);
    if (!home) {
      home = {
        ...defaultPlace(drawn, area, z), gen: 0,
        vw: viewport?.width ?? null, vh: viewport?.height ?? null,
      };
      setPipPlace(home, this.demo);
    }
    const at = showPlace(home, viewport, tree, drawn, z);
    this.openPipWindow({ ...at, gen: home.gen }, now);
  }

  // The window overlay itself: the one spec openPip, movePip and a grip's reopen hand Herdr. A
  // window opened for a grip drag is handed the drag to go on with.
  openPipWindow(place, now = Date.now(), resize = null) {
    markPipOpened(this.demo, now);
    const extra = { role: "pip", at: { x: place.x, y: place.y } };
    if (resize) extra.resize = resize;
    if (this.demo) extra.demo = true;
    if (this.demo && props()?.focus) extra.focus = props().focus;
    openOverlay({
      mod: "cozy-office",
      kind: "window",
      key: pipWindowKey(place.gen ?? 0, this.demo),
      frame: "none",
      at: { x: place.x, y: place.y },
      props: extra,
    });
  }

  // A window copy's tick: it beats so the office and the strip leave the window alone, writes the
  // home a pointer dragged it to once the pointer settles, and opens itself again where the home
  // gives at the app window's size now (the home itself is never overwritten by a size change).
  // With PiP off it hands the keyboard to the office and closes, in that order.
  pipTick(cx, now = Date.now()) {
    if (this.closing) return;
    pipBeat(this.demo, now);
    if (!pipOn(this.demo)) {
      this.followScene();
      this.closing = true;
      pipGone(this.demo);
      closeOverlay(props().overlay);
      return;
    }
    const viewport = readViewport();
    const z = zoomOf();
    const drawn = this.pipDrawn();
    // The pointer resting somewhere else than this window was opened means the user dragged it;
    // a pointer merely passing over a window held inside shows the place it was opened at.
    if (!this.pipDrag && this.seenAt && now - this.seenAtAt >= PIP_SETTLE_MS && !samePlace(this.seenAt, this.shownAt)) {
      setPipPlace({
        ...clampPlace(this.seenAt, drawn, windowBox(viewport), z),
        gen: pipPlace(this.demo)?.gen ?? 0, vw: viewport?.width ?? null, vh: viewport?.height ?? null,
      }, this.demo);
      this.shownAt = this.seenAt;
    }
    if (!sameViewport(this.vp, viewport)) {
      this.vp = viewport;
      this.vpAt = now;
      cx.notify();
    }
    if (this.pipDrag) {
      // A drag in progress holds the home as it was; one whose pointer was let go before the
      // window it reopened could hear it ends here.
      if (!this.dragHeard && this.dragAt !== null && now - this.dragAt >= GRIP_QUIET_MS) this.pipPointerUp(cx);
      return;
    }
    if (now - this.vpAt < PIP_SETTLE_MS || now - this.seenAtAt < PIP_SETTLE_MS) return;
    const want = showPlace(pipPlace(this.demo), viewport, layout(), drawn, z);
    if (want && !samePlace(want, this.pipHere())) this.reopenPip(want, now);
  }

  /** The size the window draws at (logical px), shrunk to the terminal area when that is smaller;
   *  the size a grip drag has reached while one is going. */
  pipDrawn() {
    if (this.pipDrag) return { w: this.pipDrag.rect.w, h: this.pipDrag.rect.h };
    const z = zoomOf();
    const viewport = readViewport();
    return fitSize(pipSize(this.demo), pipArea(viewport, layout(), z) ?? windowBox(viewport), z);
  }

  /** The place this copy shows: where a grip drag has got to, else the pointer's place while it
   *  settles, else the place it was opened at, else where the home gives at the app window's size now. */
  pipHere() {
    if (this.pipDrag) return { x: this.pipDrag.rect.x, y: this.pipDrag.rect.y };
    const place = this.seenAt ?? this.shownAt;
    if (place) return { x: place.x, y: place.y };
    const z = zoomOf();
    const viewport = readViewport();
    const at = showPlace(pipPlace(this.demo), viewport, layout(), this.pipDrawn(), z);
    return at ?? defaultPlace(this.pipDrawn(), pipArea(viewport, layout(), z), z);
  }

  // A press on the window remembers where it put the window's top-left, as long as that point is
  // over the app window at all; the tick writes it once the pointer has settled.
  sawPointer(event, now = Date.now()) {
    const origin = originOf(event);
    if (!origin) return;
    const drawn = this.pipDrawn();
    const z = zoomOf();
    const viewport = readViewport();
    if (viewport) {
      const over = origin.x > -drawn.w * z && origin.y > -drawn.h * z && origin.x < viewport.width && origin.y < viewport.height;
      if (!over) return;
    }
    if (samePlace(this.seenAt, origin)) return;
    this.seenAt = origin;
    this.seenAtAt = now;
  }

  // Writes the new home, hands the keyboard and the look on, opens the window at `at` under the
  // home's new generation (carrying `resize`, a grip drag, to it) and closes this one: a copy that
  // closes its own overlay stops after the synchronous lines, so only the return follows. A copy
  // already closing does none of it.
  reopenAt(home, at, now = Date.now(), resize = null) {
    if (this.closing) return false;
    setPipPlace(home, this.demo);
    this.passKeys("pip");
    handLook("pip", this.look, this.demo);
    this.openPipWindow({ ...at, gen: home.gen }, now, resize);
    this.closing = true;
    closeOverlay(props().overlay);
    return true;
  }

  // A place the keys or a drag put the window at: the home is that place, at the app window's size
  // now, under the next generation.
  movePip(next, now = Date.now()) {
    const viewport = readViewport();
    return this.reopenAt({
      x: next.x, y: next.y, gen: (pipPlace(this.demo)?.gen ?? 0) + 1,
      vw: viewport?.width ?? null, vh: viewport?.height ?? null,
    }, next, now);
  }

  // The app window's size moves the place the home gives: the home keeps its x, y and size, and
  // only the generation goes on, so the same home gives its place again at the old size.
  reopenPip(at, now = Date.now()) {
    const home = pipPlace(this.demo);
    if (!home) return false;
    return this.reopenAt({ x: home.x, y: home.y, gen: home.gen + 1, vw: home.vw, vh: home.vh }, at, now);
  }

  /** True while this copy's scene is the one on screen: the office while PiP is off, else the shown PiP. */
  sceneShown() { return this.role === "pip" ? this.pipShown() : !pipOn(this.demo); }

  // Takes the keyboard and remembers the pane it came from, so leaveKeys can hand it back.
  grabKeys(cx) {
    if (this.handle?.is_focused?.()) return;
    this.backPane = panes().find((p) => p.focused)?.pane ?? null;
    this.handle.focus();
    cx?.notify?.();
  }

  // The pane to give the keyboard back to: the one it came from while that pane is still open, else
  // the one focused now, else none.
  returnPane() {
    const live = panes();
    return live.some((p) => p.pane === this.backPane) ? this.backPane : live.find((p) => p.focused)?.pane ?? null;
  }

  // Hands the keyboard to `to` when this copy holds it, or when a hand-off addressed to this copy is
  // still on its way (two moves in a row reach the second copy before it has caught the first).
  passKeys(to, held = Boolean(this.handle?.is_focused?.())) {
    const pending = takeKeys(this.role === "pip" ? "pip" : "office", this.demo);
    if (!held && !pending) return false;
    handKeys(to, this.demo, pending?.back ?? this.returnPane());
    this.heldKeys = false;
    return true;
  }

  // ctrl-alt-p, Esc's last step and the toggle command: the keyboard goes back to the pane it came
  // from, or to the focused one when that pane is gone; the visit is over either way.
  leaveKeys() {
    this.keysWanted = false;
    const pane = this.returnPane();
    this.backPane = null;
    if (pane) run("pane.focus", { pane });
    else run("pane.go", { direction: this.role === "pip" ? "up" : "down" });
  }

  // The keyboard follows the scene even where no view code runs for the switch (the strip's Office
  // button calls setPip, a pip command another copy answered): a copy that held the keyboard while it
  // showed hands it to whoever shows now. A copy off screen forgets what it published, so the copy
  // that shows again writes its own value, the shared notice included.
  followScene() {
    const shown = this.sceneShown();
    if (!shown) this.publishedNotice = undefined;
    const me = this.role === "pip" ? "pip" : "office";
    const side = pipOn(this.demo) ? "pip" : "office";
    if (shown) this.heldKeys = Boolean(this.handle?.is_focused?.());
    else if (this.wasShown && this.heldKeys) this.passKeys(side, true);
    // A hand-off to a copy that went away before catching it is not lost: that copy forwards it.
    else if (keysFor(me, this.demo) && side !== me) this.passKeys(side, false);
    this.wasShown = shown;
  }

  // A copy handed the keyboard ("office" or its spot) takes it once it is drawn: focus cannot change
  // during render, so a timer does it, and takeKeys lets only the first timer act.
  catchKeys(me, cx) {
    if (!keysFor(me, this.demo) || this.catching) return;
    this.catching = true;
    cx.timer.after(50, (cx) => {
      this.catching = false;
      const hand = takeKeys(me, this.demo);
      if (!hand) return;
      if (hand.back) this.backPane = hand.back;
      this.handle.focus();
      // Hiding the office block (or showing it again) can move the keyboard after this first focus
      // and nothing reports it, so the same copy asks once more shortly after.
      this.keysWanted = true;
      cx.timer.after(250, (cx) => {
        if (this.keysWanted && this.sceneShown() && !this.handle.is_focused()) {
          this.handle.focus();
          cx.notify();
        }
        this.keysWanted = false;
      });
      cx.notify();
    });
  }

  // The PiP: the office at the size kept in shared(), drawn through the same steps as the office,
  // with a grip at each corner and the accent ring and keys line while it has the keyboard. The
  // root does not stop presses: Herdr drags the window by them, and the pointer's place is written
  // down for the tick to keep. While a grip is dragged the root is the drag's canvas — a box that
  // reaches the side the grip drags towards — and the window is drawn inside it at the size the
  // drag has reached, so the pointer stays over the window and the events keep coming.
  pipView(cx) {
    if (!this.pipShown()) return div();
    const data = this.sceneData();
    this.catchKeys("pip", cx);
    this.publishNotice();
    const drag = this.pipDrag;
    const z = zoomOf();
    const drawn = this.pipDrawn();
    const rect = drag ? drag.rect : { x: 0, y: 0, w: drawn.w, h: drawn.h };
    const canvas = drag ? drag.canvas : null;
    const focused = this.handle.is_focused();
    return div().id("cozy-office-pip").relative().w(canvas ? canvas.w / z : drawn.w).h(canvas ? canvas.h / z : drawn.h)
      .when(!drag, (el) => el.rounded(10).overflow_hidden().bg(INK.line))
      .when(drag, (el) => (drag.corner === "tl" || drag.corner === "br" ? el.cursor_nwse_resize() : el.cursor_nesw_resize()))
      .when(!drag, (el) => el.cursor_move())
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.pipKey(event, cx))
      .on_mouse_down("left", (event, cx) => this.pipPress(event, cx))
      .on_mouse_move((event, cx) => { if (!this.pipDrag) this.sawPointer(event); this.pipPointerMove(event.position, cx); })
      .on_mouse_up("left", (_event, cx) => this.pipPointerUp(cx))
      .on_hover((hovered, cx) => {
        if (this.pipHover !== hovered) { this.pipHover = hovered; cx.notify(); }
        if (!hovered) this.pipPointerUp(cx);
      })
      .child(div().id("o-pip-body").absolute().left(canvas ? (rect.x - canvas.x) / z : 0).top(canvas ? (rect.y - canvas.y) / z : 0)
        .w(rect.w).h(rect.h).rounded(10).overflow_hidden().bg(INK.line)
        .child(div().id("o-pip-scene").absolute().left(PIP_EDGE).top(PIP_EDGE).right(PIP_EDGE).bottom(PIP_EDGE).rounded(6).overflow_hidden()
          .on_size_change((box, cx) => this.sizeChanged(box, cx))
          .child(officeView(this, data.groups.flatMap((group) => group.items), data.now, { mini: true })))
        .child(this.pipGrip("tl"))
        .child(this.pipGrip("tr"))
        .child(this.pipGrip("bl"))
        .child(this.pipGrip("br"))
        .when(this.showKeys, (el) => el.child(this.legend()))
        .when(focused && !this.showKeys, (el) => el.child(this.pipKeysLine()))
        .when(focused, (el) => el.child(this.focusRing()))
        .when(Boolean(drag), (el) => el.child(this.pipSizeLabel(rect))));
  }

  // A press on the window takes the keyboard. Pressing while a grip is dragged (the release went
  // to the window the drag reopened) ends that drag there rather than dragging on.
  pipPress(event, cx) {
    if (this.pipDrag) {
      this.pipPointerUp(cx);
      return;
    }
    this.sawPointer(event);
    this.grabKeys(cx);
  }

  // The size a grip has reached, in the middle of the window while it is dragged.
  pipSizeLabel(rect) {
    return div().id("o-pip-size").absolute().left(0).top(0).right(0).bottom(0).flex().items_center().justify_center()
      .child(div().px(8).h(22).flex().items_center().rounded(11).bg(INK.surface).border(1).border_color(INK.line)
        .child(div().text_size(11).font_family(FONT).font_bold().text_color(INK.t2).child(`${rect.w} × ${rect.h}`)));
  }

  // The keys that are the PiP's own; every other key is the office's, through key().
  pipKey(event, cx) {
    const modifiers = event.modifiers ?? {};
    const alt = Boolean(modifiers.alt);
    const shift = Boolean(modifiers.shift);
    const command = Boolean(modifiers.platform);
    const control = Boolean(modifiers.control);
    const key = event.key;
    const plain = !alt && !control && !command;
    const arrow = key === "left" || key === "right" || key === "up" || key === "down";
    const edge = alt && !control && !command && !shift && arrow;
    // While a search is typed these are its characters, so the size keys stand aside.
    const sized = plain && !this.query && (key === "-" || key === "=" || key === "+" || key === "0");
    // A grip drag ends on the first key the PiP would act on, and that key does nothing.
    if (this.pipDrag && (edge || sized)) {
      cx.stop_propagation();
      this.pipPointerUp(cx);
      cx.notify();
      return;
    }
    if (edge) this.pipMove(key);
    else if (sized) this.pipResize(key === "-" ? -1 : key === "0" ? 0 : 1);
    else {
      this.key(event, cx);
      return;
    }
    cx.stop_propagation();
    cx.notify();
  }

  // ⌥ + an arrow (or a bound pip_<dir>): the window snaps to that edge of the terminal area,
  // keeping the other axis. Already there, it stays and nothing is handed over.
  pipMove(dir) {
    if (this.closing) return false;
    const z = zoomOf();
    const viewport = readViewport();
    const area = pipArea(viewport, layout(), z) ?? windowBox(viewport);
    const cur = this.pipHere();
    const next = snapPlace(cur, dir, this.pipDrawn(), area, z);
    if (samePlace(cur, next)) return false;
    this.movePip(next);
    return true;
  }

  // −/=/0: grows, shrinks or resets the size holding the window's near edges (its top-left in the
  // window's left and top halves), then moves it if the new size no longer fits where it sits.
  pipResize(dir) {
    if (this.closing) return false;
    const z = zoomOf();
    const viewport = readViewport();
    const area = pipArea(viewport, layout(), z);
    const win = windowBox(viewport);
    const before = this.pipDrawn();
    const here = this.pipHere();
    const half = halfOf(here, before, viewport, z);
    setPipSize(stepSize(pipSize(this.demo), dir), this.demo);
    const after = this.pipDrawn();
    const moved = anchoredResize(here, before, after, half, z);
    const next = clampPlace(moved, after, boxFor(moved, area, win), z);
    if (!samePlace(next, here)) this.movePip(next);
  }

  // One corner's grip: a 22 px press square at the corner, holding a thin L that points at it and shows
  // only while the pointer is over the window or a grip drags. The top two are flat (22 × PIP_GRIP_TOP,
  // a 16 × 9 handle) so they stay above the band's chips, which start 11 px down the window. The two corners on the main diagonal share a cursor, and the press
  // stops before Herdr, which would otherwise drag the window by it.
  pipGrip(corner) {
    const left = corner === "tl" || corner === "bl";
    const top = corner === "tl" || corner === "tr";
    const across = (el, off) => (left ? el.left(off) : el.right(off));
    const down = (el, off) => (top ? el.top(off) : el.bottom(off));
    const at = (el, x, y = x) => down(across(el, x), y);
    const handle = at(div().absolute().w(16).h(top ? 9 : 16), 3, top ? 1 : 3)
      .child(at(div().absolute().w(10).h(2).rounded(1).bg(INK.t3), 0))
      .child(at(div().absolute().w(2).h(top ? 7 : 10).rounded(1).bg(INK.t3), 0));
    const grip = at(div().id(`o-pip-grip-${corner}`).absolute().w(PIP_GRIP).h(top ? PIP_GRIP_TOP : PIP_GRIP), 0)
      .tooltip("Drag to resize (− / = with the keyboard)")
      .on_mouse_down("left", (event, cx) => {
        cx.stop_propagation();
        this.pipGripDown(corner, event, cx);
      })
      .when(this.pipHover || Boolean(this.pipDrag), (el) => el.child(handle));
    return corner === "tl" || corner === "br" ? grip.cursor_nwse_resize() : grip.cursor_nesw_resize();
  }

  // A press on a corner grip: the opposite corner is held and the size follows the pointer from
  // there. A corner with room only inside the window keeps the window and changes its size; a
  // corner that reaches past it opens the window again as the drag's canvas, which the pointer
  // stays over. A new press while a drag is going only ends that drag.
  pipGripDown(corner, event, cx) {
    if (this.closing) return;
    if (this.pipDrag) {
      this.pipPointerUp(cx);
      return;
    }
    const z = zoomOf();
    const viewport = readViewport();
    const here = this.pipHere();
    const drawn = this.pipDrawn();
    // The drag's rect keeps x·y in window px and w·h in logical px, the size the rest reads; the
    // canvas, the held corner and the grabbed point are window px, the size the pointer reports.
    const rect = { x: here.x, y: here.y, w: drawn.w, h: drawn.h };
    const size = { x: here.x, y: here.y, w: Math.round(drawn.w * z), h: Math.round(drawn.h * z) };
    const box = boxFor(here, pipArea(viewport, layout(), z), windowBox(viewport));
    const canvas = dragCanvas(size, corner, box);
    const left = corner === "tl" || corner === "bl";
    const top = corner === "tl" || corner === "tr";
    const point = { x: left ? size.x : size.x + size.w, y: top ? size.y : size.y + size.h };
    const drag = {
      corner, from: { x: here.x, y: here.y },
      anchor: { x: left ? size.x + size.w : size.x, y: top ? size.y + size.h : size.y },
      grab: { x: (event.position?.x ?? point.x) - point.x, y: (event.position?.y ?? point.y) - point.y },
      canvas, rect,
    };
    this.pipDrag = drag;
    this.dragAt = Date.now();
    this.dragHeard = true;
    if (samePlace(canvas, rect)) {
      cx.notify();
      return;
    }
    const home = pipPlace(this.demo);
    this.reopenAt({
      x: home?.x ?? canvas.x, y: home?.y ?? canvas.y, gen: (home?.gen ?? 0) + 1,
      vw: home?.vw ?? null, vh: home?.vh ?? null,
    }, { x: canvas.x, y: canvas.y }, Date.now(), drag);
  }

  // A move over the canvas while a grip is dragged: the window's rect follows the pointer between
  // the least and largest sizes and inside the canvas.
  pipPointerMove(position, cx) {
    if (this.closing) return;
    const drag = this.pipDrag;
    if (!drag || !position) return;
    this.dragHeard = true;
    const next = cornerRect(drag, position, zoomOf());
    if (next.w === drag.rect.w && next.h === drag.rect.h && samePlace(next, drag.rect)) return;
    drag.rect = next;
    cx.notify();
  }

  // Letting go, or the pointer leaving, ends a grip drag where it got to: the size is kept, and a
  // window whose top-left moved is moved there through movePip, so the home is that place. The
  // comparison is against both the place this copy opened at and the place the drag started from: a
  // left or top corner reopened the window at the canvas's top-left, so a drag that grows back to
  // that point still moved the window from where it was.
  pipPointerUp(cx) {
    if (this.closing) return;
    const drag = this.pipDrag;
    if (!drag) return;
    this.pipDrag = null;
    this.dragAt = null;
    this.dragHeard = false;
    setPipSize({ w: drag.rect.w, h: drag.rect.h }, this.demo);
    if (!samePlace(drag.rect, this.shownAt) || !samePlace(drag.rect, drag.from ?? drag.rect)) {
      this.movePip({ x: drag.rect.x, y: drag.rect.y });
    }
    cx.notify();
  }

  // One line of the keys the PiP adds to the office's, at the bottom centre and clear of the
  // corner grips.
  pipKeysLine() {
    return div().id("o-pip-keys").absolute().left(PIP_GRIP + 2).right(PIP_GRIP + 2).bottom(6).h(20).flex().justify_center()
      .child(div().max_w_full().h(20).px(8).flex().items_center().rounded(10).bg(INK.surface).border(1).border_color(INK.line)
        .child(div().min_w(0).truncate().text_size(11).font_family(FONT).font_bold().text_color(INK.t2)
          .child("⌥←→↑↓ Edge · −/= Size · P Office · ? Keys · Esc")));
  }

  // ---- the office band's chips and the PiP strip ----

  /** What the band shows besides the state counts: the pages to read and the search. */
  bandParts() {
    const parts = toolsParts({ pages: this.meta?.pages ?? [], unreadable: this.meta?.unreadablePages?.length ?? 0 });
    return {
      pageCount: this.demo ? 2 : parts.pageCount,
      query: this.query,
      searching: Boolean(this.handle?.is_focused?.()),
    };
  }

  openPages(cx) { this.openChipPage(this.meta?.pages ?? [], cx); }

  focusSearch(cx) {
    this.grabKeys(cx);
    cx.notify();
  }

  // A page chip with nothing to open says so through the flash every office copy shows.
  openChipPage(pages, cx) {
    if (this.demo) return;
    const page = Array.isArray(pages) ? pages[0] : null;
    if (!page?.openable) {
      setShared(FLASH_KEY, { token: `${Date.now()}-${Math.random()}`, message: NO_PAGE_FLASH });
      return;
    }
    cx.spawn(async () => { await openPageFiles(page); });
  }

  // The strip's copy only keeps the PiP window open; it draws nothing in the tab strip.
  strip() {
    return div();
  }

  // The steps the office and the PiP both draw through: their own geometry, data and selection, so
  // the two scenes cannot drift.
  sceneData() {
    this.geo = geometry(this.k ?? 1);
    const data = this.viewData();
    this.drawnFocus = this.focusKey();
    this.followFocus(data);
    const selected = this.selectedItem(data);
    if (selected) {
      this.sel = selected.sessionId;
      this.selIndex = Math.max(0, data.groups.flatMap((group) => group.items).indexOf(selected));
      this.handoff = false;
    }
    return data;
  }

  render(cx) {
    if (this.role === "pip") return this.pipView(cx);
    if (this.role === "strip") return this.strip();
    if (this.role === "links") return this.linksMenu();
    const data = this.sceneData();
    const g = this.geo;
    const focused = this.handle.is_focused();
    this.catchKeys("office", cx);
    this.publish(data, focused);
    this.publishNotice();
    return v_flex().id("cozy-office").relative().size_full().min_h(0).rounded(12).bg(INK.surface).text_color(INK.t1)
      .font_family(FONT).text_size(g.TEXT.base)
      .track_focus(this.handle)
      .on_key_down((event, cx) => this.key(event, cx))
      .on_size_change((size, cx) => this.sizeChanged(size, cx))
      .child(v_flex().flex_1().min_h(0).rounded(12).overflow_hidden()
        .child(officeView(this, data.groups.flatMap((group) => group.items), data.now)))
      .when(this.showKeys, (el) => el.child(this.legend()))
      .when(focused, (el) => el.child(this.focusRing()));
  }

  // A click picks the person and frames them; a click on the one already framed opens their terminal.
  // In the PiP the click also brings the keyboard there.
  clickPerson(item, cx) {
    if (!item) return;
    if (this.role === "pip") this.grabKeys(cx);
    if (this.camFocus && this.sel === item.sessionId) this.goTo(item, cx);
    else {
      this.sel = item.sessionId;
      this.camFocus = true;
    }
    cx.notify();
  }

  emptyMessage() {
    const chipFilter = shared("cozy-filter");
    return emptyText(this.query, Array.isArray(chipFilter) && chipFilter.length > 0);
  }

  officeJump(kind, cx) {
    this.jump(kind, this.viewData(), cx);
    this.camFocus = true;
    cx.notify();
  }

  // While the strip has the keyboard, a 2 px accent ring lies along the panel's 12 px edge,
  // the way a focused work pane's frame turns amber. Drawn last so it paints over the cards.
  focusRing() {
    return div().id("cards-focus-ring").absolute().left(0).top(0).right(0).bottom(0)
      .rounded(12).border(2).border_color(INK.amberInk);
  }
}
