const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildForest,
    countIssues,
    collectIssueGroups,
    compareVaultPaths,
} = require("../.test-dist/src/core/forest.js");

const TEMPLATE = "!Template.md";
const map = (entries) => new Map(entries);

/**
 * AI: B — pure forest derivation.
 *
 * Fixture:
 *   projects/!Template.md            root (a, b)
 *   projects/alpha/!Template.md      child missing b
 *   projects/alpha/note-missing.md   missing a (vs alpha)
 *   projects/alpha/note-extra.md     extra x (vs alpha)
 *   projects/alpha/no-frontmatter.md no frontmatter (not a participant)
 *   projects/alpha/deep/!Template.md child of alpha (a, c)
 *   projects/alpha/deep/deeper/note.md inherits deep
 *   projects/beta/!Template.md       child missing a and b
 *   projects/beta/note.md            inherits root
 *   other/note.md                    outside any cascade
 *   z/!Template.md                   second local root
 */
function fixture() {
    return [
        { path: "projects/!Template.md", props: map([["a", 1], ["b", 2]]) },
        { path: "projects/alpha/!Template.md", props: map([["a", 1]]) },
        { path: "projects/alpha/note-missing.md", props: map([]) },
        { path: "projects/alpha/note-extra.md", props: map([["a", 1], ["x", 9]]) },
        { path: "projects/alpha/no-frontmatter.md", props: null },
        { path: "projects/alpha/deep/!Template.md", props: map([["a", 1], ["c", 3]]) },
        { path: "projects/alpha/deep/deeper/note.md", props: map([["a", 1], ["c", 3]]) },
        { path: "projects/beta/!Template.md", props: map([]) },
        { path: "projects/beta/note.md", props: map([]) },
        { path: "other/note.md", props: map([["a", 1]]) },
        { path: "z/!Template.md", props: map([["z", 1]]) },
    ];
}

function build() {
    return buildForest({ files: fixture(), templateFilename: TEMPLATE });
}

test("forest: only templates without an ancestor are local roots", () => {
    const forest = build();
    assert.deepEqual(forest.roots.map(root => root.path), ["projects", "z"]);

    assert.equal(forest.nodes.get("projects/!Template.md").localRoot, true);
    assert.equal(forest.nodes.get("projects/alpha/!Template.md").localRoot, false);
    assert.equal(forest.nodes.get("projects/alpha/deep/!Template.md").localRoot, false);
});

test("forest: note states follow the nearest template", () => {
    const forest = build();

    assert.equal(forest.nodes.get("projects/alpha/note-missing.md").state, "missing");
    assert.equal(forest.nodes.get("projects/alpha/note-extra.md").state, "extra");
    assert.equal(forest.nodes.get("projects/alpha/no-frontmatter.md").state, "none");
    assert.equal(forest.nodes.get("projects/alpha/deep/deeper/note.md").state, "ok");
    assert.equal(forest.nodes.get("projects/beta/note.md").state, "ok");
});

test("forest: templates are missing only when the parent has more keys", () => {
    const forest = build();

    assert.equal(forest.nodes.get("projects/!Template.md").state, "ok");
    assert.equal(forest.nodes.get("projects/alpha/!Template.md").state, "missing");
    assert.equal(forest.nodes.get("projects/alpha/deep/!Template.md").state, "ok");
    assert.equal(forest.nodes.get("projects/beta/!Template.md").state, "missing");
});

test("forest: counters describe the action scope", () => {
    const forest = build();

    assert.deepEqual(forest.folders.get("projects").counts, {
        templates: 2,
        notesMissing: 1,
        notesExtra: 1,
    });

    assert.equal(countIssues(forest), 4);
    assert.deepEqual(collectIssueGroups(forest).templates.map(node => node.path), [
        "projects/alpha/!Template.md",
        "projects/beta/!Template.md",
    ]);
});

test("forest: descendants state excludes the folder's own template", () => {
    const forest = build();

    // Root: the template conforms, the subtree does not.
    const root = forest.folders.get("projects");
    assert.equal(root.state, "missing");
    assert.equal(root.descendantsState, "missing");

    // Alpha: both the template and a descendant are broken.
    const alpha = forest.folders.get("projects/alpha");
    assert.equal(alpha.state, "missing");
    assert.equal(alpha.descendantsState, "missing");

    // Beta: the template is broken, but the only note is fine.
    const beta = forest.folders.get("projects/beta");
    assert.equal(beta.state, "missing");
    assert.equal(beta.descendantsState, "ok");

    // No notes or child folders below this root.
    assert.equal(forest.folders.get("z").descendantsState, "none");
});

