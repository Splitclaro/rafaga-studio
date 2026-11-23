// V3: Inicio y navegación ofrecen exactamente las tres herramientas, cada una abre su pantalla y los proyectos existentes se pueden abrir.
import { test, expect } from "@playwright/test";
import { mockBackend, watchErrors } from "./mock.ts";

const PROJ = { id: "11111111-1111-4111-8111-111111111111", name: "Podcast de prueba", created_at: "2026-11-20T10:00:00Z", status: "done", clips: 3, archived_at: null, mode: "clips", project_brief: null };

test("Inicio muestra las tres herramientas y la navegación principal solo esas tres (más Inicio)", async ({ page }) => {
  await mockBackend(page);
  const bad = watchErrors(page);
  await page.goto("/app"); await page.waitForLoadState("networkidle");
  const tools = page.getByRole("list", { name: "Herramientas" }).getByRole("heading", { level: 2 });
  await expect(tools).toHaveText(["Editor de vídeos", "Editor de vídeo avanzado", "Autoclip"]);
  const nav = page.getByRole("navigation", { name: "Principal" });
  for (const l of ["Editor de vídeos", "Editor avanzado", "Autoclip"]) await expect(nav.getByRole("link", { name: l, exact: true })).toBeVisible();
  for (const gone of ["Style Studio", "Calendario", "TikTok", "Director IA"]) await expect(nav.getByRole("link", { name: gone, exact: true })).toHaveCount(0);
  expect(bad).toEqual([]);
});

for (const [label, path, heading] of [["Crear un vídeo con letra", "/app/editor", null], ["Abrir el editor", "/app/avanzado", "Editor de vídeo avanzado"], ["Analizar un vídeo largo", "/app/autoclip", "Autoclip"]] as const) {
  test(`«${label}» abre ${path}`, async ({ page }) => {
    await mockBackend(page);
    const bad = watchErrors(page);
    await page.goto("/app"); await page.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    if (heading) await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    expect(bad).toEqual([]);
  });
}

test("Autoclip lista los proyectos existentes y abre cada uno en su pantalla de resultados", async ({ page }) => {
  await mockBackend(page, { rpc: { list_projects: [PROJ], projects_overview: [PROJ] }, rest: { projects: [PROJ] } });
  await page.goto("/app/autoclip"); await page.waitForLoadState("networkidle");
  const link = page.locator(`a[href="/app/autoclip/${PROJ.id}"]`).first();
  await expect(link).toBeVisible();
});

test("Editor avanzado lista los clips existentes y los abre en el editor", async ({ page }) => {
  await mockBackend(page, { rest: { clips: [{ id: "22222222-2222-4222-8222-222222222222", title: "Momento clave", created_at: "2026-11-21T10:00:00Z", technical_state: "disponible", project_id: PROJ.id }] } });
  await page.goto("/app/avanzado"); await page.waitForLoadState("networkidle");
  await expect(page.getByRole("link", { name: /Momento clave/ })).toHaveAttribute("href", "/app/c/22222222-2222-4222-8222-222222222222");
});
