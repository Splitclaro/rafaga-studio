// Catálogo de fuentes del contenido generado (subtítulos, letras, ganchos): descarga las familias de Google Fonts, comprueba
// formato/familia/licencia, lee métricas y cobertura del español y escribe packages/composition/src/fontcatalog.ts.
//   node scripts/fetch-fonts.ts --write   (con red)  descarga a apps/web/public/fonts/caption/ y regenera el catálogo
//   node scripts/fetch-fonts.ts --check   (sin red)  comprueba que cada archivo existe, su sha256 y sus métricas coinciden
// Salidas: 0 bien · 1 discrepancia · 64 uso · 69 sin fuentes (la API CSS y el camino alterno de google/fonts fallaron).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMetrics, METRIC_CODEPOINTS } from "../packages/lyrics/src/ttf.ts";
import { SANS_REGULAR, SANS_BOLD } from "../packages/lyrics/src/metrics.ts";
import { fontFamily, sniffFont } from "../packages/composition/src/fonts.ts";

const ROOT = new URL("../", import.meta.url).pathname, DIR = join(ROOT, "apps/web/public/fonts/caption"), OUT = join(ROOT, "packages/composition/src/fontcatalog.ts");
const SPANISH = [..."áéíóúüñÁÉÍÓÚÜÑ¿¡"].map((c) => c.codePointAt(0)!);
const FAMILIES: { family: string; weights: number[] }[] = [
  ...["Inter", "Roboto", "Playfair Display", "Oswald", "Montserrat", "Raleway", "Nunito", "Space Mono", "Dancing Script"].map((family) => ({ family, weights: [400, 700] })),
  ...["Pacifico", "Bebas Neue", "Righteous", "Anton", "Lobster", "Abril Fatface"].map((family) => ({ family, weights: [400] })),
];
const slug = (f: string) => f.replace(/\s+/g, "");
const dirOf = (f: string) => f.toLowerCase().replace(/\s+/g, "");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const mode = process.argv[2];
if (mode !== "--write" && mode !== "--check") { console.error("Uso: node scripts/fetch-fonts.ts --write | --check"); process.exit(64); }

interface Entry { family: string; weight: number; file: string | null; sha256: string | null; bytes: number; licence: string; licenceUrl: string | null; source: "google-fonts" | "sistema"; spanish: boolean; missing: number[]; unitsPerEm: number; ascent: number; descent: number; advance: Record<number, number>; fallback: number }

function vertical(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint16(4), t: Record<string, number> = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; t[String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])] = dv.getUint32(o + 8); }
  return { ascent: dv.getInt16(t.hhea + 4), descent: dv.getInt16(t.hhea + 6) };
}
const measure = (b: Uint8Array) => { const m = readMetrics(b, METRIC_CODEPOINTS); return { ...m, ...vertical(b), missing: SPANISH.filter((c) => !(c in m.advance)) }; };

async function get(url: string, ua?: string): Promise<Response | null> { try { const r = await fetch(url, { headers: ua ? { "user-agent": ua } : {} }); return r.ok ? r : null; } catch { return null; } }
async function ttfUrl(family: string, weight: number): Promise<string | null> {
  const css = await get(`https://fonts.googleapis.com/css2?family=${family.replace(/\s+/g, "+")}:wght@${weight}`, "Mozilla/4.0");   // UA antiguo: sin WOFF2, con URLs .ttf estáticas
  const m = css ? /url\((https:\/\/[^)]+\.ttf)\)/.exec(await css.text()) : null;
  if (m) return m[1];
  for (const lic of ["ofl", "apache"]) {                                                                                         // camino alterno: archivos estáticos del repositorio google/fonts
    const u = `https://raw.githubusercontent.com/google/fonts/main/${lic}/${dirOf(family)}/${slug(family)}-${weight === 700 ? "Bold" : "Regular"}.ttf`;
    if (await get(u)) return u;
  }
  return null;
}
async function licence(family: string): Promise<{ licence: string; licenceUrl: string } | null> {
  for (const [lic, file, id] of [["ofl", "OFL.txt", "OFL-1.1"], ["apache", "LICENSE.txt", "Apache-2.0"]] as const) {
    const u = `https://raw.githubusercontent.com/google/fonts/main/${lic}/${dirOf(family)}/${file}`;
    if (await get(u)) return { licence: id, licenceUrl: u };
  }
  return null;
}

