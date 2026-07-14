// WebAudio로 짧은 비프음 생성. 외부 파일·지연 없음.
let ctx = null;
export function enableAudio() {
  // iOS: 무음 스위치가 켜져 있어도 소리가 나도록 "미디어 재생" 세션으로 선언 (iOS 16.4+)
  if (navigator.audioSession) {
    try { navigator.audioSession.type = "playback"; } catch { /* 미지원 기기는 무시 */ }
  }
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
}
export function beep(freq = 880, ms = 60, gain = 0.2) {
  if (!ctx) return;
  if (ctx.state !== "running") ctx.resume(); // iOS가 도중에 잠갔으면 자가 복구
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g); g.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + ms / 1000);
}
