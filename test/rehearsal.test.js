import { test } from "node:test";
import assert from "node:assert/strict";
import { BASE_FIELDS, SURPRISE_POOL, buildFields, elapsedSec } from "../js/rehearsal.js";

test("buildFields: low roll -> base fields only", () => {
  assert.deepEqual(buildFields(0), BASE_FIELDS);
  assert.deepEqual(buildFields(0.39), BASE_FIELDS);
});

test("buildFields: high roll -> base + one surprise from pool", () => {
  const f = buildFields(0.9);
  assert.equal(f.length, BASE_FIELDS.length + 1);
  assert.ok(SURPRISE_POOL.includes(f[f.length - 1]));
});

test("buildFields: never mutates BASE_FIELDS", () => {
  const before = [...BASE_FIELDS];
  buildFields(0.99).push("oops");
  assert.deepEqual(BASE_FIELDS, before);
});

test("elapsedSec: rounds to 0.1s", () => {
  assert.equal(elapsedSec(1000, 13340), 12.3);
  assert.equal(elapsedSec(0, 50), 0.1);
});
