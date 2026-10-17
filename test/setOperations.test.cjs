const test = require("node:test");
const assert = require("node:assert/strict");

const {
    intersection,
    union,
    difference,
    symmetricDifference,
    isSubsetOf,
    isSupersetOf,
} = require("../.test-dist/src/core/setOperations.js");

/**
 * AI: F4 — pure Set helpers (mobile-safe replacement of the TC39 methods).
 */
test("intersection keeps the shared elements", () => {
    assert.deepEqual([...intersection(new Set([1, 2, 3]), new Set([2, 3, 4]))], [2, 3]);
    assert.deepEqual([...intersection(new Set(), new Set([1]))], []);
});

test("union merges both sets without duplicates", () => {
    assert.deepEqual([...union(new Set([1, 2]), new Set([2, 3]))], [1, 2, 3]);
    assert.deepEqual([...union(new Set(), new Set())], []);
});

test("difference keeps only elements of the first set", () => {
    assert.deepEqual([...difference(new Set([1, 2, 3]), new Set([2]))], [1, 3]);
    assert.deepEqual([...difference(new Set([1]), new Set([1, 2]))], []);
});

test("symmetricDifference keeps elements present in exactly one set", () => {
    assert.deepEqual([...symmetricDifference(new Set([1, 2]), new Set([2, 3]))], [1, 3]);
    assert.deepEqual([...symmetricDifference(new Set([1, 2]), new Set([1, 2]))], []);
});

test("isSubsetOf / isSupersetOf match the set semantics", () => {
    assert.equal(isSubsetOf(new Set([1, 2]), new Set([1, 2, 3])), true);
    assert.equal(isSubsetOf(new Set([1, 4]), new Set([1, 2, 3])), false);
    assert.equal(isSubsetOf(new Set(), new Set([1])), true);
    assert.equal(isSupersetOf(new Set([1, 2, 3]), new Set([1, 2])), true);
    assert.equal(isSupersetOf(new Set([1, 2]), new Set([1, 2, 3])), false);
});
