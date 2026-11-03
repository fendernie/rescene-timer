// 주의: 배포 시 index.html의 스크립트 태그와 아래 import들의 ?v= 숫자를 함께 올릴 것.
// (버전 도장이 같아야 브라우저가 옛/새 파일을 섞어 로드하는 사고가 없다)
import { syncOffset, estimateOneWay, isSaneShift, mono, wallOffset, jitterOf, parseAkamai, clockWarning } from "./clockSync.js?v=25";
import { nextMinuteBoundary, msUntil, signalPhase, cueTimes, bgCueTimes } from "./countdown.js?v=25";
import { hitError, isRealAttempt } from "./hitMeter.js?v=25";
import { load, save } from "./settings.js?v=25";
import { enableAudio, beep, scheduleBeepIn, audioState, reportedLatency, startKeepalive, stopKeepalive, trackAudioClock } from "./beeper.js?v=25";
import { buildFields, elapsedSec, parseFields } from "./rehearsal.js?v=25";
import {
  planAdjust, checkVerify, practiceTargets, robustSummary, totalSigma, earlyRisk, clampLead,
} from "./calibration.js?v=25";

const $ = (id) => document.getElementById(id);
const S = load(window.localStorage);
const persist = () => save(window.localStorage, S);

// 진단: 어떤 오류든 침묵하지 않고 화면에 드러낸다 (실전 중 원인 불명 멈춤 추적용)
function showError(msg) {
  const el = $("err-line");
  el.hidden = false;
  el.textContent = `⚠️ 오류: ${msg} — 이 문구를 캡처해서 알려주세요`;
}
window.addEventListener("error", (e) => showError(`${e.message} (${e.filename?.split("/").pop()}:${e.lineno})`));
window.addEventListener("unhandledrejection", (e) => showError(String(e.reason)));

let netOffset = 0;      // 단조시계 → 표준시 보정(ms)
let lastWall = null;    // 마지막으로 받아들인 벽시계 기준 오프셋 (점프 검사용)
let clockUncMs = 50;    // 시계 동기화 추정오차(편도). 동기화 전엔 보수적으로 50
let target = null;      // 현재 목표 시각(ms)
let lastPhase = "idle";

// 설정 UI 초기화
$("lead").value = S.leadMs; $("lead-val").textContent = S.leadMs;
$("sound-lat").value = S.soundLatencyMs; $("sound-lat-val").textContent = S.soundLatencyMs;
$("offset").value = S.manualOffsetMs;
$("sound").checked = S.soundOn;
$("release-mode").checked = S.releaseMode;
$("notice-fields").value = S.noticeFields.join("\n");

// 시각은 전부 단조시계 기반 — 맥이 시계를 미세 조정해도 카운트다운이 튀지 않는다.
function trueNow() { return mono() + netOffset + S.manualOffsetMs; }

// 입력 이벤트의 "실제 입력 시각". 처리 시각(화면 그리는 중이면 밀림) 대신 브라우저가 찍어둔 시각을 쓴다.
function eventNow(e) {
  const ts = e?.timeStamp;
  const age = performance.now() - ts;
  const base = typeof ts === "number" && ts > 0 && age >= 0 && age < 1000 ? performance.timeOrigin + ts : mono();
  return base + netOffset + S.manualOffsetMs;
}

const scheduledCues = new Set(); // 이미 예약한 소리(시각 키). 목표가 바뀌면 비운다.
function setTarget(t) {
  target = t;
  scheduledCues.clear();
  for (const at of hiddenNodes.keys()) scheduledCues.add(at); // 숨김 중 미리 예약한 신호는 중복 예약 금지
}

