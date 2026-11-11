import { test } from "node:test";
import assert from "node:assert/strict";
import { presignV4, r2Url, r2FromEnv, uriEncode } from "./r2.ts";

// Ejemplo oficial de AWS (Authenticating Requests: Using Query Parameters, «Example presigned URL»).
test("SigV4 por query string coincide con el ejemplo de AWS", async () => {
  const url = await presignV4({ method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1", expires: 86400, date: new Date("2013-05-24T00:00:00Z") });
  assert.match(url, /X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404$/);
  assert.match(url, /X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request/);
});

test("R2: host de la cuenta, ruta con bucket, región auto y caducidad", async () => {
  const u = new URL(await r2Url({ accountId: "abc123", accessKeyId: "K", secretAccessKey: "S", bucket: "rafaga-originals" }, "PUT", "ws/src/original", 900));
  assert.equal(u.host, "abc123.r2.cloudflarestorage.com");
  assert.equal(u.pathname, "/rafaga-originals/ws/src/original");
  assert.equal(u.searchParams.get("X-Amz-Expires"), "900");
  assert.match(u.searchParams.get("X-Amz-Credential")!, /\/auto\/s3\/aws4_request$/);
  assert.ok(!u.toString().includes("S&") && !u.searchParams.has("secret"));
});

test("sin las cuatro variables no hay configuración", () => {
  assert.equal(r2FromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c" }), null);
  assert.ok(r2FromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" }));
  assert.equal(uriEncode("a b/ñ", false), "a%20b/%C3%B1");
  assert.equal(r2FromEnv({ R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "PEGAR_AQUI_LA_CLAVE", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d" }), null, "un marcador no activa R2");
});
