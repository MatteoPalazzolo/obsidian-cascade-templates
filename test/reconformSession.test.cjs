const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createSession,
    sessionPush,
    sessionBack,
    sessionSetPhase,
    sessionEnd,
    sessionHasHistory,
    sweepSessions,
} = require("../.test-dist/src/core/reconformSession.js");

const map = (entries) => new Map(entries);

/**
 * AI: B — the panel session belongs to the note (path), not to the view.
 */

test("session: push and back restore both frontmatter and phase", () => {
    const session = createSession();
    sessionSetPhase(session, 1);
    sessionPush(session, map([["a", 1]]), 1);

    sessionSetPhase(session, 2);
    assert.equal(sessionHasHistory(session), true);

    const snapshot = sessionBack(session);
    assert.deepEqual([...snapshot.props.entries()], [["a", 1]]);
    assert.equal(snapshot.phase, 1);
    assert.equal(session.phase, 1);
    assert.equal(sessionHasHistory(session), false);
});

test("session: the snapshot is copied", () => {
    const session = createSession();
    const props = map([["a", 1]]);
    sessionPush(session, props, 0);
    props.set("a", 99);

    const snapshot = sessionBack(session);
    assert.equal(snapshot.props.get("a"), 1);
});

test("session: ending forgets the stack and resets the cursor", () => {
    const session = createSession();
    sessionPush(session, map([["a", 1]]), 1);
    sessionSetPhase(session, 2);

    sessionEnd(session);
    assert.equal(sessionHasHistory(session), false);
    assert.equal(session.phase, 0);
});

test("session: sweep drops only the notes no tab shows", () => {
    const sessions = new Map([
        ["a.md", createSession()],
        ["b.md", createSession()],
    ]);

    const removed = sweepSessions(sessions, new Set(["a.md"]));
    assert.deepEqual(removed, ["b.md"]);
    assert.equal(sessions.has("a.md"), true);
    assert.equal(sessions.has("b.md"), false);
});
