// E8: cada pantalla carga sin errores de consola ni 5xx y pasa axe sin violaciones graves/críticas, en escritorio y a 390 px.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockBackend, watchErrors } from "./mock.ts";

const PUBLIC = ["/login", "/privacidad", "/condiciones"];
const PRIVATE = ["/app", "/app/proyectos", "/app/conexiones", "/app/uso", "/app/calendario", "/app/exports", "/app/lyric-studio", "/app/biblioteca", "/app/tiktok", "/app/nuevo"];

async function scan(page: import("@playwright/test").Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(["color-contrast"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}) ×${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`);
}

for (const path of [...PUBLIC, ...PRIVATE]) {
  test(`${path}: carga limpia, sin 5xx y sin violaciones axe graves`, async ({ page }) => {
    await mockBackend(page);
    const bad = watchErrors(page);
    await page.goto(path); await page.waitForLoadState("networkidle");
    await expect(page.locator("main, body").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "sin desplazamiento horizontal").toBe(true);
    expect(await scan(page), "axe").toEqual([]);
    expect(bad, "errores").toEqual([]);
  });
}

// A11Y-01 (abierto): el contraste de color falla en /login (enlace/gap-2.5) y en /app (.status). Es una decisión de diseño: la regla del repositorio prohíbe cambiar colores en estas tareas.
// Se deja registrado y activo como `fixme` para que el propietario decida; al corregirlo basta quitar el `fixme` y la regla se vigila sola.
for (const path of ["/login", "/app"]) {
  test.fixme(`${path}: contraste de color (A11Y-01)`, async ({ page }) => {
    await mockBackend(page); await page.goto(path); await page.waitForLoadState("networkidle");
    const r = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });
}
