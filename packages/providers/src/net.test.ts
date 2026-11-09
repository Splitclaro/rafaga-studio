import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, checkUrl, parseFeed, safeGet, SsrfError } from "./net.ts";

test("IPs privadas, locales y de metadata se rechazan; públicas se admiten", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1"]) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111"]) assert.equal(isPublicIp(ip), true, ip);
});
test("checkUrl bloquea esquemas, puertos, credenciales y hosts locales (incluidas formas numéricas)", () => {
  for (const u of ["http://example.com/a", "file:///etc/passwd", "ftp://example.com", "https://example.com:8443/", "https://user:pw@example.com/", "https://localhost/", "https://foo.localhost/", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/latest/meta-data", "https://2130706433/", "https://0x7f.1/", "https://metadata.internal/", "no es url"])
    assert.throws(() => checkUrl(u), SsrfError, u);
  assert.ok(checkUrl("https://example.com/feed.xml"));
});
test("safeGet rechaza antes de conectar (sin red)", async () => {
  await assert.rejects(() => safeGet("https://127.0.0.1/x", { maxBytes: 10 }), SsrfError);
  await assert.rejects(() => safeGet("http://example.com/x", { maxBytes: 10 }), SsrfError);
  await assert.rejects(() => safeGet("https://localhost/x", { maxBytes: 10 }), SsrfError);
});
test("parseFeed lee RSS con enclosure, CDATA y fechas", () => {
  const xml = `<?xml version="1.0"?><rss><channel><item><title><![CDATA[Episodio 1 & más]]></title><guid isPermaLink="false">abc-1</guid><pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate><enclosure url="https://cdn.example.com/e1.mp4" type="video/mp4" length="123"/></item><item><title>Sin vídeo</title><guid>abc-2</guid></item></channel></rss>`;
  const f = parseFeed(xml);
  assert.equal(f.length, 2);
  assert.equal(f[0].title, "Episodio 1 & más"); assert.equal(f[0].guid, "abc-1"); assert.equal(f[0].enclosureUrl, "https://cdn.example.com/e1.mp4"); assert.equal(f[0].published?.toISOString(), "2026-11-09T10:00:00.000Z");
  assert.equal(f[1].enclosureUrl, null);
});
