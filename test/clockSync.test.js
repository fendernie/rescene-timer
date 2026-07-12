import { test } from "node:test";
import assert from "node:assert/strict";
import { rttOf, bestSample, offsetFromSample, computeOffset, nowWith } from "../js/clockSync.js";

test("rttOf = t1 - t0", () => {
  assert.equal(rttOf({ t0: 1000, t1: 1120, serverMs: 1050 }), 120);
});

test("bestSample picks minimum rtt", () => {
  const s = [
    { t0: 0, t1: 200, serverMs: 100 },
    { t0: 0, t1: 40, serverMs: 100 },
    { t0: 0, t1: 90, serverMs: 100 },
  ];
  assert.equal(bestSample(s).t1, 40);
});

test("offsetFromSample = serverMs - midpoint", () => {
  // midpoint of [1000,1120] = 1060; server said 1090 -> offset +30
  assert.equal(offsetFromSample({ t0: 1000, t1: 1120, serverMs: 1090 }), 30);
});

test("computeOffset uses best sample and reports its rtt", () => {
  const s = [
    { t0: 0, t1: 200, serverMs: 130 },
    { t0: 0, t1: 40, serverMs: 30 }, // best: mid=20, offset=+10
  ];
  assert.deepEqual(computeOffset(s), { offsetMs: 10, rttMs: 40 });
});

test("computeOffset on empty -> zero offset, infinite rtt", () => {
  assert.deepEqual(computeOffset([]), { offsetMs: 0, rttMs: Infinity });
});

test("nowWith adds offset to injected clock", () => {
  assert.equal(nowWith(25, () => 1000), 1025);
});
