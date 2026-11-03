// WebAudio로 짧은 비프음 생성. 외부 파일·지연 없음.
let ctx = null;

export function enableAudio() {
  // iOS: 무음 스위치가 켜져 있어도 소리가 나도록 "미디어 재생" 세션으로 선언 (iOS 16.4+)
  if (navigator.audioSession) {
    try { navigator.audioSession.type = "playback"; } catch { /* 미지원 기기는 무시 */ }
  }
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.addEventListener?.("statechange", () => { anchor = null; }); // 멈췄다 재개되면 비율 기준 리셋
  }
  if (ctx.state !== "running") ctx.resume();
  startClockKeeper();
  // iOS 정식 잠금해제: 사용자 제스처 안에서 무음 버퍼를 1회 재생해야 이후 소리가 허용됨
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* 무시 */ }
}

// 오디오 시계 안정화: 소리가 없으면 크롬이 오디오 처리를 띄엄띄엄 쉬어서 오디오 시계가 밀린다.
// 실측(2026-11-03, 창 숨김): 무음 상태 -40~-595ppm(30초 앞 예약이 38ms 늦게 울림) → 들리지 않는
// 극소 신호(-100dB)를 계속 흘리면 4ppm으로 안정. 한 번만 만들고 계속 둔다.
let keeper = null;
function startClockKeeper() {
  if (keeper || !ctx) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 30;
    g.gain.value = 0.00001;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    keeper = o;
  } catch { /* 실패하면 다음 enableAudio에서 재시도 */ }
}

export function audioState() {
  return ctx ? ctx.state : "none";
}

// 기기가 알려주는 출력지연(초). 사파리 등 미지원 기기는 null.
export function reportedLatency() {
  if (!ctx) return null;
  const v = ctx.outputLatency ?? ctx.baseLatency;
  return typeof v === "number" ? v : null;
}

// 백그라운드에서도 오디오 세션이 살아 있도록 "진짜 오디오 파일"을 루프 재생.
// (iOS는 완전 무음 WebAudio 루프를 감지해 세션을 재우므로, 사실상 들리지 않는
//  극소 진폭의 WAV를 <audio> 요소로 재생해 음악 앱처럼 취급되게 한다.)
function quietWavURI() {
  const rate = 8000;
  const n = rate; // 1초
  const bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const wstr = (off, s) => { for (let i = 0; i < s.length; i += 1) bytes[off + i] = s.charCodeAt(i); };
  wstr(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); wstr(8, "WAVE");
  wstr(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  wstr(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i += 1) dv.setInt16(44 + i * 2, i % 2 ? 8 : -8, true); // 들리지 않는 극소 진폭
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
}

let keepAliveEl = null;
export function startKeepalive() {
  if (keepAliveEl) return;
  keepAliveEl = new Audio(quietWavURI());
  keepAliveEl.loop = true;
  keepAliveEl.play().catch(() => { /* 재생 거부 시 백그라운드 유지가 안 될 수 있음 */ });
}
export function stopKeepalive() {
  if (!keepAliveEl) return;
  keepAliveEl.pause();
  keepAliveEl = null;
}

// 오디오 시계의 빠르기(시스템 시계 1초당 오디오 시계 몇 초). 실측(2026-11-03, 맥북에어 내장 스피커):
// 오디오 시계가 1분에 ~40ms 느림(≈0.9993) → 5분 앞 예약(창 숨김 모드)이면 ~0.2초 늦게 울린다. 그래서 비율을 재서 보정.
// 기준점(anchor)에서 10초 이상 지나야 비율을 믿고, ±1% 밖 값(일시정지 등으로 깨진 값)은 버린다.
let anchor = null;
function audioRate(ts) {
  if (!anchor) { anchor = { ct: ts.contextTime, p: ts.performanceTime }; return 1; }
  const dp = (ts.performanceTime - anchor.p) / 1000;
  if (dp < 10) return 1;
  const r = (ts.contextTime - anchor.ct) / dp;
  if (r > 0.99 && r < 1.01) return r;
  anchor = { ct: ts.contextTime, p: ts.performanceTime }; // 깨진 기준점 → 새로 시작
  return 1;
}
// 주기적으로 불러 기준점을 일찍 잡아 둔다 (예약 직전에야 잡으면 비율 측정 기간이 짧음)
export function trackAudioClock() {
  if (!ctx || ctx.state !== "running") return null;
  const ts = ctx.getOutputTimestamp?.();
  return ts && ts.performanceTime > 0 ? audioRate(ts) : null;
}

// "지금부터 delaySec 뒤 스피커에서 소리가 나려면" 오디오 시계로 언제 시작해야 하는지.
// getOutputTimestamp는 "오디오 시각 ↔ 실제 출력 시각" 대응표라 출력 지연이 이미 반영돼 있다
// (실측: 기존 currentTime-지연 방식은 0~6ms 흔들림 → 이 방식이 더 정확). 미지원/초기값이면 기존 방식.
function outputWhen(delaySec) {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
    const targetPerf = performance.now() + delaySec * 1000;
    const r = audioRate(ts);
    return Math.max(ctx.currentTime, ts.contextTime + ((targetPerf - ts.performanceTime) / 1000) * r);
  }
  const latency = ctx.outputLatency || ctx.baseLatency || 0;
  return ctx.currentTime + Math.max(0, delaySec - latency);
}

// delaySec 뒤에 울리도록 오디오 시계에 예약. 기기 출력 지연만큼 당겨서 "들리는 시점"을 맞춘다.
// 성공하면 예약 노드(취소용)를, 엔진이 잠겨 있으면 null을 반환한다.
export function scheduleBeepIn(delaySec, freq = 880, ms = 60, gain = 0.2) {
  if (!ctx || ctx.state !== "running") return null;
  const when = outputWhen(delaySec);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + ms / 1000);
  osc.when = when; // 검증용: 예약된 오디오 시각
  return osc;
}

export function beep(freq = 880, ms = 60, gain = 0.2) {
  if (!ctx) return;
  const play = () => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  };
  if (ctx.state === "running") play();
  else ctx.resume().then(play).catch(() => { /* 잠금 해제 실패 — 다음 상호작용에서 재시도 */ });
}
