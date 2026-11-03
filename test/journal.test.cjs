const test = require("node:test");
const assert = require("node:assert/strict");

const { REMOVED, diffProps, applyPropertyChanges } = require("../.test-dist/src/core/frontmatterChanges.js");
const {
    createJournal,
    appendOperation,
    appendEntryToOperation,
    enforceBudget,
    estimateFilesBytes,
    journalBytes,
    listEntries,
    planRewind,
    removeEntries,
} = require("../.test-dist/src/core/journal.js");

const map = (entries) => new Map(entries);

function file(path, before, changes) {
    return { path, before: map(before), changes };
}

function entryOf(state, index = 0) {
    const entries = listEntries(state);
    const entry = entries[index];
    assert.ok(entry, `missing entry ${index}`);
    return entry;
}

/**
 * AI: B — change records and journal target-state rewind.
 */

test("frontmatterChanges: removals are explicit, untouched keys are not listed", () => {
    const before = map([["a", 1], ["b", 2], ["c", 3]]);
    const after = map([["a", 1], ["b", 20], ["d", 4]]);
    const changes = diffProps(before, after);

    assert.deepEqual(changes.map(change => [change.key, change.after]), [
        ["b", 20],
        ["d", 4],
        ["c", REMOVED],
    ]);

    const applied = applyPropertyChanges(before, changes);
    assert.deepEqual([...applied.entries()], [["a", 1], ["b", 20], ["d", 4]]);
});

test("journal: a rewind restores the oldest before state, not the last delta", () => {
    const journal = createJournal(1024 * 1024);

    appendOperation(journal, {
        origin: "batch",
        files: [file("n.md", [["a", 1], ["b", 2]], [{ key: "a", after: 3 }])],
    });
    appendOperation(journal, {
        origin: "batch",
        files: [file("n.md", [["a", 3], ["b", 2]], [{ key: "b", after: REMOVED }])],
    });

    const plan = planRewind(
        journal,
        entryOf(journal).id,
        new Map([["n.md", map([["a", 3], ["c", 9]])]]),
        new Set(["n.md"])
    );

    assert.equal(plan.entryIds.length, 2);
    assert.equal(plan.writes.length, 1);
    assert.deepEqual([...plan.writes[0].patch.entries()], [["a", 1], ["b", 2]]);
    assert.equal(plan.conflictCount, 0);
});

test("journal: a manual edit on a touched key is a conflict", () => {
    const journal = createJournal(1024 * 1024);
    appendOperation(journal, {
        origin: "batch",
        files: [file("n.md", [["a", 1]], [{ key: "a", after: 2 }])],
    });

    const plan = planRewind(
        journal,
        entryOf(journal).id,
        new Map([["n.md", map([["a", 99]])]]),
        new Set(["n.md"])
    );

    assert.equal(plan.conflictCount, 1);
    assert.deepEqual(plan.writes[0].conflicts[0], { key: "a", current: 99, restored: 1 });
});

test("journal: a file already at the target is not a write and not a conflict", () => {
    const journal = createJournal(1024 * 1024);
    appendOperation(journal, {
        origin: "batch",
        files: [file("n.md", [["a", 1], ["b", 2]], [{ key: "a", after: 3 }])],
    });

    const plan = planRewind(
        journal,
        entryOf(journal).id,
        new Map([["n.md", map([["a", 1], ["b", 2], ["c", 9]])]]),
        new Set(["n.md"])
    );

    assert.equal(plan.writes.length, 0);
    assert.equal(plan.conflictCount, 0);
});

test("journal: a retry after a partial rewind has no false conflicts", () => {
    const journal = createJournal(1024 * 1024);
    appendOperation(journal, {
        origin: "batch",
        files: [file("n.md", [["a", 1], ["b", 2]], [{ key: "a", after: 3 }, { key: "b", after: REMOVED }])],
    });

    const plan = planRewind(
        journal,
        entryOf(journal).id,
        new Map([["n.md", map([["a", 1], ["c", 9]])]]),
        new Set(["n.md"])
    );

    assert.deepEqual([...plan.writes[0].patch.entries()], [["a", 1], ["b", 2]]);
    assert.equal(plan.conflictCount, 0);
});

test("journal: a file that no longer exists is skipped", () => {
    const journal = createJournal(1024 * 1024);
    appendOperation(journal, {
        origin: "batch",
        files: [file("gone.md", [["a", 1]], [{ key: "a", after: 2 }])],
    });

    const plan = planRewind(journal, entryOf(journal).id, new Map(), new Set());
    assert.deepEqual(plan.missingPaths, ["gone.md"]);
    assert.equal(plan.writes.length, 0);
});

test("journal: FIFO eviction removes whole operations and reports truncation", () => {
    const first = [file("a.md", [["a", "first"]], [{ key: "a", after: "first!" }])];
    const second = [file("b.md", [["b", "second"]], [{ key: "b", after: "second!" }])];
    const third = [file("c.md", [["c", "third"]], [{ key: "c", after: "third!" }])];
    const fourth = [file("d.md", [["d", "fourth"]], [{ key: "d", after: "fourth!" }])];

    const budget = estimateFilesBytes(second) + estimateFilesBytes(third) + estimateFilesBytes(fourth) + 10;
    const journal = createJournal(budget);

    appendOperation(journal, { origin: "batch", files: first });
    appendOperation(journal, { origin: "batch", files: second });
    appendOperation(journal, { origin: "batch", files: third });
    appendOperation(journal, { origin: "batch", files: fourth });

    assert.equal(journal.operations.length, 3);
    assert.equal(journal.truncatedOperations, 1);
    assert.equal(journal.operations[0].entries[0].files[0].path, "b.md");
});

test("journal: Fix all is one budget unit even with several entries", () => {
    const journal = createJournal(3000);
    const operation = appendOperation(journal, {
        origin: "fix-all",
        routine: { id: "routine", step: 1, total: 3 },
        files: [file("a.md", [["a", "1"]], [{ key: "a", after: "2" }])],
    });
    assert.ok(operation.entry);

    appendEntryToOperation(journal, "op-1", [file("b.md", [["b", "1"]], [{ key: "b", after: "2" }])], {
        id: "op-1",
        step: 2,
        total: 3,
    });

    assert.equal(journal.operations.length, 1);
    assert.equal(journal.operations[0].entries.length, 2);

    const dropped = enforceBudget(journal);
    assert.equal(dropped.droppedOperations, 0);
});

test("journal: identical maps are interned in the byte estimate", () => {
    const one = file("a.md", [["a", 1], ["b", 2]], []);
    const two = file("b.md", [["a", 1], ["b", 2]], []);

    assert.equal(estimateFilesBytes([one]), estimateFilesBytes([one, two]));
});

test("journal: removing entries drops an operation that becomes empty", () => {
    const journal = createJournal(1024 * 1024);
    appendOperation(journal, {
        origin: "batch",
        files: [file("a.md", [["a", 1]], [{ key: "a", after: 2 }])],
    });

    removeEntries(journal, [entryOf(journal).id]);
    assert.equal(journal.operations.length, 0);
    assert.equal(journalBytes(journal), 0);
});
