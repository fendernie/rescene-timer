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

test("save swallows storage errors (private mode)", () => {
  const throwing = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.doesNotThrow(() => save(throwing, DEFAULTS));
});
