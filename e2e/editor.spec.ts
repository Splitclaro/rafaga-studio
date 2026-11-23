// V3 · Editor de vídeos: Audio → Letras → Estilo → Render con backend simulado. Comprueba guardado, reanudación tras recargar y el envío del render.
import { test, expect, type Page } from "@playwright/test";
import { mockBackend, watchErrors } from "./mock.ts";

const SONG = { id: "33333333-3333-4333-8333-333333333333", title: "Contando días", status: "ready", duration_ms: 146000, lyrics_text: null };
const WORDS = [{ text: "estoy", start: 12.2, end: 12.6, line: 0, manual: false }, { text: "contando", start: 12.7, end: 13.3, line: 0, manual: false }, { text: "días", start: 13.4, end: 14, line: 0, manual: false }];
const PID = "44444444-4444-4444-8444-444444444444";

async function setup(page: Page, saved: Record<string, unknown>[] = []) {
  let draft: Record<string, unknown> = { project_id: PID, song_id: SONG.id, mode: "letra", range_start_ms: 0, range_end_ms: null, aspect: "9:16", res: 1080, style: null, preset: null, background: {}, settings: {}, hook: null, message: null, cover: null, collection_ids: [], updated_at: "2026-11-23T10:00:00Z" };
  await mockBackend(page, { extra: async (route, url) => {
    if (url.pathname.endsWith("/rest/v1/songs")) { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(route.request().headers()["accept"]?.includes("vnd.pgrst.object") ? SONG : [SONG]) }); return true; }
    if (url.pathname.endsWith("/rest/v1/lyric_projects")) { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([draft]) }); return true; }
    return false;
  } });
  await page.route(/\/api\/lyrics\/songs\/[^/]+\/alignment/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ words: WORDS, revision: 1 }) }));
  await page.route(/\/api\/lyrics\/songs\/[^/]+\/audio/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" }) }));
  await page.route(/\/api\/lyrics\/projects\/[^/]+$/, async (r) => { const b = JSON.parse(r.request().postData() ?? "{}"); saved.push(b); draft = { ...draft, ...b }; await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ saved_at: new Date().toISOString() }) }); });
  await page.route(/\/api\/lyrics\/projects\/[^/]+\/variants/, (r) => r.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ generation_id: "g", export_ids: ["e1"], batch_id: null, job_id: "j", warnings: [] }) }));
}

test("Audio: el tramo se edita en m:ss.d, se guarda solo y sigue igual tras recargar (V3-ED-10/11)", async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await setup(page, saved); const bad = watchErrors(page);
  await page.goto(`/app/editor/${SONG.id}?paso=audio`);
  const start = page.getByLabel("Inicio del tramo"); await expect(start).toHaveValue("0:11.0");
  await start.fill("0:10.0"); await start.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Guardado" })).toBeVisible();
  expect(saved.at(-1)).toMatchObject({ range_start_ms: 10000, range_end_ms: 41000 });
  await page.reload(); await expect(page.getByLabel("Inicio del tramo")).toHaveValue("0:10.0");
  await expect(page.getByLabel("Fin del tramo")).toHaveValue("0:41.0");
  expect(bad.filter((b) => !b.includes("media"))).toEqual([]);
});

test("Pasos: Audio → Letras → Estilo → Render; el render envía un vídeo por fondo (uno sin fondo) (V3-ED-18/52)", async ({ page }) => {
  await setup(page);
  let sent: { variants: unknown[] } | null = null;
  await page.route(/\/api\/lyrics\/projects\/[^/]+\/variants/, async (r) => { sent = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ generation_id: "g", export_ids: ["e1"], batch_id: null, job_id: "j", warnings: [] }) }); });
  await page.goto(`/app/editor/${SONG.id}`);
  await page.getByRole("button", { name: "Continuar a letras" }).click();
  await expect(page).toHaveURL(/paso=letras/); await expect(page.getByRole("heading", { name: "Corrige la letra y su sincronía" })).toBeVisible();
  await page.getByRole("button", { name: "Continuar a estilo" }).click();
  await expect(page).toHaveURL(/paso=estilo/);
  await page.getByLabel("Llamada a la acción final").fill("Escúchala ya");
  await page.getByRole("button", { name: "Continuar a render" }).click();
  await expect(page).toHaveURL(/paso=render/);
  await page.getByRole("button", { name: "Crear vídeo" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Renderizando 1 vídeo" })).toBeVisible();
  expect(sent!.variants).toHaveLength(1);
  expect((sent!.variants[0] as { message: { text: string } }).message.text).toBe("Escúchala ya");
});

test("Vídeos creados: pestañas de borradores, renderizados y en progreso; la subida dice formatos y 50 MB", async ({ page }) => {
  await mockBackend(page, { rest: { lyric_projects: [{ project_id: PID, song_id: SONG.id, updated_at: "2026-11-23T10:00:00Z", songs: { title: "Contando días", status: "ready" } }] } });
  await page.goto("/app/editor");
  await expect(page.getByText("hasta 50 MB", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /Contando días/ })).toHaveAttribute("href", `/app/editor/${SONG.id}`);
  for (const t of ["Borradores", "Vídeos renderizados", "En progreso"]) await expect(page.getByRole("tab", { name: new RegExp(t) })).toBeVisible();
});