// ---- 시각 소스 동기화 (best-effort) ----
// 시각 소스: Akamai (ms 단위, CORS 허용).
// ⚠️ 예전에 쓰던 Cloudflare trace의 ts는 2026-11 기준 초 단위로 잘려 나와 시계가 0~1초 늦게 맞춰졌다 — 쓰지 말 것.
async function fetchSample() {
  const sentAt = mono();
  const res = await fetch("https://time.akamai.com/?iso&ms", { cache: "no-store" });
  const recvAt = mono();
  const serverMs = parseAkamai(await res.text());
  if (!Number.isFinite(serverMs)) throw new Error("bad time sample");
  return { serverMs, sentAt, recvAt };
}
async function doSync() {
  try {
    const r = await syncOffset(fetchSample, 8);
    if (!r.ok) throw new Error("no ok");
    const wall = wallOffset(r.offsetMs, Date.now(), mono());
    // 정확한 소스면 재동기화 변화는 수 ms. 단조시계 기준(맥이 시계를 고친 경우) 또는 벽시계 기준(잠자기) 중
    // 하나라도 250ms 안이면 정상으로 본다.
    const first = lastWall === null;
    const sane = first || isSaneShift(netOffset, r.offsetMs, false, 250) || isSaneShift(lastWall, wall, false, 250);
    if (!sane) {
      $("sync-status").textContent = "시계 동기화됨 (직전 재동기화 이상값 무시함)";
      return;
    }
    netOffset = r.offsetMs;
    lastWall = wall;
    clockUncMs = Math.round(r.rttMs / 2);
    const devDiff = Math.round(-wall); // + 면 기기 시계가 빠름
    const warn = clockWarning(devDiff);
    $("sync-status").textContent = warn
      ? `⚠️ 이 기기 시계가 표준시와 ${devDiff >= 0 ? "+" : ""}${devDiff}ms 차이 — 가이드 시계(표준시)를 따르세요. 이상하면 캡처해서 알려주세요`
      : `시계 동기화됨 (추정오차 ±${clockUncMs}ms · 이 기기 시계는 표준시보다 ${devDiff >= 0 ? "+" : ""}${devDiff}ms)`;
    $("sync-status").className = warn ? "muted sync-warn" : "muted";
  } catch {
    if (lastWall === null) {
      netOffset = Date.now() - mono();
      // 맥은 보통 NTP로 정확(실측 ±5ms)하지만 확인이 안 된 상태라 눈에 띄게 경고
      $("sync-status").textContent = "⚠️ 표준시 동기화 실패 — 기기 시계 사용 중. 인터넷 확인 후 새로고침하세요";
      $("sync-status").className = "muted sync-warn";
    }
  }
}

// ---- 네트워크 지연 측정 (리센느 서버) ----
// ⚠️ 페이지 주소로 재면 서버가 페이지를 만드는 시간(~100ms)까지 지연으로 잡혀 40ms+ 과대추정 →
// 너무 일찍 떼게 되어 정각 전 도착 위험. 같은 서버의 33바이트 캐시 파일로 입구까지의 순수 네트워크만 잰다.
// (실측 2026-11-03: 입구 왕복 ~10ms, 실제 API 왕복 ~21ms → 남는 몇 ms는 "늦게 도착" 쪽이라 안전)
const RESCENE_URL = "https://artist.mnetplus.world/robots.txt";
async function measureNet() {
  const el = $("net-result");
  el.textContent = "네트워크 지연 측정 중…";
  const rtts = [];
  for (let i = 0; i < 6; i += 1) {
    const t0 = performance.now();
    try {
      // no-cors: 응답 내용은 못 읽어도 도착 시점은 잴 수 있다
      await fetch(RESCENE_URL, { mode: "no-cors", cache: "no-store" });
      rtts.push(performance.now() - t0);
    } catch {
      // 실패한 회차는 건너뜀
    }
  }
  const oneWay = estimateOneWay(rtts);
  if (oneWay === null) {
    el.textContent = "측정 실패 — 인터넷 연결을 확인하세요 (이전 값 유지)";
    return false;
  }
  S.netDelayMs = oneWay;
  S.netJitterMs = jitterOf(rtts);
  persist();
  el.textContent = `리센느 서버까지 편도 약 ${oneWay}ms (출렁임 ±${S.netJitterMs}ms)`;
  return true;
}

// ---- 자동 보정: 빠른 연습 5회 → 리드타임 자동 적용 → 확인 3회 ----
let calib = null; // { phase, targets, idx, errs, hit, plan, adjustErrs, retries, verifyFails }
const ADJUST_N = 5, VERIFY_N = 3;

function setLead(ms) {
  S.leadMs = ms;
  $("lead").value = ms; $("lead-val").textContent = ms;
  persist();
}

async function startCalib() {
  enableAudio();
  if (rehearsalTarget !== null) cancelRehearsal();
  $("calib-btn").hidden = true;
  $("calib-stop").hidden = false;
  $("calib-result").hidden = true;
  $("calib-progress").textContent = "준비 중… 네트워크 지연과 시계를 재는 중 (몇 초)";
  calib = { phase: "prep", retries: 0, verifyFails: 0 };
  await measureNet();
  await doSync();
  if (!calib) return; // 준비 중 중단됨
  beginBlock("adjust", ADJUST_N);
}

