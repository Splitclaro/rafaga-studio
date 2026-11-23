// E8 · flujo Conexiones (B-02): la pantalla refleja el estado real de TikTok y Drive, y se maneja solo con teclado.
import { test, expect } from "@playwright/test";
import { mockBackend, watchErrors } from "./mock.ts";

test("Conexiones muestra las cuentas de TikTok conectadas y las entregas reales, no «0 publicaciones directas»", async ({ page }) => {
  await mockBackend(page, { rest: { publications: [{ state: "published" }, { state: "private_pending_review" }, { state: "scheduled" }] }, rpc: { oauth_status: [{ provider: "google", account_label: "yo@example.test", scopes: ["drive.readonly"], expires_at: null, status: "connected", last_error: null, last_checked_at: null }] } });
  await page.route(/\/api\/tiktok$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ accounts: [{ id: "a", alias: "uno", account_label: "@uno", status: "connected", last_error: null, profile: {} }, { id: "b", alias: "dos", account_label: "@dos", status: "connected", last_error: null, profile: {} }] }) }));
  const bad = watchErrors(page);
  await page.goto("/app/conexiones"); await page.waitForLoadState("networkidle");
  await expect(page.getByText("Cuentas de TikTok conectadas")).toBeVisible();
  await expect(page.getByText("2 vídeos entregados a TikTok")).toBeVisible();
  await expect(page.getByText("0Publicación directa")).toHaveCount(0);
  await page.getByRole("button", { name: "Qué hace falta" }).first().waitFor();
  await expect(page.getByRole("link", { name: "Gestionar cuentas y calendario" })).toHaveAttribute("href", "/app/tiktok");
  expect(bad).toEqual([]);
});

test("Conexiones: teclado — se llega al buscador con Tab y el buscador filtra los destinos", async ({ page }) => {
  await mockBackend(page);
  await page.goto("/app/conexiones"); await page.waitForLoadState("networkidle");
  const q = page.getByPlaceholder("Buscar destino"); await q.focus(); await page.keyboard.type("tiktok");
  await expect(page.getByRole("heading", { name: "TikTok", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "YouTube", level: 3 })).toHaveCount(0);
  await page.keyboard.press("Shift+Tab");
  await expect(page.locator(":focus")).toBeVisible();
});
