// Biblioteca única: tipos, filtros y detección de duplicados (pura, sin red).
export type AssetKind = "video" | "image" | "audio" | "logo" | "font" | "export";
export interface Asset {
  asset_key: string; kind: AssetKind; name: string; bucket: string; storage_path: string; bytes: number | null;
  fingerprint: string | null; fingerprint_kind: "sha256" | "etag" | null; container: string | null;
  ref_table: string; ref_id: string; created_at: string;
}
export const KIND_LABEL: Record<AssetKind, string> = { video: "Vídeos", image: "Imágenes", audio: "Audio", logo: "Logos", font: "Fuentes", export: "Exportaciones" };
export const KIND_ORDER: AssetKind[] = ["video", "image", "audio", "logo", "font", "export"];

/** Nombre comparable: sin extensión, sin « (1)», «copia», «copy», separadores ni mayúsculas. */
export function normalizeName(n: string): string {
  return n.toLowerCase().replace(/\.[a-z0-9]{2,5}$/, "").replace(/\s*\(\d+\)\s*$/, "").replace(/[\s._-]*(copia|copy|final|v\d+)\s*$/g, "").replace(/[^a-z0-9áéíóúüñ]+/g, " ").trim();
}

export interface DupGroup {
  id: string; confidence: "exact" | "possible"; assets: Asset[]; keep: Asset;
  /** Solo se ofrece quitar copias de archivos sueltos de packs: borrar una canción arrastra sus vídeos y una fuente puede estar en uso. */
  removable: Asset[]; note: string;
}
const DERIVED: AssetKind[] = ["export"];   // lo generado se puede rehacer: no cuenta como duplicado
const oldestFirst = (a: Asset, b: Asset) => a.created_at.localeCompare(b.created_at) || a.asset_key.localeCompare(b.asset_key);

export function findDuplicates(all: Asset[]): DupGroup[] {
  const src = all.filter((a) => !DERIVED.includes(a.kind));
  const groups: DupGroup[] = [];
  const used = new Set<string>();
  // 1) Exactos: misma huella de contenido y mismo tamaño (si se conoce)
  const byFp = new Map<string, Asset[]>();
  for (const a of src) if (a.fingerprint) { const k = `${a.fingerprint_kind}:${a.fingerprint}`; byFp.set(k, [...(byFp.get(k) ?? []), a]); }
  for (const [k, list] of byFp) {
    const sized = new Map<string, Asset[]>();
    for (const a of list) sized.set(String(a.bytes ?? "?"), [...(sized.get(String(a.bytes ?? "?")) ?? []), a]);
    for (const l of sized.values()) {
      // la misma ruta de storage referida dos veces no es una copia (p. ej. un logo y su fuente)
      const uniq = [...new Map(l.map((a) => [a.bucket + "/" + a.storage_path, a])).values()];
      if (uniq.length < 2) continue;
      uniq.sort(oldestFirst); uniq.forEach((a) => used.add(a.asset_key));
      groups.push(mk(`exact:${k}:${uniq[0].bytes ?? "?"}`, "exact", uniq));
    }
  }
  // 2) Posibles: mismo tipo, mismo nombre normalizado y mismo tamaño, sin huella que los confirme
  const byName = new Map<string, Asset[]>();
  for (const a of src) if (!used.has(a.asset_key) && a.bytes) { const k = `${a.kind}|${normalizeName(a.name)}|${a.bytes}`; if (normalizeName(a.name)) byName.set(k, [...(byName.get(k) ?? []), a]); }
  for (const [k, l] of byName) {
    const uniq = [...new Map(l.map((a) => [a.bucket + "/" + a.storage_path, a])).values()];
    if (uniq.length < 2) continue;
    // si todos tienen huella y es distinta, son archivos distintos
    if (uniq.every((a) => a.fingerprint) && new Set(uniq.map((a) => a.fingerprint)).size === uniq.length) continue;
    uniq.sort(oldestFirst); groups.push(mk(`possible:${k}`, "possible", uniq));
  }
  return groups.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "exact" ? -1 : 1) || b.assets.length - a.assets.length);
}
function mk(id: string, confidence: "exact" | "possible", assets: Asset[]): DupGroup {
  const keep = assets[0];
  const removable = confidence === "exact" ? assets.slice(1).filter((a) => a.ref_table === "media_items") : [];
  const others = assets.slice(1).filter((a) => a.ref_table !== "media_items").length;
  const note = confidence === "possible" ? "Mismo nombre y tamaño, pero no se puede confirmar que el contenido sea idéntico." : others ? "Hay copias que no se pueden quitar desde aquí (canciones, fuentes, logos o fuentes de proyecto): ábrelas en su sección." : "";
  return { id, confidence, assets, keep, removable, note };
}

/** Aviso previo a subir: ya existe algo con el mismo nombre y tamaño. */
export function findExisting(file: { name: string; size: number }, all: Asset[]): Asset[] {
  const n = normalizeName(file.name);
  return all.filter((a) => a.kind !== "export" && a.bytes === file.size && normalizeName(a.name) === n);
}

export function filterAssets(all: Asset[], o: { kind: AssetKind | "all"; q: string; dupKeys?: Set<string> | null }): Asset[] {
  const q = o.q.trim().toLowerCase();
  return all.filter((a) => (o.kind === "all" || a.kind === o.kind) && (!q || a.name.toLowerCase().includes(q) || (a.container ?? "").toLowerCase().includes(q)) && (!o.dupKeys || o.dupKeys.has(a.asset_key)));
}
export function countByKind(all: Asset[]): Record<AssetKind | "all", number> {
  const c = { all: all.length, video: 0, image: 0, audio: 0, logo: 0, font: 0, export: 0 } as Record<AssetKind | "all", number>;
  for (const a of all) c[a.kind]++;
  return c;
}

/** Dónde se gestiona cada tipo de archivo (la biblioteca única no duplica los editores). */
export function assetHref(a: Pick<Asset, "ref_table" | "ref_id" | "kind">): string {
  switch (a.ref_table) {
    case "songs": return `/app/lyric-studio?song=${a.ref_id}`;
    case "media_items": return "/app/biblioteca?tab=collections";
    case "workspace_fonts": case "brand_kits": return "/app/brand-kits";
    case "lyric_videos": return "/app/biblioteca?tab=lyrics";
    default: return "/app/biblioteca?tab=videos";
  }
}
export const fmtBytes = (n: number | null) => (n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