function beginBlock(phase, n) {
  Object.assign(calib, { phase, targets: practiceTargets(trueNow(), n), idx: 0, errs: [], hit: false });
  setTarget(calib.targets[0]);
  renderCalibProgress();
}

function renderCalibProgress(note = "") {
  if (!calib || calib.phase === "prep") return;
  const label = calib.phase === "adjust" ? "1단계 연습" : "2단계 확인";
  const total = calib.targets.length;
  const dots = calib.targets.map((_, i) => (i < calib.errs.length ? "●" : i === calib.idx ? "◉" : "○")).join(" ");
  $("calib-progress").textContent =
    `${label} ${Math.min(calib.idx + 1, total)}/${total}  ${dots}\n(화면 빈 곳 어디든 꾹 눌렀다가 "삐"에 떼기)${note ? `\n${note}` : ""}`;
}

function stopCalib(msg) {
  calib = null;
  $("calib-btn").hidden = false;
  $("calib-stop").hidden = true;
  $("calib-progress").textContent = msg;
  setTarget(nextMinuteBoundary(trueNow()));
}

// 보정 중 목표 시각이 지나가면 다음 라운드로
function advanceCalib() {
  calib.idx += 1;
  calib.hit = false;
  if (calib.idx < calib.targets.length) {
    setTarget(calib.targets[calib.idx]);
    renderCalibProgress();
    return;
  }
  if (calib.phase === "adjust") finishAdjust();
  else finishVerify();
}

function finishAdjust() {
  const plan = planAdjust({
    errors: calib.errs, leadMs: S.leadMs, netDelayMs: S.netDelayMs, clockUncMs, netJitterMs: S.netJitterMs,
  });
  if (!plan.ok) {
    calib.retries += 1;
    if (calib.retries >= 2) {
      stopCalib(`❌ 유효한 기록이 부족해요 (최근 기록: ${calib.errs.join(", ") || "없음"}). 이 문구를 캡처해서 알려주세요.`);
      return;
    }
    beginBlock("adjust", ADJUST_N);
    renderCalibProgress("유효 기록이 4개 미만이라 1단계를 다시 해요");
    return;
  }
  calib.plan = plan;
  calib.adjustErrs = calib.errs;
  setLead(plan.leadMs);
  beginBlock("verify", VERIFY_N);
  renderCalibProgress(`리드타임 ${plan.leadMs}ms 적용 — 이제 확인 3번`);
}

function finishVerify() {
  const { plan } = calib;
  const v = checkVerify({ errors: calib.errs, aimMs: plan.aimMs });
  if (v.ok) { completeCalib(v); return; }
  calib.verifyFails += 1;
  if (calib.verifyFails >= 3) { stopCalib("😵 손 감각이 아직 들쭉날쭉해요. 잠깐 쉬었다가 다시 시작하세요."); return; }
  if (v.n >= 2) setLead(clampLead(S.leadMs + v.median - plan.aimMs)); // 확인에서 드러난 차이만큼 한 번 더 미세조정
  beginBlock("verify", VERIFY_N);
  renderCalibProgress(`목표와 ${Math.round(v.median - plan.aimMs)}ms 차이 → 리드타임 ${S.leadMs}ms로 미세조정, 확인 다시`);
}

