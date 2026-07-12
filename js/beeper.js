// WebAudio로 짧은 비프음 생성. 외부 파일·지연 없음.
let ctx = null;
export function enableAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
}
export function beep(freq = 880, ms = 60, gain = 0.2) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g); g.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + ms / 1000);
}
