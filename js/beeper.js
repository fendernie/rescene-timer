// WebAudio로 짧은 비프음 생성. 외부 파일·지연 없음.
let ctx = null;

export function enableAudio() {
  // iOS: 무음 스위치가 켜져 있어도 소리가 나도록 "미디어 재생" 세션으로 선언 (iOS 16.4+)
  if (navigator.audioSession) {
    try { navigator.audioSession.type = "playback"; } catch { /* 미지원 기기는 무시 */ }
  }
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state !== "running") ctx.resume();
  // iOS 정식 잠금해제: 사용자 제스처 안에서 무음 버퍼를 1회 재생해야 이후 소리가 허용됨
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* 무시 */ }
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

// delaySec 뒤에 울리도록 오디오 시계에 예약. 기기 출력 지연만큼 당겨서 "들리는 시점"을 맞춘다.
// 성공하면 예약 노드(취소용)를, 엔진이 잠겨 있으면 null을 반환한다.
export function scheduleBeepIn(delaySec, freq = 880, ms = 60, gain = 0.2) {
  if (!ctx || ctx.state !== "running") return null;
  const latency = ctx.outputLatency || ctx.baseLatency || 0;
  const when = ctx.currentTime + Math.max(0, delaySec - latency);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(when);
  osc.stop(when + ms / 1000);
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