function completeCalib(v) {
  const { plan } = calib;
  const all = robustSummary([...calib.adjustErrs.map((e) => e - plan.median), ...calib.errs.map((e) => e - v.median)]);
  const sigmaTotMs = totalSigma({ sigmaMs: Math.max(plan.sigmaMs, all.sigma), n: all.n, clockUncMs, netJitterMs: S.netJitterMs });
  const arrivalMs = v.median + S.netDelayMs;
  const riskPct = earlyRisk({ arrivalMeanMs: arrivalMs, sigmaTotMs }) * 100;
  // 확인 단계에서 손이 더 흔들렸으면 위험이 1%를 넘을 수 있다 → "준비 완료" 대신 여유를 키워 재확인
  if (riskPct > 1) {
    calib.verifyFails += 1;
    if (calib.verifyFails >= 3) { stopCalib("😵 손 흔들림이 커서 안전 여유가 부족해요. 잠깐 쉬었다가 다시 시작하세요."); return; }
    const newMargin = Math.min(220, Math.ceil(3 * sigmaTotMs));
    calib.plan = { ...plan, marginMs: newMargin, aimMs: newMargin - S.netDelayMs, sigmaMs: Math.max(plan.sigmaMs, all.sigma) };
    setLead(clampLead(S.leadMs + v.median - calib.plan.aimMs));
    beginBlock("verify", VERIFY_N);
    renderCalibProgress(`정각 전 위험 ${riskPct.toFixed(1)}% — 안전 여유를 +${newMargin}ms로 늘려 확인 다시`);
    return;
  }
  S.calib = { at: Date.now(), leadMs: S.leadMs, aimMs: plan.aimMs, marginMs: plan.marginMs, sigmaTotMs, riskPct };
  S.errors = [...calib.adjustErrs, ...calib.errs];
  persist();
  $("calib-result").hidden = false;
  $("calib-result").textContent =
    `✅ 준비 완료!\n` +
    `리드타임 ${S.leadMs}ms  |  손 흔들림 ±${Math.round(plan.sigmaMs)}ms\n` +
    `서버 도착 목표: 정각 +${plan.marginMs}ms (안전 여유)\n` +
    `확인 결과 도착 추정: 정각 ${arrivalMs >= 0 ? "+" : ""}${Math.round(arrivalMs)}ms\n` +
    `정각 전 도착 위험: ${fmtRisk(riskPct)}`;
  stopCalib("이제 실전까지 이 설정 그대로 두세요. 실전 10분 전에 한 번 더 보정하면 가장 확실해요.");
  renderCalibLine();
}

function fmtRisk(pct) { return pct < 0.1 ? "0.1% 미만" : `${pct.toFixed(1)}%`; }

function renderCalibLine() {
  const el = $("calib-line");
  if (!S.calib) {
    el.textContent = "⚡ 아직 보정 전 — 아래 [자동 보정]부터 하세요";
    el.className = "calib-line warn";
    return;
  }
  const min = Math.floor((Date.now() - S.calib.at) / 60000);
  const stale = min >= 30;
  el.textContent = stale
    ? `⏰ 보정한 지 ${min}분 — 실전 10분 전에 다시 보정하세요`
    : `✅ 준비 완료 (${min}분 전) · 도착 목표 정각+${S.calib.marginMs}ms · 정각 전 위험 ${fmtRisk(S.calib.riskPct)}`;
  el.className = `calib-line ${stale ? "warn" : "ok"}`;
}

// 손으로 조건을 바꾸면 보정 결과는 더 이상 유효하지 않다
function invalidateCalib() {
  S.calib = null;
  S.errors = [];
  persist();
  renderCalibLine();
}

// 가이드 창이 숨겨지면 크롬이 타이머를 1분에 한 번까지 늦춘다(5분 이상 숨김 시) → 실시간 예약이 끊긴다.
// 그래서 숨겨지는 순간 앞으로 5분치 정각 신호를 오디오 시계에 통째로 예약하고, 다시 보이면 취소한다.
const hiddenNodes = new Map(); // 신호 시각 → 예약 노드
function scheduleHiddenCues() {
  if (!S.soundOn || bgMode || calib) return;
  const now = trueNow();
  let t = nextMinuteBoundary(now);
  for (let i = 0; i < 5; i += 1, t += 60_000) {
    for (const c of cueTimes(t, S.leadMs)) {
      const dms = c.at - now - S.soundLatencyMs;
      if (dms <= 0 || scheduledCues.has(c.at)) continue;
      const n = c.kind === "go" ? scheduleBeepIn(dms / 1000, 1200, 120, 0.25) : scheduleBeepIn(dms / 1000, 660, 45, 0.15);
      if (n) { hiddenNodes.set(c.at, n); scheduledCues.add(c.at); }
    }
  }
}
function cancelHiddenCues() {
  for (const [at, n] of hiddenNodes) {
    try { n.stop(0); } catch { /* 이미 재생됨 */ }
    scheduledCues.delete(at);
  }
  hiddenNodes.clear();
}
document.addEventListener("visibilitychange", () => (document.hidden ? scheduleHiddenCues() : cancelHiddenCues()));

