import { test } from "node:test";
import assert from "node:assert/strict";
import {
  median, robustSummary, safetyMargin, earlyRisk, planAdjust, checkVerify, practiceTargets,
} from "../js/calibration.js";

test("median: odd and even", () => {
  assert.equal(median([3, -1, 10]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test("robustSummary: drops values more than 100ms from median", () => {
  const r = robustSummary([-20, -10, 0, 10, 400]);
  assert.equal(r.n, 4);
  assert.equal(r.dropped, 1);
  assert.equal(r.median, -5);
});

test("robustSummary: sigma floored at 10ms (5 samples underestimate spread)", () => {
  assert.equal(robustSummary([5, 5, 5, 5, 5]).sigma, 10);
});

test("safetyMargin: 3x total spread, clamped to [35,220]", () => {
  assert.equal(safetyMargin({ sigmaMs: 10, n: 5 }), 35);
  const m = safetyMargin({ sigmaMs: 25, n: 5, clockUncMs: 10, netJitterMs: 5 });
  assert.ok(m > 75 && m < 95, `margin ${m}`);
  assert.equal(safetyMargin({ sigmaMs: 500, n: 5 }), 220);
});

test("earlyRisk: arrival centred on 00 -> 50%, +2.5 sigma -> under 1%, +3 sigma -> ~0.1%", () => {
  assert.ok(earlyRisk({ arrivalMeanMs: 75, sigmaTotMs: 25 }) < 0.002);
  assert.equal(Math.round(earlyRisk({ arrivalMeanMs: 0, sigmaTotMs: 25 }) * 100), 50);
  assert.ok(earlyRisk({ arrivalMeanMs: 62.5, sigmaTotMs: 25 }) < 0.01);
  assert.ok(earlyRisk({ arrivalMeanMs: -50, sigmaTotMs: 25 }) > 0.95);
});

test("planAdjust: moves lead so median click lands on margin minus network delay", () => {
  // 클릭 중앙값 -30ms, 지연 40ms → 도착 +10ms. 여유 35ms 목표면 클릭 목표 = 35-40 = -5 → 25ms 늦게
  const p = planAdjust({ errors: [-35, -30, -30, -25, -30], leadMs: 100, netDelayMs: 40 });
  assert.equal(p.ok, true);
  assert.equal(p.marginMs, 35);
  assert.equal(p.aimMs, -5);
  assert.equal(p.leadMs, 75); // 신호를 25ms 늦게 → 클릭도 25ms 늦어짐
});

test("planAdjust: not ok with fewer than 4 usable tries", () => {
  assert.equal(planAdjust({ errors: [0, 10, 900], leadMs: 100, netDelayMs: 0 }).ok, false);
});

test("planAdjust: lead clamped to [-300,600] and rounded to 5", () => {
  const p = planAdjust({ errors: [-400, -400, -400, -400], leadMs: 0, netDelayMs: 0 });
  assert.equal(p.leadMs, -300);
});

test("checkVerify: asymmetric — early side only 5ms, late side 20ms", () => {
  assert.equal(checkVerify({ errors: [5, 12, -3], aimMs: 0 }).ok, true);   // +5 늦음 OK
  assert.equal(checkVerify({ errors: [18, 15, 20], aimMs: 0 }).ok, true);  // +18 늦음 OK
  assert.equal(checkVerify({ errors: [30, 25, 40], aimMs: 0 }).ok, false); // +30 너무 늦음
  assert.equal(checkVerify({ errors: [-9, -8, -10], aimMs: 0 }).ok, false); // -9 이름 → 불합격 (위험 구간)
  assert.equal(checkVerify({ errors: [0], aimMs: 0 }).ok, false); // 표본 부족
});

test("practiceTargets: n targets spaced by gap, first at least 4.5s ahead", () => {
  const t = practiceTargets(10_000, 3, 8000);
  assert.equal(t.length, 3);
  assert.ok(t[0] >= 14_500);
  assert.equal(t[1] - t[0], 8000);
});
