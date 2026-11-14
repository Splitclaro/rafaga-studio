// Ejecuta una tarea después de enviar la respuesta sin que Vercel la corte (usa `after` de Next); fuera de una petición (pruebas) la lanza sin esperar.
import { after } from "next/server.js";

export function runAfter(task: () => Promise<unknown>): void {
  const safe = () => task().catch(() => {});
  try { after(safe); } catch { void safe(); }
}
