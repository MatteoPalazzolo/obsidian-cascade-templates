const test = require("node:test");
const assert = require("node:assert/strict");

const {
    mergeSecondOnFirstMap,
    computeMapConformance,
    areMapsEqual,
} = require("../.test-dist/src/core/mapOperations.js");

const map = (entries) => new Map(entries);

/**
 * AI: F4 — property merge, conformance and structural equality.
 */
test("merge keeps template order and file values on shared keys", () => {
    const template = map([["a", 1], ["b", 2]]);
    const file = map([["b", 20], ["c", 30]]);

    assert.deepEqual([...mergeSecondOnFirstMap(template, file).entries()], [
        ["a", 1],
        ["b", 20],
        ["c", 30],
    ]);
});

test("merge without tail drops file-only properties", () => {
    const template = map([["a", 1], ["b", 2]]);
    const file = map([["b", 20], ["c", 30]]);

    assert.deepEqual([...mergeSecondOnFirstMap(template, file, false).entries()], [
        ["a", 1],
        ["b", 20],
    ]);
});

test("merge never mutates its inputs", () => {
    const template = map([["a", 1]]);
    const file = map([["b", 2]]);
    mergeSecondOnFirstMap(template, file);
    assert.deepEqual([...template.entries()], [["a", 1]]);
    assert.deepEqual([...file.entries()], [["b", 2]]);
});

test("conformance reports missing before extra", () => {
    const template = map([["a", 1], ["b", 2]]);
    assert.equal(computeMapConformance(map([["a", 1], ["b", 2]]), template), "ok");
    assert.equal(computeMapConformance(map([["a", 1]]), template), "missing");
    assert.equal(computeMapConformance(map([["a", 1], ["b", 2], ["c", 3]]), template), "extra");
    // Both missing and extra: missing wins.
    assert.equal(computeMapConformance(map([["a", 1], ["c", 3]]), template), "missing");
});

test("areMapsEqual is order-sensitive and compares nested values", () => {
    assert.equal(areMapsEqual(map([["a", 1], ["b", 2]]), map([["a", 1], ["b", 2]])), true);
    assert.equal(areMapsEqual(map([["a", 1], ["b", 2]]), map([["b", 2], ["a", 1]])), false);
    assert.equal(areMapsEqual(map([["a", 1]]), map([["a", 2]])), false);
    assert.equal(areMapsEqual(map([["a", [1, 2]]]), map([["a", [1, 2]]])), true);
    assert.equal(areMapsEqual(map([["a", [1, 2]]]), map([["a", [2, 1]]])), false);
});
