// Invented sessions for preview pictures (props().demo): no real names, folders or tickets.
const MIN = 60 * 1000;
const ROWS = [
  ["s-ada", "orbit", "needs", "Auth cleanup", "Approve the migration plan?", 14, "Should I apply the migration to staging now?"],
  ["s-ben", "lumen", "approve", "Release 2.4", "Allow npm publish?", 3, "Ready to publish 2.4 to npm?"],
  ["s-cy", "orbit", "working", "Refactor auth middleware", "", 22, "Token check moved into one middleware."],
  ["s-ivy", "orbit", "working", "Session store tests", "", 9, "Two flaky tests left in the store."],
  ["s-dee", "lumen", "working", "Write release notes", "", 8, "Notes grouped by feature area."],
  ["s-eli", "pebble", "working", "Profile cold start", "", 41, "Cold start is down to 1.8 s."],
  ["s-jo", "kite", "working", "Map tile cache", "", 5, "Tiles now cached per zoom level."],
  ["s-fay", "pebble", "done", "Bump dependencies", "All checks passed", 2, "All checks passed after the bump."],
  ["s-gus", "orbit", "done", "Draft API docs", "Docs drafted for review", 19, "Docs are drafted for review."],
  ["s-hal", "lumen", "idle", "Changelog sweep", "", 33, "Nothing left to sweep this week."],
];

export function demoItems(now = Date.now()) {
  return ROWS.map(([id, space, state, title, message, mins, last]) => {
    const group = state === "needs" || state === "approve" ? "attention" : state === "done" || state === "idle" ? "done" : "working";
    return {
      sessionId: id, ackKey: id, group, bucket: group === "attention" ? "wait" : group === "done" ? "done" : "working",
      raw: { waitingFor: state === "approve" ? "permission prompt" : state === "needs" ? "reply" : null, cwd: `/demo/${space}`, name: title },
      viewed: state === "idle", title, topic: title, message, answer: group === "attention" ? message : null, lastSentence: last,
      terminal: null, spot: { repo: space }, since: now - mins * MIN, sortDate: now - mins * MIN,
      steps: [], pages: [], extraPRs: [], counts: null, where: {}, background: { total: 0 },
    };
  });
}

/** The demo session a preview should open framed on, or null: build-layout.py --focus <id>. */
export function demoFocus(id) {
  return typeof id === "string" && ROWS.some(([sessionId]) => sessionId === id) ? id : null;
}

export function demoModel(now = Date.now()) {
  const items = demoItems(now);
  const attention = items.filter((i) => i.group === "attention");
  const working = items.filter((i) => i.group === "working");
  const done = items.filter((i) => i.group === "done");
  return { attention, working, done, counts: { attention: attention.length, working: working.length, done: done.length } };
}
