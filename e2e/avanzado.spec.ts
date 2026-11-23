// V3 · Editor de vídeo avanzado: crear, editar, guardar, reabrir y EXPORTAR en el navegador; el archivo descargado se comprueba con ffprobe y fotogramas.
import { test, expect, type Page } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockBackend, watchErrors } from "./mock.ts";

const PID = "55555555-5555-4555-8555-555555555555", RED = "66666666-6666-4666-8666-666666666666", BLUE = "77777777-7777-4777-8777-777777777777";
const dir = mkdtempSync(join(tmpdir(), "avz-")), file = (n: string) => join(dir, n);
test.beforeAll(() => {
  // Chromium de Playwright no trae H.264: los medios de prueba son WebM (VP8 + Opus).
  for (const [n, c, f] of [["rojo", "red", 440], ["azul", "blue", 880]] as const) {
    const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:s=320x240:r=30:d=3`, "-f", "lavfi", "-i", `sine=f=${f}:d=3`, "-c:v", "libvpx", "-b:v", "500k", "-c:a", "libopus", "-shortest", file(`${n}.webm`)]);
    expect(r.status, String(r.stderr)).toBe(0);
  }
});

const item = (id: string, media: string, at: number, i: number, o: number) => ({ id, src: { kind: "media_item", id: media, media: "video", name: id, duration: 3 }, at, in: i, out: o, volume: 1, fit: "fill" });
const DOC = { v: 1, tracks: [{ id: "v1", kind: "video", items: [item("a", RED, 0, 0, 1.5), item("b", BLUE, 1.5, 0, 1.5)] }, { id: "t1", kind: "text", items: [{ id: "x", at: 0.2, dur: 2, text: "RÁFAGA", size: "L", color: "#FFFFFF", y: 0.5 }] }, { id: "a1", kind: "audio", items: [] }] };

async function setup(page: Page, saved: { doc?: unknown; name?: string; base?: number }[]) {
  let state = { id: PID, name: "Montaje de prueba", aspect: "9:16", doc: JSON.parse(JSON.stringify(DOC)), version: 1, origin: null, updated_at: "2026-11-23T10:00:00Z" };
  await mockBackend(page, { extra: async (route, url) => {
    if (url.pathname.endsWith("/rest/v1/editor_projects")) { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().headers()["accept"]?.includes("vnd.pgrst.object") ? state : [state]) }); return true; }
    if (url.pathname.endsWith("/rpc/save_editor_project")) { const b = JSON.parse(route.request().postData() ?? "{}"); saved.push({ doc: b.p_doc, name: b.p_name, base: b.p_base_version }); state = { ...state, doc: b.p_doc ?? state.doc, name: b.p_name ?? state.name, aspect: b.p_aspect ?? state.aspect, version: state.version + 1 };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: state.version, updated_at: new Date().toISOString() }) }); return true; }
    return false;
  } });
  for (const [id, n] of [[RED, "rojo"], [BLUE, "azul"]] as const) {
    await page.route(new RegExp(`/api/lyrics/items/${id}/url`), (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `/__fx/${n}.webm` }) }));
    await page.route(new RegExp(`/__fx/${n}\\.webm`), (r) => r.fulfill({ status: 200, contentType: "video/webm", body: readFileSync(file(`${n}.webm`)) }));
  }
}

test("Editar, guardar solo y reabrir: texto, división y deshacer persisten en el proyecto (V3-AV-10..14)", async ({ page }) => {
  const saved: { doc?: unknown; name?: string }[] = []; await setup(page, saved); const bad = watchErrors(page);
  await page.goto(`/app/avanzado/${PID}`);
  await expect(page.getByLabel("Nombre del proyecto")).toHaveValue("Montaje de prueba");
  await page.getByRole("button", { name: /Plano a, de 0\.0/ }).click();
  await expect(page.getByLabel("Recorte: hasta")).toHaveValue("1.5");
  await page.getByLabel("Recorte: hasta").fill("1"); await page.getByLabel("Recorte: hasta").blur();
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();
  const d1 = saved.at(-1)!.doc as { tracks: { kind: string; items: { id: string; out?: number }[] }[] };
  expect(d1.tracks[0].items.find((x) => x.id === "a")!.out).toBe(1);
  await page.getByRole("button", { name: /Texto RÁFAGA/ }).click();
  await page.getByLabel("Texto", { exact: true }).fill("Nuevo título");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.getByLabel("Texto", { exact: true })).toHaveValue("RÁFAGA");
  await page.getByLabel("Nombre del proyecto").fill("Mi montaje"); await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();
  expect(saved.at(-1)!.name).toBe("Mi montaje");
  await page.reload(); await expect(page.getByLabel("Nombre del proyecto")).toHaveValue("Mi montaje");
  await page.getByRole("button", { name: /Plano a, de 0\.0/ }).click(); await expect(page.getByLabel("Recorte: hasta")).toHaveValue("1");
  expect(bad.filter((b) => !/media|decode/i.test(b))).toEqual([]);
});

test("Seleccionar un elemento muestra sus ajustes y la línea de tiempo sigue utilizable con los paneles (V3-AV-12)", async ({ page }) => {
  await setup(page, []); await page.goto(`/app/avanzado/${PID}`);
  await expect(page.getByText("Elige un elemento de la línea de tiempo")).toBeVisible();
  await page.getByRole("button", { name: /Plano b, de 1\.5/ }).click();
  for (const l of ["Volumen", "Encuadre", "Recorte: desde"]) await expect(page.getByLabel(l, { exact: false }).first()).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowRight");   // cursor en 2 s, dentro del plano b
  await page.getByRole("button", { name: "Dividir" }).click();
  await expect(page.getByRole("button", { name: /Plano b, de/ })).toHaveCount(2);
  const tl = page.getByRole("region", { name: "Línea de tiempo" }); await expect(tl).toBeVisible();
  expect((await tl.boundingBox())!.height).toBeGreaterThan(120);
});

test("Exportar en el navegador: el archivo descargado respeta orden de planos, duración, audio y texto (V3-AV-15)", async ({ page }) => {
  test.setTimeout(90_000);
  await setup(page, []); const bad = watchErrors(page);
  await page.goto(`/app/avanzado/${PID}`); await expect(page.getByRole("button", { name: "Exportar" }).first()).toBeEnabled();
  await page.getByRole("button", { name: "Exportar" }).first().click();
  await page.getByLabel("Calidad").selectOption({ label: "Rápida (1/2)" });
  const dl = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("dialog").getByRole("button", { name: "Exportar" }).click();
  const d = await dl, out = file("salida." + d.suggestedFilename().split(".").pop()); await d.saveAs(out);
  expect(d.suggestedFilename()).toMatch(/^Montaje de prueba\.(mp4|webm)$/);
  const probe = JSON.parse(spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", out], { encoding: "utf8" }).stdout);
  const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video"), a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  expect(v, "vídeo").toBeTruthy(); expect(a, "audio").toBeTruthy(); expect(v.width / v.height).toBeCloseTo(9 / 16, 1);
  const dur = Number(probe.format.duration); expect(dur).toBeGreaterThan(2.4); expect(dur).toBeLessThan(4.2);
  const px = (t: number, x: number, y: number) => [...spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", out, "-frames:v", "1", "-vf", `crop=2:2:${x}:${y}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]).stdout].slice(0, 3);
  const [r, g, b] = px(0.5, 10, 10), [r2, g2, b2] = px(2.4, 10, 10);
  expect(r > 120 && g < 90 && b < 90, `primer plano rojo, no ${[r, g, b]}`).toBe(true);
  expect(b2 > 120 && r2 < 90, `segundo plano azul, no ${[r2, g2, b2]}`).toBe(true);
  const mid = px(1, Math.round(v.width / 2) - 20, Math.round(v.height / 2));
  expect(mid.some((c) => c > 200), "el texto blanco se ve en el centro").toBe(true);
  const vol = Number(/mean_volume: (-?[\d.]+)/.exec(spawnSync("ffmpeg", ["-v", "info", "-i", out, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr)?.[1] ?? -99);
  expect(vol, "hay audio").toBeGreaterThan(-45);
  expect(bad.filter((x) => !/decode|media/i.test(x))).toEqual([]);
  writeFileSync(join(dir, "ok.txt"), `${out}\n`);
});