// ---- 렌더 루프 ----
function fmt(ms) {
  const d = new Date(ms);
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function flash() {
  $("go-flash").classList.add("on");
  setTimeout(() => $("go-flash").classList.remove("on"), 120);
}

// 목표가 지나갔으면 다음 목표로 (보정 중이면 다음 라운드, 아니면 다음 정각)
function maintainTarget(now) {
  if (target !== null && msUntil(now, target) >= -1000) return;
  if (calib && calib.targets && calib.phase !== "prep") advanceCalib();
  else setTarget(nextMinuteBoundary(now));
}

// 소리는 발생 시점에 쏘지 않고 미리 오디오 정밀 시계에 예약한다.
// rAF와 타이머 양쪽에서 부른다 — 가이드 창이 가려져 rAF가 멈춰도(백그라운드 타이머는 1초 간격) 1.5초 창으로 놓치지 않음.
function scheduleCues() {
  if (!S.soundOn || bgMode || target === null) return;
  const now = trueNow();
  maintainTarget(now);
  for (const c of cueTimes(target, S.leadMs)) {
    const dms = c.at - now;
    if (dms > 0 && dms <= 1500 && !scheduledCues.has(c.at)) {
      const d = Math.max(0, dms - S.soundLatencyMs) / 1000; // 수동 소리 보정만큼 당김
      const ok = c.kind === "go" ? scheduleBeepIn(d, 1200, 120, 0.25) : scheduleBeepIn(d, 660, 45, 0.15);
      if (ok) scheduledCues.add(c.at); // 실패(엔진 잠김)면 다음 호출에 재시도
    }
  }
}

function loop() {
  const now = trueNow();
  $("clock").textContent = fmt(now);
  $("audio-hint").hidden = !(S.soundOn && audioState() !== "running");
  maintainTarget(now);
  const { phase, msLeft } = signalPhase(now, target, S.leadMs);
  $("count").textContent = msLeft > 0 ? Math.ceil(msLeft / 1000) : "0";
  $("count-label").textContent = calib && calib.phase !== "prep" ? "연습 라운드" : "다음 정각까지";
  const g = Math.max(0, Math.min(1, (3000 - Math.max(0, msLeft)) / 3000)); // 마지막 3초 동안 0→100%
  document.querySelector(".gauge-fill").style.width = `${g * 100}%`;
  if (phase !== lastPhase) {
    if (phase === "go") flash();
    lastPhase = phase;
  }
  // 리허설: 정각이 되면 모의 폼을 한 번만 열기
  if (rehearsalTarget !== null && now >= rehearsalTarget) {
    rehearsalOpenAt = rehearsalTarget;
    rehearsalTarget = null;
    openRehearsal();
  }
  scheduleCues();
  requestAnimationFrame(loop);
}

// ---- 누르기/떼기 = 제출 흉내, 오차 표시 ----
function registerHit(e) {
  if (target === null) return;
  const err = hitError(eventNow(e), target);
  const arrival = err + S.netDelayMs;
  const sign = (x) => `${x >= 0 ? "+" : ""}${Math.round(x)}`;
  const el = $("hit-result");
  if (!isRealAttempt(err)) {
    el.textContent = `${sign(err)} ms — 목표에서 너무 멀어요`;
    el.className = "hit";
    $("hit-detail").textContent = "카운트다운의 \"삐\"에 맞춰 떼세요";
    return;
  }
  const margin = S.calib?.marginMs ?? calib?.plan?.marginMs ?? 40;
  if (arrival < 0) {
    el.textContent = `⚠️ ${sign(err)} ms — 정각 전 도착 (최후순위 위험!)`;
    el.className = "hit late";
  } else {
    el.textContent = `${sign(err)} ms`;
    el.className = `hit ${arrival <= margin * 2 ? "good" : "early"}`;
  }
  $("hit-detail").textContent = `떼는 순간 기준 ${sign(err)}ms → 서버 도착 추정 정각 ${sign(arrival)}ms`;

  if (calib && calib.targets && !calib.hit && calib.phase !== "prep") {
    calib.hit = true; // 라운드당 첫 시도만 기록 (중복 입력 방지)
    calib.errs.push(Math.round(err));
    renderCalibProgress();
  }
}

// ---- 이벤트 ----
// iOS는 백그라운드/전화/알림 후 소리 엔진을 다시 잠그므로, 상호작용·복귀 때마다 다시 푼다(멱등).
window.addEventListener("pointerdown", enableAudio);
window.addEventListener("keydown", enableAudio);
document.addEventListener("visibilitychange", () => { if (!document.hidden) enableAudio(); });

const isTyping = (t) => t.matches?.("input[type=text], input[type=tel], input[type=number], textarea");
// 측정 시점: 기본은 떼는 순간(pointerup/keyup) — 웹 버튼은 뗄 때 실행되므로 실전과 같은 동작.
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || isTyping(e.target)) return;
  e.preventDefault();
  // 버튼/슬라이더에 포커스가 남아 있으면 스페이스가 그 컨트롤을 다시 작동시킬 수 있어 차단
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  if (!S.releaseMode && !e.repeat) registerHit(e);
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space" || isTyping(e.target)) return;
  e.preventDefault();
  if (S.releaseMode) registerHit(e);
});
// 화면 어디서 누르고 떼도 기록 (🎯 버튼만 노리다 위치를 놓쳐 기록이 빠지는 일 방지).
// 단, 다른 버튼·입력칸·접기 제목을 누른 건 조작이지 타이밍 시도가 아니므로 제외.
const isControl = (t) => t !== $("hit-btn") && !!t.closest?.("button, input, textarea, select, summary, label, a");
window.addEventListener("pointerdown", (e) => {
  if (isControl(e.target)) return;
  if (e.target === $("hit-btn")) e.preventDefault(); // 포커스를 막아 스페이스바 재작동 중복 기록 방지
  if (!S.releaseMode) registerHit(e);
});
window.addEventListener("pointerup", (e) => {
  if (isControl(e.target)) return;
  if (S.releaseMode) registerHit(e);
});

