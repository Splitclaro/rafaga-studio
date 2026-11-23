import { test } from "node:test";
import assert from "node:assert/strict";
import { tiktokState, storageConnected } from "./connstate.ts";

test("TikTok: sin cuentas dice «Sin conectar» y 0 entregas", () => {
  const s = tiktokState([], []);
  assert.equal(s.label, "Sin conectar"); assert.equal(s.connected, 0); assert.equal(s.delivered, 0);
});
test("TikTok: 2 cuentas conectadas y entregas contadas (publicada + borrador en bandeja)", () => {
  const s = tiktokState([{ status: "connected" }, { status: "connected" }], [{ state: "published" }, { state: "private_pending_review" }, { state: "scheduled" }, { state: "failed" }]);
  assert.equal(s.label, "2 cuentas conectadas"); assert.equal(s.delivered, 2);
});
test("TikTok: una caducada se señala, no se oculta", () => {
  const s = tiktokState([{ status: "connected" }, { status: "expired" }], null);
  assert.equal(s.needsAttention, 1); assert.match(s.label, /1 conectada · 1 por revisar/);
});
test("Almacenamiento: solo cuenta Drive y Dropbox conectados", () => {
  assert.equal(storageConnected([{ provider: "google", status: "connected", scopes: ["drive.readonly"] }, { provider: "dropbox", status: "expired" }, { provider: "tiktok", status: "connected" }]), 1);
  assert.equal(storageConnected([{ provider: "google", status: "connected", scopes: ["youtube.readonly"] }]), 0, "una conexión de YouTube no es un Drive");
  assert.equal(storageConnected(null), 0);
});