test("forest: descendants state reports extra properties without missing keys", () => {
    const forest = buildForest({
        files: [
            { path: "p/!Template.md", props: map([["a", 1]]) },
            { path: "p/note.md", props: map([["a", 1], ["x", 2]]) },
        ],
        templateFilename: TEMPLATE,
    });

    assert.equal(forest.folders.get("p").state, "extra");
    assert.equal(forest.folders.get("p").descendantsState, "extra");
});

test("forest: a template chain is sound only when every ancestor conforms", () => {
    const forest = build();

    assert.equal(forest.nodes.get("projects/beta/note.md").chainSound, false);
    assert.equal(forest.nodes.get("projects/alpha/deep/deeper/note.md").chainSound, false);
    assert.equal(forest.nodes.get("z/!Template.md").chainSound, true);
});

test("forest: notes outside every cascade are counted separately", () => {
    const forest = build();

    assert.deepEqual(forest.outsideNotes.map(node => node.path), ["other/note.md"]);
});

test("forest: folders put child folders, then the template, then the notes", () => {
    const forest = build();
    const alpha = forest.folders.get("projects/alpha");

    assert.deepEqual(alpha.folders.map(folder => folder.path), ["projects/alpha/deep"]);
    assert.equal(alpha.template.path, "projects/alpha/!Template.md");
    assert.deepEqual(alpha.notes.map(note => note.path), [
        "projects/alpha/no-frontmatter.md",
        "projects/alpha/note-extra.md",
        "projects/alpha/note-missing.md",
    ]);
});

test("forest: folders without a template are flattened recursively", () => {
    const forest = buildForest({
        files: [
            { path: "projects/!Template.md", props: map([["a", 1]]) },
            { path: "projects/alpha/!Template.md", props: map([["a", 1]]) },
            { path: "projects/alpha/skip/note.md", props: map([["a", 1]]) },
            { path: "projects/alpha/skip/more/note-2.md", props: map([["a", 1]]) },
            { path: "projects/alpha/skip/more/deep/!Template.md", props: map([["a", 1]]) },
            { path: "projects/alpha/skip/more/deep/note-3.md", props: map([["a", 1]]) },
        ],
        templateFilename: TEMPLATE,
    });

    assert.deepEqual([...forest.folders.keys()].sort(), [
        "projects",
        "projects/alpha",
        "projects/alpha/skip/more/deep",
    ]);

    const alpha = forest.folders.get("projects/alpha");
    assert.deepEqual(alpha.folders.map(folder => folder.path), [
        "projects/alpha/skip/more/deep",
    ]);
    assert.deepEqual(alpha.notes.map(note => note.path), [
        "projects/alpha/skip/more/note-2.md",
        "projects/alpha/skip/note.md",
    ]);
    assert.deepEqual(alpha.counts, { templates: 0, notesMissing: 0, notesExtra: 0 });

    const deep = forest.folders.get("projects/alpha/skip/more/deep");
    assert.equal(deep.parentPath, "projects/alpha");
    assert.deepEqual(deep.notes.map(note => note.path), [
        "projects/alpha/skip/more/deep/note-3.md",
    ]);

    assert.equal(forest.nodes.get("projects/alpha/skip/note.md").scopeFolder, "projects/alpha");
    assert.equal(
        forest.nodes.get("projects/alpha/skip/more/deep/note-3.md").scopeFolder,
        "projects/alpha/skip/more/deep"
    );
    assert.deepEqual(forest.roots.map(root => root.path), ["projects"]);
    assert.equal(forest.folders.get("projects").parentPath, null);
});

test("forest: a template under template-less folders is a local root", () => {
    const forest = buildForest({
        files: [
            { path: "loose/a/b/!Template.md", props: map([["x", 1]]) },
            { path: "loose/a/b/note.md", props: map([["x", 1]]) },
            { path: "loose/a/note.md", props: map([["x", 1]]) },
        ],
        templateFilename: TEMPLATE,
    });

    assert.deepEqual(forest.roots.map(root => root.path), ["loose/a/b"]);
    assert.deepEqual(forest.outsideNotes.map(note => note.path), ["loose/a/note.md"]);
    assert.equal(forest.nodes.get("loose/a/note.md").scopeFolder, null);
});

test("forest: path ordering is numeric", () => {
    assert.ok(compareVaultPaths("chapter 2", "chapter 10") < 0);
});

test("forest: a template at the vault root is a local root", () => {
    const forest = buildForest({
        files: [
            { path: "!Template.md", props: map([["a", 1]]) },
            { path: "note.md", props: map([["a", 1]]) },
        ],
        templateFilename: TEMPLATE,
    });

    assert.deepEqual(forest.roots.map(root => root.path), [""]);
    assert.equal(forest.nodes.get("note.md").state, "ok");
    assert.equal(forest.nodes.get("!Template.md").localRoot, true);
});
