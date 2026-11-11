"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fontFamily, sniffFont, sanitizeLogo, validateStyle, PRESETS, TEMPLATES, kitFromTemplate, templateById, type BrandLogo, type SubtitleStyle, type StyleTemplate } from "@rafaga/composition";
import { supabase } from "../../../lib/supabase";
import { useWorkspaceFonts } from "../../../lib/fonts";
import { useTextStyles } from "../../../lib/textStyles";
import LyricSample from "../../../components/LyricSample";
import { useProjects } from "../../../components/ProjectList";
import BrandTabs from "../../../components/BrandTabs";

type Bumper = { path: string; name: string; kind: "video" | "photo"; dur: number; hasAudio: boolean };
type Config = { template?: string; layout?: string; montage?: string; lyric?: { look: string | null; style: string | null }; logo?: Partial<BrandLogo>; intro?: Bumper | null; outro?: Bumper | null; export?: { ratios: string[]; res: 1080 | 720 }; broll_collection?: string | null; notes?: string };
type Kit = { id: string; name: string; logo_path: string | null; colors: Record<string, string>; subtitle_style: SubtitleStyle | null; config: Config; version: number; updated_at: string; archived_at: string | null };
type Ver = { version: number; created_at: string; snapshot: { name: string; logo_path: string | null; colors: Record<string, string>; subtitle_style: SubtitleStyle | null; config: Config } };
type App = { id: string; project_id: string; kit_version: number | null; style_changes: unknown[]; created_at: string; reverted_at: string | null };

const COLOR_KEYS: [string, string][] = [["primary", "Principal"], ["accent", "Acento"], ["text", "Texto"], ["background", "Fondo"]];
const MAX_IMG = 2 * 1024 * 1024, MAX_VID = 50 * 1024 * 1024;
const imgKind = async (f: File) => { const b = new Uint8Array(await f.slice(0, 12).arrayBuffer()); if (b[0] === 0x89 && b[1] === 0x50) return "png"; if (b[0] === 0xff && b[1] === 0xd8) return "jpg"; if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "webp"; return null; };
const sniffVideo = async (f: File) => { const b = new Uint8Array(await f.slice(0, 12).arrayBuffer()); return String.fromCharCode(...b.slice(4, 8)) === "ftyp" ? "mp4" : b[0] === 0x1a && b[1] === 0x45 ? "webm" : null; };
const probeVideo = (f: File) => new Promise<{ dur: number; hasAudio: boolean }>((res, rej) => { const v = document.createElement("video"); v.preload = "metadata"; v.src = URL.createObjectURL(f); v.onloadedmetadata = () => { const a = v as unknown as { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean; audioTracks?: { length: number } }; res({ dur: v.duration, hasAudio: a.audioTracks ? a.audioTracks.length > 0 : a.mozHasAudio ?? true }); URL.revokeObjectURL(v.src); }; v.onerror = () => rej(new Error("No se pudo leer el vídeo")); });

