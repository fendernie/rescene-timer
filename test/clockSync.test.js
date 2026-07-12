import { test } from "node:test";
import assert from "node:assert/strict";
import { rttOf, bestSample, offsetFromSample, computeOffset, nowWith, syncOnce, syncOffset } from "../js/clockSync.js";

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

test("syncOnce packs fetch result into a sample", async () => {
  const fake = async () => ({ serverMs: 5050, sentAt: 5000, recvAt: 5100 });
  const s = await syncOnce(fake);
  assert.deepEqual(s, { t0: 5000, t1: 5100, serverMs: 5050 });
});

test("syncOffset aggregates rounds and marks ok", async () => {
  let n = 0;
  const fake = async () => {
    n += 1;
    // rtt shrinks each round; best is last (rtt 40, mid 20, server 30 -> +10)
    return { serverMs: 30, sentAt: 0, recvAt: n === 3 ? 40 : 200 };
  };
  const r = await syncOffset(fake, 3);
  assert.equal(r.ok, true);
  assert.equal(r.offsetMs, 10);
  assert.equal(r.rttMs, 40);
});

test("syncOffset returns ok:false when every round throws", async () => {
  const fail = async () => { throw new Error("blocked"); };
  const r = await syncOffset(fail, 3);
  assert.deepEqual(r, { offsetMs: 0, rttMs: Infinity, ok: false });
});

import { estimateOneWay } from "../js/clockSync.js";

test("estimateOneWay: null on empty samples", () => {
  assert.equal(estimateOneWay([]), null);
});

test("estimateOneWay: half of minimum rtt, rounded", () => {
  assert.equal(estimateOneWay([120, 95, 210]), 48);
});
