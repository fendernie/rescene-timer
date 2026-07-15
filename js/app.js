import { nowWith, syncOffset, estimateOneWay } from "./clockSync.js";
import { nextMinuteBoundary, msUntil, signalPhase, cueTimes, bgCueTimes } from "./countdown.js";
import { hitError, stats, recommendLead } from "./hitMeter.js";
import { load, save } from "./settings.js";
import { enableAudio, beep, scheduleBeepIn, audioState, reportedLatency, startKeepalive, stopKeepalive } from "./beeper.js";

const $ = (id) => document.getElementById(id);
const S = load(window.localStorage);

// 진단: 어떤 오류든 침묵하지 않고 화면에 드러낸다 (실전 중 원인 불명 멈춤 추적용)
function showError(msg) {
  const el = $("err-line");
  el.hidden = false;
  el.textContent = `⚠️ 오류: ${msg} — 이 문구를 캡처해서 알려주세요`;
}
window.addEventListener("error", (e) => showError(`${e.message} (${e.filename?.split("/").pop()}:${e.lineno})`));
window.addEventListener("unhandledrejection", (e) => showError(String(e.reason)));

let netOffset = 0;          // 네트워크 동기화 보정(ms)
let target = null;          // 현재 목표 시각(ms)
let lastPhase = "idle";
let lastTargetForHit = null;

// 설정 UI 초기화
$("lead").value = S.leadMs; $("lead-val").textContent = S.leadMs;
$("sound-lat").value = S.soundLatencyMs; $("sound-lat-val").textContent = S.soundLatencyMs;
$("offset").value = S.manualOffsetMs;
$("sound").checked = S.soundOn;
$("mode").value = S.mode;

function trueNow() { return nowWith(netOffset + S.manualOffsetMs); }

const scheduledCues = new Set(); // 이미 예약한 소리(시각 키). 목표가 바뀌면 비운다.

function pickTarget() { target = nextMinuteBoundary(trueNow()); lastTargetForHit = target; scheduledCues.clear(); }

