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

test("recommendLead: rounds to 5 and clamps to [-300,600]", () => {
  assert.equal(recommendLead(200, -23, 10), 175);
  assert.equal(recommendLead(30, -100, 10), -70); // 예측이 빠른 사람은 음수 리드타임이 정답
  assert.equal(recommendLead(0, -400, 10), -300);
  assert.equal(recommendLead(580, 40, 10), 600);
});

test("recommendLead: aims at target error when given (network delay)", () => {
  // 평균 -14ms인데 목표가 -50ms면 리드타임을 36ms 올려 더 일찍 누르게 유도
  assert.equal(recommendLead(200, -14, 10, -50), 235);
});

test("recommendLead: null when mean already within ±10 of aim", () => {
  assert.equal(recommendLead(200, -45, 10, -50), null);
});

import { isRealAttempt } from "../js/hitMeter.js";

test("isRealAttempt: within ±1500ms only", () => {
  assert.equal(isRealAttempt(55), true);
  assert.equal(isRealAttempt(-1500), true);
  assert.equal(isRealAttempt(-1501), false);
  assert.equal(isRealAttempt(30000), false);
});
