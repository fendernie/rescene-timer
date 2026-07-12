# 리센느 정밀 00초 가이드 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 폰·PC 브라우저에서 여는 설치 없는 웹페이지로, 표준시에 동기화된 정밀 00초 카운트다운과 예측형 신호·클릭 피드백·연습 모드를 제공한다.

**Architecture:** 순수 HTML/CSS/JS(빌드·프레임워크·백엔드 없음). 순수 로직(시계 오프셋 계산, 카운트다운 타이밍, 클릭 오차 통계, 설정 저장)은 DOM/네트워크와 분리된 ES 모듈로 만들어 `node --test`로 단위 테스트한다. DOM·오디오·네트워크 연결부는 브라우저 수동 QA로 검증한다.

**Tech Stack:** ES modules, Node 24 내장 test runner(`node --test`, 무의존성), WebAudio, localStorage, `requestAnimationFrame`.

## Global Constraints

- 런타임 의존성 0개. devDependency도 없음(Node 내장 test runner만 사용). — spec §8
- 백엔드 없음. 외부 네트워크는 시각 동기화(선택적, best-effort)에만 사용하며 실패해도 앱은 동작. — spec §8, §5(A)
- 모든 파일은 ES module(`"type": "module"`).
- 시각 기준: `clockSync.now()` + 수동 보정값(ms, 기본 0). 표준시 = 리센느 서버시간(측정으로 확인). — spec §3, §7
- 최종 정밀도 바닥은 사람 손 ±30~50ms. 밀리초 완벽은 목표 아님. — spec §7
- 사용자는 코딩 비전문가. README에 실행/호스팅법을 쉬운 한국어로 제공. — spec §8

---

## File Structure

```
rescene-timer/
  package.json          # {"type":"module","scripts":{"test":"node --test"}}
  index.html            # 앱 화면 구조
  css/style.css         # 스타일
  js/clockSync.js       # 시각 오프셋 계산 + best-effort 네트워크 동기화 (순수+얇은 네트워크)
  js/countdown.js       # 목표 시각/카운트다운/리드타임/신호 시점 (순수)
  js/hitMeter.js        # 클릭 오차 + 통계 (순수)
  js/settings.js        # localStorage 저장/불러오기 (주입식 storage)
  js/beeper.js          # WebAudio 틱/정각음 (브라우저 전용)
  js/app.js             # 배선: rAF 루프, DOM 갱신, 입력, 모드 전환
  test/clockSync.test.js
  test/countdown.test.js
  test/hitMeter.test.js
  test/settings.test.js
  README.md             # 사용/호스팅 가이드 (쉬운 한국어)
```

---

### Task 1: 프로젝트 스캐폴드 + 시각 오프셋 계산