export default function BrandKits() {
  const { fonts, reload: reloadFonts } = useWorkspaceFonts();
  const { saved: myStyles } = useTextStyles();
  const { rows: projects, reload: reloadProjects } = useProjects();
  const [kits, setKits] = useState<Kit[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Kit | null>(null);
  const [versions, setVersions] = useState<Ver[]>([]);
  const [apps, setApps] = useState<App[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [applyStyle, setApplyStyle] = useState(true);
  const [clipCount, setClipCount] = useState<number | null>(null);
  const [tab, setTab] = useState<"kit" | "fonts">("kit");

  const ws = async () => (await supabase.from("workspaces").select("id").limit(1).single()).data?.id as string;
  const load = useCallback(async () => {
    const { data } = await supabase.from("brand_kits").select("id,name,logo_path,colors,subtitle_style,config,version,updated_at,archived_at").is("archived_at", null).order("created_at");
    const l = (data ?? []) as Kit[]; setKits(l); return l;
  }, []);
  useEffect(() => { load().then((l) => { if (l[0]) { setSel((s) => s ?? l[0].id); } }); }, [load]);
  const kit = kits?.find((k) => k.id === sel) ?? null;
  useEffect(() => { setDraft(kit ? structuredClone(kit) : null); }, [kit?.id, kit?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const sign = useCallback(async (paths: (string | null | undefined)[]) => {
    const need = paths.filter((p): p is string => !!p && !urls[p]);
    if (!need.length) return;
    const { data } = await supabase.storage.from("originals").createSignedUrls(need, 3600);
    setUrls((u) => ({ ...u, ...Object.fromEntries((data ?? []).flatMap((x) => (x.signedUrl && x.path ? [[x.path, x.signedUrl] as [string, string]] : []))) }));
  }, [urls]);
  useEffect(() => { if (draft) sign([draft.logo_path, draft.config.intro?.path, draft.config.outro?.path]); }, [draft?.logo_path, draft?.config.intro?.path, draft?.config.outro?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!kit) return; (async () => {
    const [{ data: v }, { data: a }] = await Promise.all([
      supabase.from("brand_kit_versions").select("version,created_at,snapshot").eq("kit_id", kit.id).order("version", { ascending: false }).limit(30),
      supabase.from("brand_applications").select("id,project_id,kit_version,style_changes,created_at,reverted_at").eq("kit_id", kit.id).order("created_at", { ascending: false }).limit(20),
    ]);
    setVersions((v ?? []) as Ver[]); setApps((a ?? []) as App[]);
  })(); }, [kit?.id, kit?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setClipCount(null); if (!target) return; supabase.from("clips").select("id", { count: "exact", head: true }).eq("project_id", target).eq("discarded", false).then(({ count }) => setClipCount(count ?? 0)); }, [target]);

  const dirty = !!kit && !!draft && JSON.stringify([kit.name, kit.logo_path, kit.colors, kit.subtitle_style, kit.config]) !== JSON.stringify([draft.name, draft.logo_path, draft.colors, draft.subtitle_style, draft.config]);
  const set = (p: Partial<Kit>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const setCfg = (p: Partial<Config>) => setDraft((d) => (d ? { ...d, config: { ...d.config, ...p } } : d));

  async function create(name = "Mi marca", from?: Kit) {
    const w = await ws();
    const { data, error } = await supabase.from("brand_kits").insert({ workspace_id: w, name, colors: from?.colors ?? { primary: "#111111", accent: "#FFFFFF", text: "#FFFFFF", background: "#000000" }, subtitle_style: from?.subtitle_style ?? null, config: from?.config ?? {}, logo_path: from?.logo_path ?? null }).select("id").single();
    if (error) return setMsg(error.message);
    const l = await load(); setSel(data.id); setMsg(from ? "Kit duplicado." : "Kit creado. Añade logo, colores y estilo."); return l;
  }
  async function createFromTemplate(t: StyleTemplate) {
    const k = kitFromTemplate(t); const w = await ws();
    const { data, error } = await supabase.from("brand_kits").insert({ workspace_id: w, name: k.name, colors: k.colors, subtitle_style: k.subtitle_style, config: k.config }).select("id").single();
    if (error) return setMsg(error.message);
    await load(); setSel(data.id); setMsg(`Kit creado desde «${t.name}». Ajusta logo, colores y estilo, y guarda.${t.note ? ` ${t.note}` : ""}`);
  }
  async function save() {
    if (!kit || !draft || busy) return; setBusy(true);
    const { error } = await supabase.from("brand_kits").update({ name: draft.name.trim() || kit.name, logo_path: draft.logo_path, colors: draft.colors, subtitle_style: draft.subtitle_style, config: draft.config }).eq("id", kit.id);
    setBusy(false); if (error) return setMsg(error.message);
    await load(); setMsg("Guardado como versión nueva. Los proyectos que ya usan este kit conservan la versión que tenían hasta que la actualices.");
  }
  async function archive() {
    if (!kit || !confirm(`¿Archivar «${kit.name}»? Los proyectos que lo usan mantienen la versión aplicada; no se borra nada.`)) return;
    const { error } = await supabase.from("brand_kits").update({ archived_at: new Date().toISOString() }).eq("id", kit.id);
    if (error) return setMsg(error.message); setSel(null); const l = await load(); if (l[0]) setSel(l[0].id);
  }
  async function restore(v: Ver) {
    if (!kit || !confirm(`Se creará una versión nueva con el contenido de la v${v.version}.`)) return;
    const s = v.snapshot;
    const { error } = await supabase.from("brand_kits").update({ name: s.name, logo_path: s.logo_path, colors: s.colors, subtitle_style: s.subtitle_style, config: s.config }).eq("id", kit.id);
    setMsg(error ? error.message : `Contenido de la v${v.version} restaurado como versión nueva.`); await load();
  }

  async function uploadLogo(f: File | undefined) {
    if (!f || !draft) return; setMsg(null);
    if (f.size > MAX_IMG) return setMsg("El logo supera 2 MB.");
    const k = await imgKind(f); if (!k) return setMsg("Solo PNG, JPG o WebP (se comprueba el contenido real del archivo).");
    setBusy(true);
    const path = `${await ws()}/brand/${crypto.randomUUID()}.${k}`;
    const up = await supabase.storage.from("originals").upload(path, f, { contentType: k === "jpg" ? "image/jpeg" : `image/${k}` });
    setBusy(false); if (up.error) return setMsg(up.error.message);
    set({ logo_path: path }); setMsg("Logo subido. Guarda para crear la versión.");
  }
  async function uploadBumper(which: "intro" | "outro", f: File | undefined) {
    if (!f || !draft) return; setMsg(null);
    const isImg = !!(await imgKind(f)), isVid = !isImg && !!(await sniffVideo(f));
    if (!isImg && !isVid) return setMsg("Intro/outro: MP4/WebM o una imagen PNG/JPG/WebP.");
    if (f.size > (isImg ? MAX_IMG : MAX_VID)) return setMsg(isImg ? "La imagen supera 2 MB." : "El vídeo supera 50 MB.");
    setBusy(true);
    try {
      let dur = 3, hasAudio = false;
      if (isVid) { const p = await probeVideo(f); dur = Math.min(15, Math.max(0.5, p.dur)); hasAudio = p.hasAudio; if (p.dur > 15) setMsg("El vídeo dura más de 15 s: se usarán los primeros 15 s."); }
      const ext = isImg ? (await imgKind(f))! : (await sniffVideo(f))!;
      const path = `${await ws()}/brand/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("originals").upload(path, f, { contentType: isImg ? `image/${ext === "jpg" ? "jpeg" : ext}` : `video/${ext}` });
      if (up.error) throw new Error(up.error.message);
      setCfg({ [which]: { path, name: f.name, kind: isImg ? "photo" : "video", dur: +dur.toFixed(2), hasAudio } as Bumper });
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error al subir."); } finally { setBusy(false); }
  }
  async function uploadFont(f: File | undefined) {
    if (!f || busy) return; setMsg(null);
    if (f.size > 5 * 1024 * 1024) return setMsg("La fuente supera 5 MB.");
    const bytes = new Uint8Array(await f.arrayBuffer()), kind = sniffFont(bytes);
    if (!kind) return setMsg("Solo se admiten fuentes TTF u OTF (las que puede usar el render de vídeo).");
    const family = fontFamily(bytes); if (!family) return setMsg("No se pudo leer el nombre de la familia de esta fuente.");
    if (fonts?.some((x) => x.family === family)) return setMsg(`«${family}» ya está en tu workspace.`);
    if (!confirm(`Confirmas que tienes licencia para usar «${family}» en vídeo y web?`)) return;
    setBusy(true);
    try {
      const { data: s } = await supabase.auth.getSession(); const w = await ws();
      const path = `${w}/fonts/${crypto.randomUUID()}.${kind}`;
      const up = await supabase.storage.from("brand-assets").upload(path, f, { contentType: kind === "otf" ? "font/otf" : "font/ttf" });
      if (up.error) throw new Error(up.error.message);
      const ins = await supabase.from("workspace_fonts").insert({ workspace_id: w, family, storage_path: path, bytes: f.size, created_by: s.session?.user.id });
      if (ins.error) { await supabase.storage.from("brand-assets").remove([path]); throw new Error(ins.error.message); }
      setMsg(`«${family}» añadida.`); await reloadFonts();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error al subir la fuente."); } finally { setBusy(false); }
  }
  async function removeFont(id: string, path: string, family: string) {
    const used = kits?.filter((k) => k.subtitle_style?.fontName === family).map((k) => k.name) ?? [];
    if (!confirm(`¿Borrar la fuente «${family}»?${used.length ? ` La usan los kits: ${used.join(", ")}; sus exports fallarán hasta elegir otra.` : ""} Los clips que la usen no podrán exportarse hasta elegir otra.`)) return;
    await supabase.from("workspace_fonts").delete().eq("id", id); await supabase.storage.from("brand-assets").remove([path]); await reloadFonts();
  }

  const styleOptions = useMemo(() => [...Object.entries(PRESETS).map(([k, s]) => ({ key: `base:${k}`, label: k, style: s })), ...(myStyles ?? []).map((m) => ({ key: `custom:${m.id}`, label: `${m.name} (mío)`, style: m.style }))], [myStyles]);
  const styleKey = draft?.subtitle_style ? styleOptions.find((o) => JSON.stringify(o.style) === JSON.stringify(draft.subtitle_style))?.key ?? "current" : "";

  async function apply(kitId: string | null) {
    if (!target || busy) return; setBusy(true); setMsg(null);
    try {
      const changes: { clip_id: string; from: number; to: number }[] = [];
      if (kitId && applyStyle && kit?.subtitle_style) {
        const { data: cs } = await supabase.from("clips").select("id,current_version,workspace_id").eq("project_id", target).eq("discarded", false);
        const { data: u } = await supabase.auth.getSession();
        for (const c of cs ?? []) {
          const { data: v } = await supabase.from("clip_versions").select("composition").eq("clip_id", c.id).eq("version", c.current_version).single();
          if (!v) continue;
          const to = c.current_version + 1;
          const comp = { ...(v.composition as object), style: validateStyle(kit.subtitle_style), preset: "brand" };
          const ins = await supabase.from("clip_versions").insert({ clip_id: c.id, workspace_id: c.workspace_id, version: to, composition: comp, created_by: u.session?.user.id });
          if (ins.error) throw new Error(ins.error.message);
          const up = await supabase.from("clips").update({ current_version: to }).eq("id", c.id).eq("current_version", c.current_version).select("id");
          if (up.error || !up.data?.length) throw new Error("Un clip cambió mientras se aplicaba la marca. Reintenta.");
          changes.push({ clip_id: c.id, from: c.current_version, to });
        }
      }
      const { error } = await supabase.rpc("apply_brand_kit", { p_project: target, p_kit: kitId, p_style_changes: changes });
      if (error) throw new Error(error.message);
      setMsg(kitId ? `Marca aplicada al proyecto (v${kit?.version})${changes.length ? ` y estilo de subtítulos a ${changes.length} clips` : ""}. Los exports nuevos incluirán logo e intro/outro; los ya hechos no cambian.` : "Marca retirada del proyecto.");
      await Promise.all([load(), reloadProjects()]);
      if (kit) { const { data: a } = await supabase.from("brand_applications").select("id,project_id,kit_version,style_changes,created_at,reverted_at").eq("kit_id", kit.id).order("created_at", { ascending: false }).limit(20); setApps((a ?? []) as App[]); }
    } catch (e) { setMsg(e instanceof Error ? e.message : "No se pudo aplicar."); } finally { setBusy(false); }
  }
  async function revert(a: App) {
    if (!confirm("¿Revertir esta aplicación? Se vuelve al kit anterior y a la versión previa de los clips que no hayas editado después.")) return;
    const { data, error } = await supabase.rpc("revert_brand_application", { p_id: a.id });
    setMsg(error ? error.message : `Revertido (${data} clips restaurados).`);
    if (!error) { const { data: l } = await supabase.from("brand_applications").select("id,project_id,kit_version,style_changes,created_at,reverted_at").eq("kit_id", kit!.id).order("created_at", { ascending: false }).limit(20); setApps((l ?? []) as App[]); reloadProjects(); }
  }

  const logo = sanitizeLogo(draft?.config.logo);
  const pos: Record<string, string> = { tl: "left-[4%] top-[4%]", tr: "right-[4%] top-[4%]", bl: "left-[4%] bottom-[4%]", br: "right-[4%] bottom-[4%]" };
  const targetProj = projects?.find((p) => p.id === target);

  return (
    <>
    <BrandTabs />
<main className="mx-auto max-w-6xl px-4 pb-20 pt-8 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-3xl">Brand kit</h1><p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">Logo, colores, estilo de subtítulos, intro/outro y fuentes, guardados como versiones. Aplica un kit a un proyecto y tus exports salen con tu marca sin tocar clip por clip.</p></div>
        <div role="tablist" className="inline-flex rounded-full bg-[var(--hover)] p-1 text-sm">{([["kit", "Kits"], ["fonts", "Fuentes"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 ${tab === k ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>{l}</button>)}</div>
      </header>
      {msg && <p role="status" className="card mt-4 p-3 text-sm">{msg}</p>}

      {tab === "fonts" ? (
        <section className="card mt-6 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg">Fuentes</h2>
            <label className={`btn btn-primary cursor-pointer ${busy ? "opacity-50" : ""}`}>{busy ? "Subiendo…" : "Subir fuente (TTF/OTF)"}<input type="file" accept=".ttf,.otf" className="sr-only" disabled={busy} onChange={(e) => { uploadFont(e.target.files?.[0]); e.target.value = ""; }} /></label></div>
          <p className="mt-2 text-xs text-[var(--muted)]">Privadas por workspace. Las usan la vista previa y el MP4 exportado (el worker las descarga). Sube solo fuentes con licencia para vídeo y web.</p>
          <ul className="mt-4 space-y-2">
            {[{ id: "bootzy", family: "Bootzy TM", note: "Fuente de los resultados · incluida" }, { id: "arial", family: "Arial", note: "Incluida" }].map((f) => <li key={f.id} className="rounded-xl border border-[var(--border)] px-3 py-2"><span className="text-xl" style={{ fontFamily: `"${f.family}", Arial` }}>Ñandú bailó una canción</span><span className="ml-2 text-xs text-[var(--muted)]">{f.family} · {f.note}</span></li>)}
            {fonts?.map((f) => <li key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2"><span className="min-w-0 truncate"><span className="text-xl" style={{ fontFamily: `"${f.family}", Arial` }}>Ñandú bailó una canción</span><span className="ml-2 text-xs text-[var(--muted)]">{f.family} · {Math.round(f.bytes / 1024)} KB</span></span><button onClick={() => removeFont(f.id, f.storage_path, f.family)} className="shrink-0 text-sm underline">Borrar</button></li>)}
          </ul>
        </section>
      ) : !kits ? <div className="skeleton mt-6 h-64" /> : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="space-y-2">
            <details className="group relative"><summary className="btn btn-primary w-full cursor-pointer list-none">Nuevo kit</summary>
              <div className="mt-2 rounded-2xl border border-[var(--border)] bg-white p-1.5 shadow-sm">
                <button onClick={() => create()} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"><strong className="font-medium">En blanco</strong><span className="block text-xs text-[var(--muted)]">Empieza sin nada</span></button>
                <p className="px-3 pb-1 pt-2 text-[11px] font-medium text-[var(--muted)]">Empezar desde una plantilla</p>
                {TEMPLATES.map((t) => <button key={t.id} onClick={() => createFromTemplate(t)} className="block w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--hover)]"><strong className="font-medium">{t.name}</strong> <span className="text-[11px] text-[var(--muted)]">· {t.sector}</span><span className="block text-xs text-[var(--muted)]">{t.description}</span></button>)}
              </div></details>
            <ul className="space-y-1">{kits.map((k) => <li key={k.id}><button onClick={() => setSel(k.id)} aria-current={sel === k.id} className={`w-full rounded-xl px-3 py-2 text-left ${sel === k.id ? "bg-[var(--ink)] text-white" : "hover:bg-[var(--hover)]"}`}><span className="block truncate font-medium">{k.name}</span><span className={`block text-xs ${sel === k.id ? "text-white/70" : "text-[var(--muted)]"}`}>v{k.version}</span></button></li>)}</ul>
            {!kits.length && <p className="text-sm text-[var(--muted)]">Aún no tienes kits. Crea el primero y aplícalo a un proyecto.</p>}
          </aside>

          {!draft ? <div className="card grid min-h-64 place-items-center border-dashed p-10 text-center text-[var(--muted)]">Elige un kit o crea uno nuevo.</div> : (
            <div className="space-y-5">
              {draft.config.template && templateById(draft.config.template) && (
                <p className="rounded-xl bg-[var(--surface)] px-4 py-3 text-sm">Creado desde la plantilla <strong>{templateById(draft.config.template)!.name}</strong>{draft.config.lyric ? ` · letra: ${draft.config.lyric.look ? `look «${draft.config.lyric.look}»` : `estilo «${draft.config.lyric.style}»`}` : ""} · encuadre {draft.config.layout} · montaje {draft.config.montage === "ritmo" ? "con cortes al ritmo" : draft.config.montage === "frases" ? "con cortes en cambios de frase" : draft.config.montage === "fotos" ? "con fotos" : "continuo"}.{templateById(draft.config.template)!.note ? ` ${templateById(draft.config.template)!.note}` : ""}</p>)}
              <section className="card p-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="min-w-56 flex-1 text-sm">Nombre<input value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} className="input mt-1" /></label>
                  <div className="flex gap-2"><button onClick={() => create(`${draft.name} (copia)`, kit!)} className="btn btn-ghost !py-1.5 !text-xs">Duplicar</button><button onClick={archive} className="btn btn-ghost !py-1.5 !text-xs">Archivar</button><button onClick={save} disabled={!dirty || busy} className="btn btn-primary !py-1.5 !text-xs disabled:opacity-40">{dirty ? "Guardar versión" : `Versión ${kit!.version}`}</button></div>
                </div>
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-5">
                  <section className="card p-5"><h2 className="text-lg">Logo</h2>
                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <div className="grid h-20 w-32 place-items-center rounded-xl bg-[#1b1b1b]">{draft.logo_path && urls[draft.logo_path] ? <img src={urls[draft.logo_path]} alt="Logo del kit" className="max-h-16 max-w-28 object-contain" /> : <span className="text-xs text-white/60">Sin logo</span>}</div>
                      <label className="btn btn-ghost cursor-pointer !py-1.5 !text-xs">Subir PNG/JPG/WebP<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => { uploadLogo(e.target.files?.[0]); e.target.value = ""; }} /></label>
                      {draft.logo_path && <button className="text-xs underline" onClick={() => set({ logo_path: null })}>Quitar</button>}
                    </div>
                    {draft.logo_path && <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                      <fieldset><legend className="mb-1">Posición</legend><div className="grid grid-cols-2 gap-1">{([["tl", "↖ Arriba izq."], ["tr", "↗ Arriba der."], ["bl", "↙ Abajo izq."], ["br", "↘ Abajo der."]] as const).map(([k, l]) => <button key={k} aria-pressed={logo.position === k} onClick={() => setCfg({ logo: { ...logo, position: k } })} className={`rounded-lg px-2 py-1 text-xs ${logo.position === k ? "bg-[var(--ink)] text-white" : "bg-[var(--hover)]"}`}>{l}</button>)}</div></fieldset>
                      <label>Tamaño <span className="tnum float-right">{Math.round(logo.scale * 100)} %</span><input type="range" min={0.05} max={0.4} step={0.01} value={logo.scale} onChange={(e) => setCfg({ logo: { ...logo, scale: Number(e.target.value) } })} className="w-full" /></label>
                      <label>Opacidad <span className="tnum float-right">{Math.round(logo.opacity * 100)} %</span><input type="range" min={0.1} max={1} step={0.05} value={logo.opacity} onChange={(e) => setCfg({ logo: { ...logo, opacity: Number(e.target.value) } })} className="w-full" /></label>
                    </div>}
                  </section>

                  <section className="card p-5"><h2 className="text-lg">Colores del contenido</h2><p className="text-xs text-[var(--muted)]">Para tus vídeos y estilos; la interfaz sigue siendo monocroma.</p>
                    <div className="mt-3 flex flex-wrap gap-4">{COLOR_KEYS.map(([k, l]) => <label key={k} className="text-sm"><span className="block">{l}</span><span className="mt-1 flex items-center gap-2"><input type="color" value={draft.colors[k] ?? "#000000"} onChange={(e) => set({ colors: { ...draft.colors, [k]: e.target.value.toUpperCase() } })} className="h-9 w-12 cursor-pointer rounded border border-[var(--border)]" /><span className="mono text-xs">{draft.colors[k] ?? "—"}</span></span></label>)}</div>
                  </section>

                  <section className="card p-5"><h2 className="text-lg">Subtítulos</h2>
                    <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_220px]">
                      <div className="space-y-3 text-sm">
                        <label className="block">Estilo<select value={styleKey} onChange={(e) => { const o = styleOptions.find((x) => x.key === e.target.value); set({ subtitle_style: o ? structuredClone(o.style) : null }); }} className="input mt-1">
                          <option value="">Sin estilo de marca (no cambia los clips)</option>{styleKey === "current" && <option value="current">Estilo personalizado del kit</option>}{styleOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
                        {draft.subtitle_style && <>
                          <label className="block">Fuente<select value={draft.subtitle_style.fontName} onChange={(e) => set({ subtitle_style: { ...draft.subtitle_style!, fontName: e.target.value } })} className="input mt-1">{["Bootzy TM", "Arial", ...(fonts?.map((f) => f.family) ?? [])].filter((x, i, a) => a.indexOf(x) === i).map((f) => <option key={f}>{f}</option>)}</select></label>
                          <div className="flex flex-wrap gap-4">{([["primary", "Texto"], ["active", "Palabra activa"], ["outline", "Contorno"]] as const).map(([k, l]) => <label key={k} className="text-xs">{l}<input type="color" value={draft.subtitle_style![k]} onChange={(e) => set({ subtitle_style: { ...draft.subtitle_style!, [k]: e.target.value.toUpperCase() } })} className="mt-1 block h-8 w-12 cursor-pointer rounded border border-[var(--border)]" /></label>)}</div>
                          <button className="text-xs underline" onClick={() => set({ colors: { ...draft.colors, text: draft.subtitle_style!.primary, accent: draft.subtitle_style!.active } })}>Usar estos colores como colores del kit</button>
                        </>}
                        <p className="text-xs text-[var(--muted)]">Ajustes finos (posición, animación) en <Link href="/app/style-studio" className="underline">Style Studio</Link>: guarda el estilo y elígelo aquí.</p>
                      </div>
                      <div className="grid place-items-center rounded-xl bg-[#151515] p-3">{draft.subtitle_style ? <LyricSample style={draft.subtitle_style} text="así se verán tus clips" scale={0.3} step={2} /> : <span className="text-xs text-white/60">Sin estilo</span>}</div>
                    </div>
                  </section>

                  <section className="card p-5"><h2 className="text-lg">Intro y outro</h2><p className="text-xs text-[var(--muted)]">Se añaden al principio y al final de cada export con el tamaño del formato, sin deformarse (barras negras si hace falta). Vídeo MP4/WebM hasta 50 MB y 15 s, o una imagen (3 s).</p>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">{(["intro", "outro"] as const).map((w) => { const b = draft.config[w]; return (
                      <div key={w} className="rounded-xl border border-[var(--border)] p-3 text-sm"><div className="font-medium">{w === "intro" ? "Intro" : "Outro"}</div>
                        {b ? <><div className="mt-2 aspect-video overflow-hidden rounded-lg bg-black">{urls[b.path] ? (b.kind === "photo" ? <img src={urls[b.path]} alt="" className="h-full w-full object-contain" /> : <video src={urls[b.path]} controls preload="metadata" className="h-full w-full object-contain" />) : null}</div>
                          <p className="mt-1 truncate text-xs text-[var(--muted)]">{b.name} · {b.kind === "photo" ? "imagen" : "vídeo"}{b.kind === "video" ? ` · ${b.hasAudio ? "con audio" : "sin audio"}` : ""}</p>
                          <label className="mt-1 block text-xs">Duración <span className="tnum">{b.dur.toFixed(1)} s</span><input type="range" min={0.5} max={15} step={0.5} value={b.dur} onChange={(e) => setCfg({ [w]: { ...b, dur: Number(e.target.value) } })} className="w-full" /></label>
                          <button className="mt-1 text-xs underline" onClick={() => setCfg({ [w]: null })}>Quitar</button></> :
                          <label className="btn btn-ghost mt-2 w-full cursor-pointer !py-1.5 !text-xs">Subir<input type="file" accept="video/mp4,video/webm,image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => { uploadBumper(w, e.target.files?.[0]); e.target.value = ""; }} /></label>}
                      </div>); })}</div>
                  </section>

                  <section className="card p-5"><h2 className="text-lg">Perfil de exportación</h2>
                    <div className="mt-3 flex flex-wrap gap-6 text-sm">
                      <fieldset><legend className="mb-1">Formatos habituales</legend><div className="flex gap-2">{["9:16", "4:5", "1:1", "16:9"].map((r) => { const on = (draft.config.export?.ratios ?? ["9:16"]).includes(r); return <button key={r} aria-pressed={on} onClick={() => { const cur = draft.config.export?.ratios ?? ["9:16"]; const next = on ? cur.filter((x) => x !== r) : [...cur, r]; setCfg({ export: { ratios: next.length ? next : ["9:16"], res: draft.config.export?.res ?? 1080 } }); }} className={`chip ${on ? "!bg-[var(--ink)] !text-white" : ""}`}>{r}</button>; })}</div></fieldset>
                      <p className="max-w-xs text-xs text-[var(--muted)]">Guardado con el kit como preferencia. El editor exporta un formato cada vez; la resolución de los clips es la del formato (1080 de ancho).</p>
                    </div>
                  </section>
                </div>

                <aside className="space-y-5">
                  <section className="card p-4"><h3 className="text-sm font-medium">Vista previa de marca</h3>
                    <div className="relative mx-auto mt-3 aspect-[9/16] w-40 overflow-hidden rounded-xl bg-gradient-to-b from-[#5d7486] to-[#2b2b2e]">
                      {draft.logo_path && urls[draft.logo_path] && <img src={urls[draft.logo_path]} alt="" className={`absolute ${pos[logo.position]}`} style={{ width: `${logo.scale * 100}%`, opacity: logo.opacity }} />}
                      {draft.subtitle_style && <div className="absolute inset-x-0 bottom-[20%]"><LyricSample style={draft.subtitle_style} text="tu estilo" scale={0.17} step={2} /></div>}
                    </div>
                    <p className="mt-2 text-center text-[11px] text-[var(--muted)]">Aproximada. Intro/outro se añaden fuera del clip.</p>
                  </section>
                  <section className="card p-4"><h3 className="text-sm font-medium">Historial</h3>
                    <ul className="mt-2 max-h-52 space-y-1 overflow-auto text-xs">{versions.map((v) => <li key={v.version} className="flex items-center justify-between gap-2"><span>v{v.version} · {new Date(v.created_at).toLocaleDateString("es", { day: "numeric", month: "short" })}</span>{v.version !== kit!.version && <button className="underline" onClick={() => restore(v)}>Restaurar</button>}</li>)}</ul>
                  </section>
                </aside>
              </div>

              <section className="card p-5"><h2 className="text-lg">Aplicar a un proyecto</h2>
                <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
                  <label className="min-w-56 flex-1">Proyecto<select value={target} onChange={(e) => setTarget(e.target.value)} className="input mt-1"><option value="">Elige un proyecto…</option>{projects?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                </div>
                {dirty && <p className="mt-2 text-xs">Tienes cambios sin guardar: guarda la versión antes de aplicarla.</p>}
                {target && !dirty && kit && (
                  <div className="mt-4 rounded-xl bg-[var(--surface)] p-4 text-sm">
                    <p className="font-medium">Qué cambiará en «{targetProj?.name}»</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
                      <li>Kit aplicado: <strong className="text-[var(--text)]">{kit.name} v{kit.version}</strong> (versión fijada: cambios futuros del kit no alteran este proyecto).</li>
                      <li>Exports nuevos: {[kit.logo_path && "logo", kit.config.intro && "intro", kit.config.outro && "outro"].filter(Boolean).join(", ") || "sin logo ni intro/outro"}. Los exports ya hechos no se tocan.</li>
                      {kit.subtitle_style ? <li><label className="inline-flex items-center gap-2"><input type="checkbox" checked={applyStyle} onChange={(e) => setApplyStyle(e.target.checked)} />Cambiar el estilo de subtítulos de {clipCount ?? "…"} clips a «{kit.subtitle_style.fontName}» (crea una versión nueva de cada clip; se puede revertir).</label></li> : <li>Los subtítulos de los clips no cambian.</li>}
                    </ul>
                    <div className="mt-3 flex gap-2"><button onClick={() => apply(kit.id)} disabled={busy} className="btn btn-primary !py-1.5 !text-xs">Aplicar marca</button>{targetProj && <button onClick={() => apply(null)} disabled={busy} className="btn btn-ghost !py-1.5 !text-xs">Quitar marca del proyecto</button>}</div>
                  </div>)}
                {!!apps.length && <div className="mt-4"><h3 className="text-sm font-medium">Aplicaciones recientes</h3>
                  <ul className="mt-2 divide-y divide-[var(--border)] text-sm">{apps.map((a) => <li key={a.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate">{projects?.find((p) => p.id === a.project_id)?.name ?? "Proyecto"} · v{a.kit_version} · {new Date(a.created_at).toLocaleString("es")}</span>{a.reverted_at ? <span className="chip !py-0.5">Revertida</span> : <button onClick={() => revert(a)} className="text-xs underline">Revertir</button>}</li>)}</ul></div>}
              </section>
            </div>
          )}
        </div>
      )}
    </main>
    </>
  );
}
