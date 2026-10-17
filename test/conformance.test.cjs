const test = require("node:test");
const assert = require("node:assert/strict");

const {
    computeReconformProps,
    computeTemplateConformance,
} = require("../.test-dist/src/core/conformance.js");

const map = (entries) => new Map(entries);

/**
 * AI: F4 — pure reconform/conformance rules.
 */
test("add-missing fills defaults, keeps file values and appends extras", () => {
    const template = map([["a", 1], ["b", 2]]);
    const file = map([["b", 20], ["c", 30]]);

    assert.deepEqual([...computeReconformProps(template, file, "add-missing").entries()], [
        ["a", 1],
        ["b", 20],
        ["c", 30],
    ]);
});

test("remove-extra keeps only template keys with file values", () => {
    const template = map([["a", 1], ["b", 2]]);
    const file = map([["b", 20], ["c", 30]]);

    assert.deepEqual([...computeReconformProps(template, file, "remove-extra").entries()], [
        ["a", 1],
        ["b", 20],
    ]);
});

test("reset-defaults returns a copy of the template", () => {
    const template = map([["a", 1], ["b", 2]]);
    const file = map([["b", 20], ["c", 30]]);
    const result = computeReconformProps(template, file, "reset-defaults");

    assert.deepEqual([...result.entries()], [["a", 1], ["b", 2]]);
    assert.notEqual(result, template);
});

test("template conformance: parent properties are required, extras are allowed", () => {
    const parent = map([["a", 1], ["b", 2]]);

    const complete = computeTemplateConformance(map([["a", 1], ["b", 2], ["c", 3]]), parent);
    assert.equal(complete.isValid, true);
    assert.deepEqual([...complete.neededProps], []);
    assert.deepEqual([...complete.extraProps], ["c"]);

    const incomplete = computeTemplateConformance(map([["a", 1]]), parent);
    assert.equal(incomplete.isValid, false);
    assert.deepEqual([...incomplete.neededProps], ["b"]);
    assert.deepEqual([...incomplete.extraProps], []);
});

test("template conformance ignores the synthetic position key", () => {
    const parent = map([["a", 1], ["position", {}]]);
    const child = map([["a", 1], ["position", {}]]);

    const result = computeTemplateConformance(child, parent);
    assert.equal(result.isValid, true);
    assert.deepEqual([...result.neededProps], []);
    assert.deepEqual([...result.extraProps], []);
});
