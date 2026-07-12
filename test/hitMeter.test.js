import { test } from "node:test";
import assert from "node:assert/strict";
import { hitError, stats } from "../js/hitMeter.js";

test("hitError: positive means late", () => {
  assert.equal(hitError(1045, 1000), 45);
  assert.equal(hitError(980, 1000), -20);
});

test("stats empty", () => {
  assert.deepEqual(stats([]), { n: 0, mean: 0, stdev: 0, best: null, recent: [] });
});

test("stats computes mean and population stdev", () => {
  const r = stats([10, -10, 10, -10]);
  assert.equal(r.n, 4);
  assert.equal(r.mean, 0);
  assert.equal(r.stdev, 10);
});

test("stats.best = signed value with smallest magnitude", () => {
  assert.equal(stats([40, -12, 100]).best, -12);
});

test("stats.recent keeps last 10 in order", () => {
  const arr = Array.from({ length: 15 }, (_, i) => i);
  const r = stats(arr);
  assert.deepEqual(r.recent, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

import { recommendLead } from "../js/hitMeter.js";

test("recommendLead: null when fewer than 5 tries", () => {
  assert.equal(recommendLead(200, -25, 4), null);
});

test("recommendLead: null when mean within ±10ms (already good)", () => {
  assert.equal(recommendLead(200, -8, 10), null);
});

test("recommendLead: shifts lead by mean error", () => {
  assert.equal(recommendLead(200, -25, 10), 175);
  assert.equal(recommendLead(200, 20, 10), 220);
});

test("recommendLead: rounds to 5 and clamps to [0,600]", () => {
  assert.equal(recommendLead(200, -23, 10), 175);
  assert.equal(recommendLead(30, -100, 10), 0);
  assert.equal(recommendLead(580, 40, 10), 600);
});
