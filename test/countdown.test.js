import { test } from "node:test";
import assert from "node:assert/strict";
import { nextMinuteBoundary, msUntil, signalPhase } from "../js/countdown.js";

test("nextMinuteBoundary returns next :00", () => {
  // 12:00:30.000 -> 12:01:00.000
  const base = Date.UTC(2026, 6, 12, 12, 0, 30, 0);
  assert.equal(nextMinuteBoundary(base), Date.UTC(2026, 6, 12, 12, 1, 0, 0));
});

test("nextMinuteBoundary on exact boundary jumps to the following one", () => {
  const onDot = Date.UTC(2026, 6, 12, 12, 0, 0, 0);
  assert.equal(nextMinuteBoundary(onDot), Date.UTC(2026, 6, 12, 12, 1, 0, 0));
});

test("msUntil is signed difference", () => {
  assert.equal(msUntil(1000, 1250), 250);
  assert.equal(msUntil(1300, 1250), -50);
});

test("signalPhase: far away -> idle", () => {
  const t = 100000;
  assert.equal(signalPhase(t - 10000, t, 200).phase, "idle");
});

test("signalPhase: lead time pulls the GO earlier", () => {
  const t = 100000;
  // now = t-150, lead 200 -> eff = t+50 >= t -> go
  assert.equal(signalPhase(t - 150, t, 200).phase, "go");
});

test("signalPhase: tick buckets by whole seconds of eff-to-target", () => {
  const t = 100000;
  const lead = 0;
  assert.equal(signalPhase(t - 2500, t, lead).phase, "tick3"); // 2.5s left
  assert.equal(signalPhase(t - 1500, t, lead).phase, "tick2"); // 1.5s left
  assert.equal(signalPhase(t - 500, t, lead).phase, "tick1");  // 0.5s left
});

test("signalPhase reports msLeft to target (not eff)", () => {
  const t = 100000;
  assert.equal(signalPhase(t - 800, t, 0).msLeft, 800);
});

test("signalPhase: exact bucket boundaries", () => {
  const t = 100000;
  assert.equal(signalPhase(t - 3000, t, 0).phase, "idle");  // 3000ms left -> not yet tick3
  assert.equal(signalPhase(t - 2000, t, 0).phase, "tick3"); // 2000ms left -> tick3 bucket
  assert.equal(signalPhase(t - 1000, t, 0).phase, "tick2"); // 1000ms left -> tick2 bucket
  assert.equal(signalPhase(t, t, 0).phase, "go");           // 0ms left -> go
});

import { cueTimes } from "../js/countdown.js";

test("cueTimes: three ticks then go, all pulled by lead", () => {
  const t = 100000;
  assert.deepEqual(cueTimes(t, 200), [
    { at: t - 200 - 3000, kind: "tick" },
    { at: t - 200 - 2000, kind: "tick" },
    { at: t - 200 - 1000, kind: "tick" },
    { at: t - 200, kind: "go" },
  ]);
});

test("cueTimes: zero lead aligns go with target", () => {
  const cues = cueTimes(60000, 0);
  assert.equal(cues[3].at, 60000);
  assert.equal(cues[3].kind, "go");
});
