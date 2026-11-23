import { defineConfig, devices } from "@playwright/test";

// E8: guiones de extremo a extremo y accesibilidad contra el servidor local (`next start`) con el backend simulado (e2e/mock.ts): ninguna prueba toca la red.
const PORT = 3123;
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "off", launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } },
  projects: [
    { name: "escritorio", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "movil-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
  webServer: { command: `pnpm --filter @rafaga/web exec next start -p ${PORT} -H 127.0.0.1`, url: `http://127.0.0.1:${PORT}/login`, reuseExistingServer: true, timeout: 120_000 },
});
