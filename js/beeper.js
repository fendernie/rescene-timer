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
