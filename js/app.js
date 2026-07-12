import { nowWith, syncOffset } from "./clockSync.js";
import { nextMinuteBoundary, msUntil, signalPhase } from "./countdown.js";
import { hitError, stats } from "./hitMeter.js";
import { load, save } from "./settings.js";
import { enableAudio, beep } from "./beeper.js";

const $ = (id) => document.getElementById(id);
const S = load(window.localStorage);

let netOffset = 0;          // 네트워크 동기화 보정(ms)
let target = null;          // 현재 목표 시각(ms)
let lastPhase = "idle";
let lastTargetForHit = null;

// 설정 UI 초기화
$("lead").value = S.leadMs; $("lead-val").textContent = S.leadMs;
$("offset").value = S.manualOffsetMs;
$("sound").checked = S.soundOn;
$("mode").value = S.mode;

function trueNow() { return nowWith(netOffset + S.manualOffsetMs); }

function pickTarget() { target = nextMinuteBoundary(trueNow()); lastTargetForHit = target; }

// ---- 시각 소스 동기화 (best-effort) ----
async function fetchSample() {
  const sentAt = Date.now();
  // Date 헤더(1초 해상도) 기반 안전한 fallback 소스. CORS 허용 엔드포인트.
  const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
  const recvAt = Date.now();
  const text = await res.text();
  const m = text.match(/ts=([0-9.]+)/);
  const serverMs = m ? Math.round(parseFloat(m[1]) * 1000) : Date.parse(res.headers.get("date"));
  return { serverMs, sentAt, recvAt };
}
async function doSync() {
  try {
    const r = await syncOffset(fetchSample, 5);
    if (r.ok) { netOffset = r.offsetMs; $("sync-status").textContent = `동기화됨 (추정오차 ±${Math.round(r.rttMs / 2)}ms)`; }
    else throw new Error("no ok");
  } catch {
    netOffset = 0;
    $("sync-status").textContent = "기기 시계 사용 중 (동기화 실패 — 대체로 정확하나 미확인)";
  }
}

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
function loop() {
  const now = trueNow();
  $("clock").textContent = fmt(now);
  if (!target || msUntil(now, target) < -1000) pickTarget(); // 지나갔으면 다음 목표
  const { phase, msLeft } = signalPhase(now, target, S.leadMs);
  $("count").textContent = msLeft > 0 ? Math.ceil(msLeft / 1000) : "0";
  // 게이지: 마지막 3초 동안 0→100%
  const g = Math.max(0, Math.min(1, (3000 - Math.max(0, msLeft)) / 3000));
  document.querySelector(".gauge-fill").style.width = `${g * 100}%`;

  if (phase !== lastPhase) {
    if (phase === "tick3" || phase === "tick2" || phase === "tick1") { if (S.soundOn) beep(660, 45, 0.15); }
    if (phase === "go") { flash(); if (S.soundOn) beep(1200, 120, 0.25); }
    lastPhase = phase;
  }
  requestAnimationFrame(loop);
}

// ---- 클릭/스페이스 = 제출 흉내, 오차 표시 ----
function registerHit() {
  const err = hitError(trueNow(), lastTargetForHit);
  const el = $("hit-result");
  const sign = err > 0 ? "늦음" : err < 0 ? "빠름" : "정확";
  el.textContent = `${err >= 0 ? "+" : ""}${Math.round(err)} ms (${sign})`;
  el.className = "hit " + (Math.abs(err) <= 30 ? "good" : err > 0 ? "late" : "early");
  return err; // Task 8에서 연습 기록에 사용
}

// ---- 이벤트 ----
function firstInteract() { enableAudio(); }
window.addEventListener("pointerdown", firstInteract, { once: true });
window.addEventListener("keydown", firstInteract, { once: true });

window.addEventListener("keydown", (e) => { if (e.code === "Space") { e.preventDefault(); registerHit(); } });
document.querySelector(".stage").addEventListener("pointerdown", registerHit);

$("lead").addEventListener("input", (e) => { S.leadMs = Number(e.target.value); $("lead-val").textContent = S.leadMs; save(window.localStorage, S); });
$("offset").addEventListener("change", (e) => { S.manualOffsetMs = Number(e.target.value); save(window.localStorage, S); });
$("sound").addEventListener("change", (e) => { S.soundOn = e.target.checked; save(window.localStorage, S); });

// ---- 시작 ----
pickTarget();
doSync();
requestAnimationFrame(loop);
setInterval(doSync, 5 * 60 * 1000); // 5분마다 재동기화