function emit(entries: Entry[]) {
  const src = `// GENERADO por scripts/fetch-fonts.ts --write. No editar a mano: se regenera y \`--check\` lo verifica.
// Fuentes del contenido generado (subtítulos, letras, ganchos). Cada archivo vive en apps/web/public/fonts/caption/ (el navegador y el worker leen el mismo).
export interface CaptionFont {
  family: string; weight: number; file: string | null; sha256: string | null; bytes: number;
  licence: string; licenceUrl: string | null; source: "google-fonts" | "sistema";
  /** Cubre á é í ó ú ü ñ Á É Í Ó Ú Ü Ñ ¿ ¡ */ spanish: boolean; missing: number[];
  unitsPerEm: number; ascent: number; descent: number; advance: Record<number, number>; fallback: number;
}
export const FALLBACK_FAMILY = "Inter";
export const SPANISH_CODEPOINTS = ${JSON.stringify(SPANISH)};
export const CAPTION_FONTS: CaptionFont[] = ${JSON.stringify(entries)};

const byFamily = (family: string) => CAPTION_FONTS.filter((f) => f.family.toLowerCase() === family.toLowerCase());
/** La entrada de esa familia con el peso más cercano; si no existe la familia, Inter. */
export function fontFor(family: string, weight = 400): CaptionFont {
  const c = byFamily(family), pool = c.length ? c : byFamily(FALLBACK_FAMILY);
  return pool.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
}
/** ¿Tiene la fuente todos los glifos del texto? Un carácter fuera de la tabla de métricas cuenta como no cubierto. Las fuentes de sistema (sin tabla) se dan por buenas. */
export function coversText(font: CaptionFont, text: string): boolean {
  if (font.source === "sistema" && !Object.keys(font.advance).length) return true;
  for (const ch of text) { const cp = ch.codePointAt(0)!; if (cp < 32 || cp === 0x7f || (cp >= 0x80 && cp < 0xa0)) continue; if (!(cp in font.advance)) return false; }
  return true;
}
/** Familia que se usará para ese texto: la pedida, o Inter si le falta algún glifo. */
export function resolveFamilyForText(family: string, weight: number, text: string): string {
  const f = fontFor(family, weight);
  return f.family.toLowerCase() === family.toLowerCase() && coversText(f, text) ? f.family : FALLBACK_FAMILY;
}
/** Ancho en píxeles de \`text\` con esa fuente, peso y cuerpo (em en px). Determinista; los glifos que faltan miden como el de respaldo de la fuente. */
export function measureText(text: string, family: string, weight: number, emPx: number): number {
  let f = fontFor(family, weight); if (!Object.keys(f.advance).length) f = fontFor(FALLBACK_FAMILY, weight);
  let w = 0; for (const ch of text) w += f.advance[ch.codePointAt(0)!] ?? f.fallback;
  return (w / f.unitsPerEm) * emPx;
}
`;
  writeFileSync(OUT, src);
}

function systemEntries(): Entry[] {
  const mk = (family: string, weight: number, m: typeof SANS_REGULAR, licence: string, licenceUrl: string | null): Entry => {
    const miss = SPANISH.filter((c) => !(c in m.advance));
    return { family, weight, file: null, sha256: null, bytes: 0, licence, licenceUrl, source: "sistema", spanish: miss.length === 0, missing: miss, unitsPerEm: m.unitsPerEm, ascent: Math.round(m.unitsPerEm * 0.905), descent: -Math.round(m.unitsPerEm * 0.212), advance: m.advance, fallback: m.fallback };
  };
  return [mk("Liberation Sans", 400, SANS_REGULAR, "OFL-1.1", "https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE"), mk("Liberation Sans", 700, SANS_BOLD, "OFL-1.1", "https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE"),
    { family: "Bootzy TM", weight: 700, file: null, sha256: null, bytes: 0, licence: "propia", licenceUrl: null, source: "sistema", spanish: true, missing: [], unitsPerEm: 1000, ascent: 900, descent: -200, advance: {}, fallback: 600 }];
}

if (mode === "--write") {
  mkdirSync(DIR, { recursive: true });
  const entries: Entry[] = [];
  for (const { family, weights } of FAMILIES) {
    const lic = await licence(family);
    if (!lic) { console.error(`Sin licencia para ${family}: no se puede incluir.`); process.exit(69); }
    for (const weight of weights) {
      const url = await ttfUrl(family, weight);
      if (!url) { console.error(`No se pudo obtener ${family} ${weight} (API CSS y google/fonts fallaron).`); process.exit(69); }
      const r = await get(url); if (!r) { console.error(`Descarga fallida: ${url}`); process.exit(69); }
      const buf = new Uint8Array(await r.arrayBuffer());
      if (sniffFont(buf) !== "ttf") { console.error(`${family} ${weight}: no es TTF`); process.exit(1); }
      const fam = fontFamily(buf); if (!fam || !fam.toLowerCase().startsWith(family.toLowerCase().split(" ")[0])) { console.error(`${family} ${weight}: la familia interna es «${fam}»`); process.exit(1); }
      const file = `${slug(family)}-${weight}.ttf`; writeFileSync(join(DIR, file), buf);
      const m = measure(buf);
      entries.push({ family, weight, file, sha256: sha(buf), bytes: buf.length, licence: lic.licence, licenceUrl: lic.licenceUrl, source: "google-fonts", spanish: m.missing.length === 0, missing: m.missing, unitsPerEm: m.unitsPerEm, ascent: m.ascent, descent: m.descent, advance: m.advance, fallback: m.fallback });
      console.log(`✔ ${family} ${weight} · ${(buf.length / 1024).toFixed(0)} KB · ${lic.licence}${m.missing.length ? ` · faltan ${m.missing.length} glifos del español` : ""}`);
    }
  }
  emit([...entries, ...systemEntries()]);
  console.log(`Catálogo escrito: ${entries.length} archivos.`); process.exit(0);
}

// --check
const { CAPTION_FONTS } = await import("../packages/composition/src/fontcatalog.ts");
let bad = 0; const fail = (m: string) => { console.error(`✖ ${m}`); bad++; };
for (const f of CAPTION_FONTS) {
  if (!f.file) continue;
  const p = join(DIR, f.file); if (!existsSync(p)) { fail(`falta ${f.file}`); continue; }
  const b = new Uint8Array(readFileSync(p));
  if (sha(b) !== f.sha256) fail(`${f.file}: sha256 distinto`);
  const m = measure(b);
  if (JSON.stringify(m.advance) !== JSON.stringify(f.advance) || m.unitsPerEm !== f.unitsPerEm || m.fallback !== f.fallback) fail(`${f.file}: los anchos de avance no coinciden con readMetrics`);
}
console.log(bad ? `${bad} discrepancias` : `OK: ${CAPTION_FONTS.filter((f) => f.file).length} archivos comprobados`);
process.exit(bad ? 1 : 0);