**Files:**
- Create: `package.json`
- Create: `js/clockSync.js`
- Test: `test/clockSync.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `rttOf(sample) -> number` (sample `{t0,t1,serverMs}`, 반환 ms)
  - `bestSample(samples[]) -> sample` (rtt 최소 샘플)
  - `offsetFromSample(sample) -> number` (offset ms; `serverMs - (t0+t1)/2`)
  - `computeOffset(samples[]) -> {offsetMs, rttMs}` (best 샘플 기준; 빈 배열이면 `{offsetMs:0, rttMs:Infinity}`)
  - `nowWith(offsetMs, clock=Date.now) -> number` (참 시각 추정 = `clock()+offsetMs`)

- [ ] **Step 1: package.json 작성**

```json
{
  "name": "rescene-timer",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `test/clockSync.test.js`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { rttOf, bestSample, offsetFromSample, computeOffset, nowWith } from "../js/clockSync.js";

test("rttOf = t1 - t0", () => {
  assert.equal(rttOf({ t0: 1000, t1: 1120, serverMs: 1050 }), 120);
});

test("bestSample picks minimum rtt", () => {
  const s = [
    { t0: 0, t1: 200, serverMs: 100 },
    { t0: 0, t1: 40, serverMs: 100 },
    { t0: 0, t1: 90, serverMs: 100 },
  ];
  assert.equal(bestSample(s).t1, 40);
});

test("offsetFromSample = serverMs - midpoint", () => {
  // midpoint of [1000,1120] = 1060; server said 1090 -> offset +30
  assert.equal(offsetFromSample({ t0: 1000, t1: 1120, serverMs: 1090 }), 30);
});

test("computeOffset uses best sample and reports its rtt", () => {
  const s = [
    { t0: 0, t1: 200, serverMs: 130 },
    { t0: 0, t1: 40, serverMs: 30 }, // best: mid=20, offset=+10
  ];
  assert.deepEqual(computeOffset(s), { offsetMs: 10, rttMs: 40 });
});

test("computeOffset on empty -> zero offset, infinite rtt", () => {
  assert.deepEqual(computeOffset([]), { offsetMs: 0, rttMs: Infinity });
});

test("nowWith adds offset to injected clock", () => {
  assert.equal(nowWith(25, () => 1000), 1025);
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/clockSync.js'`

- [ ] **Step 4: 최소 구현** — `js/clockSync.js`

```javascript
// 시각 오프셋 계산: 서버/시각소스 응답 샘플로 기기 시계 보정값을 추정한다.
// sample = { t0: 요청보낸 로컬시각(ms), t1: 응답받은 로컬시각(ms), serverMs: 응답의 서버시각(ms) }

export function rttOf(sample) {
  return sample.t1 - sample.t0;
}

export function bestSample(samples) {
  return samples.reduce((a, b) => (rttOf(b) < rttOf(a) ? b : a));
}

export function offsetFromSample(sample) {
  const midpoint = (sample.t0 + sample.t1) / 2;
  return sample.serverMs - midpoint;
}

export function computeOffset(samples) {
  if (!samples.length) return { offsetMs: 0, rttMs: Infinity };
  const best = bestSample(samples);
  return { offsetMs: offsetFromSample(best), rttMs: rttOf(best) };
}

export function nowWith(offsetMs, clock = Date.now) {
  return clock() + offsetMs;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (6 tests)

- [ ] **Step 6: 커밋**

```bash
git add package.json js/clockSync.js test/clockSync.test.js
git commit -m "feat: clock offset math + project scaffold"
```

---

### Task 2: 시각 소스 네트워크 동기화 (best-effort)

**Files:**
- Modify: `js/clockSync.js`
- Test: `test/clockSync.test.js`

**Interfaces:**
- Consumes: `computeOffset`, `bestSample` (Task 1)
- Produces:
  - `async syncOnce(fetchFn) -> sample` — `fetchFn()`는 `{serverMs, sentAt, recvAt}`를 주는 얇은 래퍼. 반환 `{t0,t1,serverMs}`.
  - `async syncOffset(fetchFn, rounds=5) -> {offsetMs, rttMs, ok}` — rounds회 시도 후 computeOffset. 전부 실패면 `{offsetMs:0, rttMs:Infinity, ok:false}`.

**참고(구현 시 QA):** 실제 `fetchFn`은 CORS 허용 시각 소스의 `Date` 응답 헤더(1초 해상도)를 읽거나, ms 해상도 JSON 소스를 쓴다. 막히면 `ok:false`로 device 시계(offset 0)를 그대로 사용 — 앱은 정상 동작하고 "기기 시계 사용 중" 표시.

- [ ] **Step 1: 실패하는 테스트 추가** — `test/clockSync.test.js` 하단에 append

```javascript
import { syncOnce, syncOffset } from "../js/clockSync.js";

test("syncOnce packs fetch result into a sample", async () => {
  const fake = async () => ({ serverMs: 5050, sentAt: 5000, recvAt: 5100 });
  const s = await syncOnce(fake);
  assert.deepEqual(s, { t0: 5000, t1: 5100, serverMs: 5050 });
});

test("syncOffset aggregates rounds and marks ok", async () => {
  let n = 0;
  const fake = async () => {
    n += 1;
    // rtt shrinks each round; best is last (rtt 40, mid 20, server 30 -> +10)
    return { serverMs: 30, sentAt: 0, recvAt: n === 3 ? 40 : 200 };
  };
  const r = await syncOffset(fake, 3);
  assert.equal(r.ok, true);
  assert.equal(r.offsetMs, 10);
  assert.equal(r.rttMs, 40);
});

test("syncOffset returns ok:false when every round throws", async () => {
  const fail = async () => { throw new Error("blocked"); };
  const r = await syncOffset(fail, 3);
  assert.deepEqual(r, { offsetMs: 0, rttMs: Infinity, ok: false });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `syncOnce`/`syncOffset` is not a function

- [ ] **Step 3: 구현 추가** — `js/clockSync.js` 하단에 append

```javascript
export async function syncOnce(fetchFn) {
  const { serverMs, sentAt, recvAt } = await fetchFn();
  return { t0: sentAt, t1: recvAt, serverMs };
}

export async function syncOffset(fetchFn, rounds = 5) {
  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    try {
      samples.push(await syncOnce(fetchFn));
    } catch {
      // 개별 실패는 무시하고 다음 라운드 시도
    }
  }
  if (!samples.length) return { offsetMs: 0, rttMs: Infinity, ok: false };
  return { ...computeOffset(samples), ok: true };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/clockSync.js test/clockSync.test.js
git commit -m "feat: best-effort network time sync"
```

---

### Task 3: 카운트다운 / 목표 / 신호 시점 로직

**Files:**
- Create: `js/countdown.js`
- Test: `test/countdown.test.js`

**Interfaces:**
- Consumes: 없음 (순수)
- Produces:
  - `nextMinuteBoundary(nowMs) -> number` — nowMs 이후 가장 가까운 "초=0" 시각(ms). 정확히 경계면 다음 경계.
  - `msUntil(nowMs, targetMs) -> number`
  - `signalPhase(nowMs, targetMs, leadMs) -> {phase, msLeft}` — `phase`는 `"idle" | "tick3" | "tick2" | "tick1" | "go"`. 신호는 리드타임만큼 앞당김: 유효기준시각 `eff = nowMs + leadMs`. `eff >= targetMs` → `go`. 아니면 정수 초 카운트에 따라 tick3/2/1(각 [-3s,-2s), [-2s,-1s), [-1s,0)) 또는 idle.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/countdown.test.js`

```javascript
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/countdown.js'`

- [ ] **Step 3: 최소 구현** — `js/countdown.js`

```javascript
// 카운트다운/신호 타이밍 (순수 함수). 시각은 모두 epoch ms.
const MINUTE = 60_000;

export function nextMinuteBoundary(nowMs) {
  return Math.floor(nowMs / MINUTE) * MINUTE + MINUTE;
}

export function msUntil(nowMs, targetMs) {
  return targetMs - nowMs;
}

export function signalPhase(nowMs, targetMs, leadMs) {
  const msLeft = msUntil(nowMs, targetMs);
  const eff = nowMs + leadMs; // 리드타임만큼 신호를 앞당김
  const effLeft = targetMs - eff;
  let phase;
  if (effLeft <= 0) phase = "go";
  else if (effLeft < 1000) phase = "tick1";
  else if (effLeft < 2000) phase = "tick2";
  else if (effLeft < 3000) phase = "tick3";
  else phase = "idle";
  return { phase, msLeft };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add js/countdown.js test/countdown.test.js
git commit -m "feat: countdown target + anticipatory signal phases"
```

---

### Task 4: 클릭 오차 + 통계

**Files:**
- Create: `js/hitMeter.js`
- Test: `test/hitMeter.test.js`

**Interfaces:**
- Consumes: 없음 (순수)
- Produces:
  - `hitError(clickMs, targetMs) -> number` — `clickMs - targetMs` (+=늦음, -=빠름)
  - `stats(errors[]) -> {n, mean, stdev, best, recent}` — `best`=|오차| 최소값의 부호있는 값; `recent`=마지막 최대 10개; 빈 배열이면 `{n:0, mean:0, stdev:0, best:null, recent:[]}`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/hitMeter.test.js`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { hitError, stats } from "../js/hitMeter.js";

test("hitError: positive means late", () => {
  assert.equal(hitError(1045, 1000), 45);
  assert.equal(hitError(980, 1000), -20);
});

test("stats empty", () => {
  assert.deepEqual(stats([]), { n: 0, mean: 0, stdev: 0, best: null, recent: [] });
});

test("stats computes mean and population stdev", () => {
  const r = stats([10, -10, 10, -10]);
  assert.equal(r.n, 4);
  assert.equal(r.mean, 0);
  assert.equal(r.stdev, 10);
});

test("stats.best = signed value with smallest magnitude", () => {
  assert.equal(stats([40, -12, 100]).best, -12);
});

test("stats.recent keeps last 10 in order", () => {
  const arr = Array.from({ length: 15 }, (_, i) => i);
  const r = stats(arr);
  assert.deepEqual(r.recent, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/hitMeter.js'`

- [ ] **Step 3: 최소 구현** — `js/hitMeter.js`

```javascript
// 클릭 오차와 연습 통계 (순수). 오차 단위 ms, +는 늦음.

export function hitError(clickMs, targetMs) {
  return clickMs - targetMs;
}

export function stats(errors) {
  const n = errors.length;
  if (!n) return { n: 0, mean: 0, stdev: 0, best: null, recent: [] };
  const mean = errors.reduce((a, b) => a + b, 0) / n;
  const variance = errors.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const best = errors.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  const recent = errors.slice(-10);
  return { n, mean, stdev, best, recent };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add js/hitMeter.js test/hitMeter.test.js
git commit -m "feat: click error + practice stats"
```

---

### Task 5: 설정 저장 (localStorage)

**Files:**
- Create: `js/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `DEFAULTS` — `{ leadMs: 200, manualOffsetMs: 0, soundOn: true, targetMode: "nextMinute", mode: "live", errors: [] }`
  - `load(storage) -> settings` — `storage`는 `{getItem,setItem}`. 없거나 깨지면 DEFAULTS 복사본.
  - `save(storage, settings) -> void` — key `"rescene-timer"`에 JSON 저장.

- [ ] **Step 1: 실패하는 테스트 작성** — `test/settings.test.js`

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULTS, load, save } from "../js/settings.js";

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

test("load returns defaults when empty", () => {
  assert.deepEqual(load(memStore()), DEFAULTS);
});

test("load returns a copy, not the DEFAULTS object", () => {
  const s = load(memStore());
  s.leadMs = 999;
  assert.equal(DEFAULTS.leadMs, 200);
});

test("save then load round-trips", () => {
  const store = memStore();
  const s = { ...DEFAULTS, leadMs: 175, errors: [12, -8] };
  save(store, s);
  assert.deepEqual(load(store), s);
});

test("load tolerates corrupt json -> defaults", () => {
  const store = memStore();
  store.setItem("rescene-timer", "{not json");
  assert.deepEqual(load(store), DEFAULTS);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../js/settings.js'`

- [ ] **Step 3: 최소 구현** — `js/settings.js`

```javascript
// 설정 지속성. storage는 localStorage 호환 {getItem,setItem}.
const KEY = "rescene-timer";

export const DEFAULTS = {
  leadMs: 200,
  manualOffsetMs: 0,
  soundOn: true,
  targetMode: "nextMinute",
  mode: "live", // "live" | "practice"
  errors: [],
};

export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(storage, settings) {
  storage.setItem(KEY, JSON.stringify(settings));
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add js/settings.js test/settings.test.js
git commit -m "feat: settings persistence"
```

---

### Task 6: 화면 구조(HTML) + 스타일(CSS)

**Files:**
- Create: `index.html`
- Create: `css/style.css`

**Interfaces:**
- Consumes: 없음 (아직 스크립트 배선 안 함)
- Produces: `app.js`(Task 7)가 참조할 DOM id들:
  `#clock`, `#sync-status`, `#count`, `#gauge`, `#go-flash`, `#hit-result`,
  `#lead`, `#lead-val`, `#offset`, `#sound`, `#mode`, `#stats`, `#start-practice`

이 태스크는 브라우저 수동 QA로 검증한다(단위 테스트 없음).

- [ ] **Step 1: index.html 작성**

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>리센느 00초 가이드</title>
  <link rel="stylesheet" href="css/style.css" />
</head>
<body>
  <div id="go-flash" aria-hidden="true"></div>

  <main class="wrap">
    <p id="sync-status" class="muted">시계 동기화 중…</p>
    <div id="clock" class="clock">--:--:--.---</div>

    <div class="stage">
      <div id="count" class="count">–</div>
      <div id="gauge" class="gauge"><div class="gauge-fill"></div></div>
    </div>

    <p id="hit-result" class="hit">스페이스바 또는 화면을 눌러 타이밍을 재보세요</p>

    <section class="panel">
      <label>미리 누르기(리드타임): <b id="lead-val">200</b> ms
        <input id="lead" type="range" min="0" max="600" step="5" value="200" />
      </label>
      <label>수동 보정값(ms, 보통 0)
        <input id="offset" type="number" value="0" step="1" />
      </label>
      <label><input id="sound" type="checkbox" checked /> 소리</label>
      <label>모드
        <select id="mode">
          <option value="live">실전 가이드</option>
          <option value="practice">연습</option>
        </select>
      </label>
      <button id="start-practice" type="button" hidden>연습 시작 / 다음 라운드</button>
    </section>

    <pre id="stats" class="stats"></pre>
  </main>

  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: css/style.css 작성**

```css
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; font-family: system-ui, -apple-system, sans-serif;
  background: #111; color: #eee; text-align: center;
  -webkit-user-select: none; user-select: none;
}
.wrap { max-width: 520px; margin: 0 auto; padding: 16px; }
.muted { color: #888; font-size: 14px; margin: 8px 0; }
.clock { font-variant-numeric: tabular-nums; font-size: 34px; letter-spacing: 1px; }
.stage { margin: 24px 0; }
.count { font-size: 120px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.gauge { height: 14px; background: #333; border-radius: 8px; overflow: hidden; margin-top: 16px; }
.gauge-fill { height: 100%; width: 0%; background: #35c46a; }
.hit { font-size: 22px; min-height: 30px; }
.hit.late { color: #ff6b6b; } .hit.early { color: #ffd93d; } .hit.good { color: #35c46a; }
.panel { display: grid; gap: 12px; text-align: left; background: #1a1a1a; padding: 16px; border-radius: 12px; }
.panel label { display: block; font-size: 15px; }
.panel input[type="range"] { width: 100%; }
.stats { text-align: left; background: #1a1a1a; padding: 12px; border-radius: 12px; min-height: 20px; white-space: pre-wrap; }
#go-flash {
  position: fixed; inset: 0; background: #35c46a; opacity: 0;
  pointer-events: none; transition: opacity 90ms linear;
}
#go-flash.on { opacity: 0.85; transition: none; }
```

- [ ] **Step 3: 브라우저 QA**

Run: `open index.html` (macOS)
Expected: 시계 자리·큰 숫자·게이지·설정 패널이 보이고 레이아웃이 깨지지 않음. (아직 동작 없음 — 정적 화면 확인만)

- [ ] **Step 4: 커밋**

```bash
git add index.html css/style.css
git commit -m "feat: app layout and styles"
```

---

### Task 7: 배선(app.js) — 시계/카운트다운/신호/클릭 피드백

**Files:**
- Create: `js/beeper.js`
- Create: `js/app.js`

**Interfaces:**
- Consumes: `nowWith,syncOffset`(clockSync), `nextMinuteBoundary,msUntil,signalPhase`(countdown), `hitError,stats`(hitMeter), `load,save`(settings)
- Produces: 브라우저에서 도는 완성 앱(실전 가이드 모드). 연습 통계 표시는 Task 8에서 확장.

이 태스크는 브라우저 수동 QA로 검증한다.

- [ ] **Step 1: js/beeper.js 작성 (WebAudio 틱/정각음)**

```javascript
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
```

- [ ] **Step 2: js/app.js 작성**

```javascript
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
```

- [ ] **Step 3: 브라우저 QA — 시계/카운트다운/신호**

Run: `open index.html`, 옆 탭에 `time.is` 열기
Expected:
- 상단 시계가 time.is와 초 단위로 같이 넘어감(동기화 성공 시 "동기화됨 ±NN ms").
- 큰 숫자가 3→2→1→0으로 줄고, 마지막 3초 게이지가 참.
- 00초 직전(리드타임만큼 앞) 초록 번쩍 + "삐" 소리, 마지막 3초 틱음.

- [ ] **Step 4: 브라우저 QA — 클릭 피드백**

Expected: 카운트다운 중 스페이스바/화면 클릭 시 `+45 ms (늦음)` 같은 오차가 색과 함께 표시(±30ms 이내 초록).

- [ ] **Step 5: 커밋**

```bash
git add js/beeper.js js/app.js
git commit -m "feat: wire clock, countdown, signals, click feedback"
```

---

### Task 8: 연습 모드 + 통계 표시

**Files:**
- Modify: `js/app.js`

**Interfaces:**
- Consumes: `registerHit()`(Task 7), `stats`(hitMeter), `save`(settings)
- Produces: 연습 모드에서 시도 오차를 `S.errors`에 누적하고 `#stats`에 평균/표준편차/최근 기록 표시.

이 태스크는 브라우저 수동 QA로 검증한다.

- [ ] **Step 1: 통계 렌더 함수 추가** — `js/app.js`의 `registerHit` 아래에 추가

```javascript
function renderStats() {
  const s = stats(S.errors);
  if (!s.n) { $("stats").textContent = "연습 기록 없음"; return; }
  const bars = s.recent.map((e) => `${e >= 0 ? "+" : ""}${Math.round(e)}`).join("  ");
  $("stats").textContent =
    `시도 ${s.n}회 | 평균 ${s.mean.toFixed(0)}ms | 편차 ±${s.stdev.toFixed(0)}ms | 최고 ${s.best}ms\n최근: ${bars}`;
}
```

- [ ] **Step 2: 모드 전환 + 연습 기록 배선 추가** — `js/app.js`의 이벤트 영역에 추가

```javascript
function applyMode() {
  const practice = S.mode === "practice";
  $("start-practice").hidden = !practice;
  renderStats();
}
$("mode").addEventListener("change", (e) => { S.mode = e.target.value; save(window.localStorage, S); applyMode(); });
$("start-practice").addEventListener("click", () => { pickTarget(); });
```

- [ ] **Step 3: registerHit이 연습 모드일 때 기록하도록 수정** — `registerHit` 함수의 `return err;` 바로 앞에 추가

```javascript
  if (S.mode === "practice") {
    S.errors.push(Math.round(err));
    if (S.errors.length > 200) S.errors = S.errors.slice(-200);
    save(window.localStorage, S);
    renderStats();
  }
```

- [ ] **Step 4: 시작 시 모드 반영** — `js/app.js` 맨 아래 `requestAnimationFrame(loop);` 앞에 추가

```javascript
applyMode();
```

- [ ] **Step 5: 브라우저 QA — 연습 모드**

Run: `open index.html`, 모드를 "연습"으로 변경
Expected:
- "연습 시작 / 다음 라운드" 버튼이 보임.
- 카운트다운마다 스페이스로 눌러 여러 번 시도 → `#stats`에 시도횟수·평균·편차·최근 기록이 누적 표시.
- 새로고침해도 기록 유지(localStorage). 모드 "실전"으로 바꾸면 기록 누적 중단.

- [ ] **Step 6: 커밋**

```bash
git add js/app.js
git commit -m "feat: practice mode with timing stats"
```

---

### Task 9: 사용 가이드(README) + 최종 통합 QA

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 완성된 앱
- Produces: 비개발자용 실행/호스팅 안내와 실전 사용법.

- [ ] **Step 1: README.md 작성 (쉬운 한국어)**

````markdown
# 리센느 00초 가이드

러스챗(플러스챗) 리센느 선착순 신청을 **정확히 00초에** 누르도록 도와주는 웹페이지입니다.
폰·PC 브라우저에서 그대로 열면 됩니다. 설치 필요 없음.

## 여는 법
- **PC:** `index.html` 파일을 더블클릭(또는 브라우저로 열기).
- **폰에서도 쓰려면(권장):** 무료 정적 호스팅에 올려 링크로 사용.
  1. GitHub 계정에서 새 저장소를 만들고 이 폴더 파일을 올립니다.
  2. 저장소 Settings → Pages → 브랜치 지정 → 나오는 주소를 폰·PC에서 즐겨찾기.
  - (원하면 도와드립니다.)

## 쓰는 법
1. 페이지를 열면 위 시계가 정확한 표준시각에 맞춰집니다("동기화됨" 표시 확인).
2. **연습 모드**로 먼저 손을 맞추세요: 카운트다운을 보며 00초에 스페이스바(또는 화면)를 누르면
   `+45 ms(늦음)`처럼 오차가 나옵니다. 0에 가깝게 될 때까지 반복.
3. 계속 늦게 나오면 **미리 누르기(리드타임)** 를 조금 올리고, 너무 빠르면 내립니다.
4. 실전에서는 러스챗 신청 페이지를 띄워 두고, 이 가이드의 신호(마지막 3초 틱음 → 초록 번쩍 "삐")에
   맞춰 **예측해서** 신청 버튼을 누릅니다.

## 참고
- 표준시 = 리센느 서버시간(측정으로 확인). 특별한 경우가 아니면 "수동 보정값"은 0으로 둡니다.
- 사람이 직접 누르므로 정밀도 한계는 약 ±30~50ms입니다.
````

- [ ] **Step 2: 전체 테스트 재확인**

Run: `npm test`
Expected: PASS (전체, 실패 0)

- [ ] **Step 3: 최종 통합 QA (브라우저)**

Run: `open index.html`
Expected 체크리스트:
- 동기화 상태 표시됨.
- 시계가 `time.is`와 초 단위로 일치.
- 실전 모드: 카운트다운·틱음·정각 번쩍/삐·클릭 오차 표시 정상.
- 연습 모드: 통계 누적·새로고침 후 유지.
- 소리 끄기, 리드타임 변경, 보정값 변경이 즉시 반영되고 저장됨.

- [ ] **Step 4: 커밋**

```bash
git add README.md
git commit -m "docs: usage and hosting guide"
```

---

## Self-Review

**Spec coverage:**
- 설치 없는 웹페이지·폰/PC 공용 → Task 6, 9(호스팅) ✓
- 표준시 자동 동기화 → Task 1,2,7 ✓
- 예측형 시각+소리 신호 → Task 3(phase), 7(beep/flash) ✓
- 클릭 피드백(ms 오차) → Task 4, 7 ✓
- 연습 모드 + 통계 → Task 4, 8 ✓
- 리드타임/수동 보정값/소리/목표 설정 + 저장 → Task 5, 7, 8 ✓
- 정확도 한계 명시 → README(Task 9) ✓
- 무의존성/백엔드 없음 → Task 1(package.json), 전반 ✓
- 2단계 자동제출은 범위 밖(별도 spec) — 계획 포함 안 함(의도된 제외) ✓

**Placeholder scan:** "적절한 에러처리" 류 없음. 모든 코드 스텝에 실제 코드 포함. 네트워크 소스는 구체 URL + fallback 명시.

**Type consistency:** `computeOffset→{offsetMs,rttMs}`가 Task2 `syncOffset`에서 그대로 확장(`ok` 추가). `signalPhase` phase 문자열이 Task7 렌더에서 동일 사용. `stats`의 `{n,mean,stdev,best,recent}`가 Task8 렌더와 일치. `S`(settings) 필드가 DEFAULTS와 app.js 사용처에서 일치. ✓