$("calib-btn").addEventListener("click", startCalib);
$("calib-stop").addEventListener("click", () => stopCalib("중단했어요. 리드타임은 마지막 적용값 그대로예요."));
$("measure-net").addEventListener("click", measureNet);
$("reset-calib").addEventListener("click", invalidateCalib);
$("release-mode").addEventListener("change", (e) => { S.releaseMode = e.target.checked; invalidateCalib(); });
$("lead").addEventListener("input", (e) => { S.leadMs = Number(e.target.value); $("lead-val").textContent = S.leadMs; invalidateCalib(); });
$("sound-lat").addEventListener("input", (e) => { S.soundLatencyMs = Number(e.target.value); $("sound-lat-val").textContent = S.soundLatencyMs; invalidateCalib(); });
$("offset").addEventListener("change", (e) => { S.manualOffsetMs = Number(e.target.value); persist(); });
$("sound").addEventListener("change", (e) => { S.soundOn = e.target.checked; persist(); });
$("sound-test").addEventListener("click", () => {
  enableAudio();
  beep(880, 300, 0.3);
  setTimeout(() => {
    const lat = reportedLatency();
    const latTxt = lat === null ? "기기 미제공" : `${Math.round(lat * 1000)}ms(자동 보정됨)`;
    $("net-result").textContent = `[진단] 소리엔진: ${audioState()} / 출력지연: ${latTxt}`;
  }, 100);
});

// ---- 공지 항목 붙여넣기 ----
function renderNotice() {
  const n = S.noticeFields.length;
  $("notice-status").textContent = n
    ? `항목 ${n}개 저장됨: ${S.noticeFields.join(" · ")}`
    : "비어 있으면 리허설은 기본 항목 + 랜덤 서프라이즈로 나와요";
}
$("notice-fields").addEventListener("input", (e) => {
  S.noticeFields = parseFields(e.target.value);
  persist();
  renderNotice();
});

// ---- 백그라운드 소리 모드: 5분치 정각 안내를 통째로 예약 ----
let bgMode = false;
const bgNodes = [];
function startBgMode() {
  enableAudio();
  const now = trueNow();
  let t = nextMinuteBoundary(now);
  for (let i = 0; i < 5; i += 1) {
    for (const c of bgCueTimes(t, S.leadMs)) {
      const dms = c.at - now - S.soundLatencyMs;
      if (dms <= 0) continue;
      const node = scheduleBeepIn(dms / 1000, c.freq, c.ms, 0.3);
      if (node) bgNodes.push(node);
    }
    t += 60_000;
  }
  if (!bgNodes.length) return; // 소리 엔진이 아직 잠김 — 안내문이 대신 뜬다
  startKeepalive();
  bgMode = true;
  $("bg-toggle").textContent = "⏹ 백그라운드 소리 모드 끄기";
  $("bg-status").textContent = "켜짐 — 5분간 매 정각 안내 (30초 전 예고 → 10초 전 뚜뚜 → 5·4·3·2·1 → 삐)";
}
function stopBgMode() {
  for (const n of bgNodes) { try { n.stop(0); } catch { /* 이미 종료 */ } }
  bgNodes.length = 0;
  stopKeepalive();
  bgMode = false;
  $("bg-toggle").textContent = "📢 백그라운드 소리 모드 (5분)";
  $("bg-status").textContent = "";
}
$("bg-toggle").addEventListener("click", () => (bgMode ? stopBgMode() : startBgMode()));

