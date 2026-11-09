/** Conversión hora local de una zona IANA ↔ UTC con cambio de hora (DST). Sin dependencias. */
function offsetMinutes(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(utcMs / 1000) * 1000) / 60000;
}
export interface Zoned { utc: Date; exists: boolean; ambiguous: boolean }

/** `local` = "YYYY-MM-DDTHH:mm". Si la hora no existe (salto de primavera) se adelanta; si se repite (otoño) se usa la primera. */
export function zonedToUtc(local: string, tz: string): Zoned {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if (!m) throw new Error("Fecha no válida");
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const cands = new Set<number>();
  for (const off of [offsetMinutes(naive - 86400000, tz), offsetMinutes(naive + 86400000, tz)]) {
    const t = naive - off * 60000;
    if (offsetMinutes(t, tz) === off) cands.add(t);          // candidato consistente con su propio desplazamiento
  }
  const list = [...cands].sort((a, b) => a - b);
  if (list.length === 0) { const off = offsetMinutes(naive - 86400000, tz); return { utc: new Date(naive - off * 60000), exists: false, ambiguous: false }; }
  return { utc: new Date(list[0]), exists: true, ambiguous: list.length > 1 };
}
/** UTC → "YYYY-MM-DDTHH:mm" en la zona dada. */
export function utcToLocalInput(utc: Date | string, tz: string): string {
  const t = new Date(utc).getTime(); const o = offsetMinutes(t, tz);
  return new Date(t + o * 60000).toISOString().slice(0, 16);
}
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export const ZONES = ["Europe/Madrid", "Atlantic/Canary", "Europe/London", "Europe/Paris", "Europe/Berlin", "UTC", "America/Mexico_City", "America/Bogota", "America/Lima", "America/Santiago", "America/Argentina/Buenos_Aires", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Tokyo", "Asia/Dubai", "Australia/Sydney"];