// ---- 시각 소스 동기화 (best-effort) ----
async function fetchSample() {
  const sentAt = Date.now();
  // Date 헤더(1초 해상도) 기반 안전한 fallback 소스. CORS 허용 엔드포인트.
  const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
  const recvAt = Date.now();
  const text = await res.text();
  const m = text.match(/ts=([0-9.]+)/);
  const serverMs = m ? Math.round(parseFloat(m[1]) * 1000) : Date.parse(res.headers.get("date"));
  if (!Number.isFinite(serverMs)) throw new Error("bad time sample");
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
  // iOS는 첫 터치 전까지 소리를 잠가둔다 — 잠겨 있으면 안내 표시
  $("audio-hint").hidden = !(S.soundOn && audioState() !== "running");
  if (!target || msUntil(now, target) < -1000) pickTarget(); // 지나갔으면 다음 목표
  const { phase, msLeft } = signalPhase(now, target, S.leadMs);
  $("count").textContent = msLeft > 0 ? Math.ceil(msLeft / 1000) : "0";
  // 게이지: 마지막 3초 동안 0→100%
  const g = Math.max(0, Math.min(1, (3000 - Math.max(0, msLeft)) / 3000));
  document.querySelector(".gauge-fill").style.width = `${g * 100}%`;

  if (phase !== lastPhase) {
    if (phase === "go") flash(); // 시각 신호는 즉시. 소리는 아래에서 예약제로.
    lastPhase = phase;
  }

  // 소리는 발생 시점에 쏘지 않고, 800ms 전에 오디오 정밀 시계에 예약한다.
  // (아이폰 등에서 출력 지연으로 소리가 밀리는 문제를 기기 지연 보정으로 해결)
  // 백그라운드 모드 중에는 자체 카운트 소리가 있으므로 일반 틱음은 쉰다.
  if (S.soundOn && !bgMode) {
    for (const c of cueTimes(target, S.leadMs)) {
      const dms = c.at - now;
      if (dms > 0 && dms <= 800 && !scheduledCues.has(c.at)) {
        const d = Math.max(0, dms - S.soundLatencyMs) / 1000; // 수동 소리 보정만큼 당김
        const ok = c.kind === "go"
          ? scheduleBeepIn(d, 1200, 120, 0.25)
          : scheduleBeepIn(d, 660, 45, 0.15);
        if (ok) scheduledCues.add(c.at); // 실패(엔진 잠김)면 다음 프레임에 재시도
      }
    }
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
  if (S.mode === "practice") {
    S.errors.push(Math.round(err));
    if (S.errors.length > 200) S.errors = S.errors.slice(-200);
    save(window.localStorage, S);
    renderStats();
  }
  return err; // Task 8에서 연습 기록에 사용
}

function renderStats() {
  const s = stats(S.errors);
  if (!s.n) { $("stats").textContent = "연습 기록 없음"; return; }
  const bars = s.recent.map((e) => `${e >= 0 ? "+" : ""}${Math.round(e)}`).join("  ");
  let text =
    `시도 ${s.n}회 | 평균 ${s.mean.toFixed(0)}ms | 편차 ±${s.stdev.toFixed(0)}ms | 최고 ${s.best}ms\n최근: ${bars}`;
  const rec = recommendLead(S.leadMs, s.mean, s.n, -S.netDelayMs);
  latestRec = rec !== null && rec !== S.leadMs ? rec : null;
  if (latestRec !== null) {
    const aimNote = S.netDelayMs > 0 ? ` (네트워크 지연 ${S.netDelayMs}ms 반영)` : "";
    text += `\n추천 리드타임: ${latestRec}ms (현재 ${S.leadMs}ms)${aimNote}`;
  }
  $("apply-lead").hidden = latestRec === null;
  $("stats").textContent = text;
}
let latestRec = null; // renderStats가 계산한 최신 추천값 (적용 버튼용)

// ---- 네트워크 지연 측정 (리센느 서버) ----
const RESCENE_URL = "https://artist.mnetplus.world/main/stg/rescene-official";
async function measureNet() {
  const el = $("net-result");
  el.textContent = "측정 중…";
  const rtts = [];
  for (let i = 0; i < 5; i += 1) {
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
    el.textContent = "측정 실패 — 인터넷 연결을 확인하세요";
    return;
  }
  S.netDelayMs = oneWay;
  save(window.localStorage, S);
  renderStats(); // 추천 리드타임 목표에 즉시 반영
  el.textContent = `리센느 서버까지 추정 지연 약 ${oneWay}ms → 추천 리드타임 목표(-${oneWay}ms)에 자동 반영됨`;
}

// ---- 이벤트 ----
// iOS는 백그라운드/전화/알림 후 소리 엔진을 다시 잠그므로, 상호작용·복귀 때마다 다시 푼다(멱등).
window.addEventListener("pointerdown", enableAudio);
window.addEventListener("keydown", enableAudio);
document.addEventListener("visibilitychange", () => { if (!document.hidden) enableAudio(); });

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  e.preventDefault();
  // 버튼/슬라이더에 포커스가 남아 있으면 스페이스가 그 컨트롤을 다시 작동시킬 수 있어 차단
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  registerHit();
});
document.querySelector(".stage").addEventListener("pointerdown", registerHit);
// 버튼은 click(눌렀다 뗌)이 아니라 pointerdown(누르는 순간)에 기록 — 타이밍 오차 최소화.
// preventDefault로 포커스를 막아 스페이스바가 버튼을 재작동시키는 중복 기록도 방지.
$("hit-btn").addEventListener("pointerdown", (e) => { e.preventDefault(); registerHit(); });
$("measure-net").addEventListener("click", measureNet);
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
  $("bg-status").textContent =
    "켜짐 — 다른 앱으로 가도 5분간 매 정각 안내가 울립니다 (30초 전 예고 → 10초 전 뚜뚜 → 5·4·3·2·1 → 삐)";
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

$("apply-lead").addEventListener("click", () => {
  if (latestRec === null) return;
  S.leadMs = latestRec;
  $("lead").value = S.leadMs; $("lead-val").textContent = S.leadMs;
  save(window.localStorage, S);
  renderStats();
});
$("sound-test").addEventListener("click", () => {
  enableAudio();
  beep(880, 300, 0.3);
  const sess = navigator.audioSession ? "지원" : "미지원";
  setTimeout(() => {
    const lat = reportedLatency();
    const latTxt = lat === null ? "기기 미제공(수동 보정 필요)" : `${Math.round(lat * 1000)}ms(자동 보정됨)`;
    $("net-result").textContent = `[진단 v1.5] 소리엔진: ${audioState()} / iOS세션: ${sess} / 출력지연: ${latTxt}`;
  }, 100);
});

$("lead").addEventListener("input", (e) => { S.leadMs = Number(e.target.value); $("lead-val").textContent = S.leadMs; save(window.localStorage, S); });
$("sound-lat").addEventListener("input", (e) => { S.soundLatencyMs = Number(e.target.value); $("sound-lat-val").textContent = S.soundLatencyMs; save(window.localStorage, S); });
$("offset").addEventListener("change", (e) => { S.manualOffsetMs = Number(e.target.value); save(window.localStorage, S); });
$("sound").addEventListener("change", (e) => { S.soundOn = e.target.checked; save(window.localStorage, S); });
function applyMode() {
  const practice = S.mode === "practice";
  $("start-practice").hidden = !practice;
  renderStats();
}
$("mode").addEventListener("change", (e) => { S.mode = e.target.value; save(window.localStorage, S); applyMode(); });
$("start-practice").addEventListener("click", () => { pickTarget(); });

// ---- 시작 ----
pickTarget();
doSync();
applyMode();
requestAnimationFrame(loop);
setInterval(doSync, 5 * 60 * 1000); // 5분마다 재동기화