// ---- 체크리스트: 진행도 표시 + 공지 정독 항목 강조 ----
const chkItems = [...document.querySelectorAll(".chk-item")];
function renderChecklist() {
  const done = chkItems.filter((c) => c.checked).length;
  $("chk-progress").textContent = `${done}/${chkItems.length}${done === chkItems.length ? " — 준비 완료! 🎯" : ""}`;
  $("chk-notice-label").classList.toggle("done", $("chk-notice").checked);
}
chkItems.forEach((c) => c.addEventListener("change", renderChecklist));

// ---- 리허설(모의 신청 폼): 정각에 열림 → 작성 → 제출 시간 측정 ----
let rehearsalTarget = null; // 열릴 정각(ms). null이면 비활성
let rehearsalOpenAt = null; // 실제로 열린 시각(ms) — 소요시간 측정 기준
let rehearsalBest = null;
function armRehearsal() {
  if (calib) { $("rehearsal-status").textContent = "자동 보정이 끝난 뒤에 해주세요"; return; }
  rehearsalTarget = nextMinuteBoundary(trueNow());
  $("rehearsal-form").hidden = true;
  $("rehearsal-result").textContent = "";
  $("rehearsal-status").textContent = "대기 중 — 정각이 되면 폼이 열립니다. 카운트다운을 보세요!";
}
function cancelRehearsal() {
  rehearsalTarget = null;
  $("rehearsal-status").textContent = "";
}
function openRehearsal() {
  const fields = buildFields(Math.random(), S.noticeFields);
  const form = $("rehearsal-form");
  form.innerHTML = fields
    .map((f, i) => `<label>${escapeHtml(f)}<input type="text" data-idx="${i}" autocomplete="off" /></label>`)
    .join("") + `<button id="rehearsal-submit" type="button">제출</button>`;
  form.hidden = false;
  $("rehearsal-status").textContent = `폼 열림! (항목 ${fields.length}개 — 끝까지 확인했나요?)`;
  document.getElementById("rehearsal-submit").addEventListener("click", () => {
    const empty = [...form.querySelectorAll("input")].filter((i) => !i.value.trim());
    if (empty.length) {
      $("rehearsal-result").textContent = `❌ 빈칸 ${empty.length}개! 실전이었으면 무효 — 끝까지 스크롤 습관!`;
      return;
    }
    const sec = elapsedSec(rehearsalOpenAt, trueNow());
    if (rehearsalBest === null || sec < rehearsalBest) rehearsalBest = sec;
    $("rehearsal-result").textContent = `✅ 제출 완료: 열림 후 ${sec}초 (세션 최고 ${rehearsalBest}초)`;
    form.hidden = true;
    $("rehearsal-status").textContent = "";
  });
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
$("rehearsal-btn").addEventListener("click", armRehearsal);

// 테스트용: 주소 뒤에 ?debug 를 붙였을 때만 내부 상태를 노출 (자동 시뮬레이션 검증용)
if (location.search.includes("debug")) window.__dbg = { target: () => target, lead: () => S.leadMs, now: trueNow };

// ---- 시작 ----
netOffset = Date.now() - mono(); // 동기화 전까지는 기기 시계
setTarget(nextMinuteBoundary(trueNow()));
doSync();
renderNotice();
renderChecklist();
renderCalibLine();
requestAnimationFrame(loop);
setInterval(scheduleCues, 200);            // 창이 가려져도 소리 예약이 이어지도록
setInterval(trackAudioClock, 1000);        // 오디오 시계 빠르기 측정 (미리 예약하는 소리 보정용)
setInterval(renderCalibLine, 30 * 1000);   // "N분 전" 갱신
setInterval(doSync, 5 * 60 * 1000);        // 5분마다 재동기화
