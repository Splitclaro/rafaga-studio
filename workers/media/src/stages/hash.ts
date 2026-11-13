// Huella de entrada de una etapa: sha256 de JSON canónico (claves ordenadas) de entradas + versiones de componentes.
import { createHash } from "node:crypto";

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}
export function inputHash(inputs: unknown, componentVersions: Record<string, string>): string {
  return createHash("sha256").update(canonical({ inputs, componentVersions })).digest("hex");
}
