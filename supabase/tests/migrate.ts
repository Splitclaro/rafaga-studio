// Arnés de migraciones para pruebas: aplica TODAS las migraciones de supabase/migrations en orden sobre PGlite.
// Supabase (auth, storage, roles) se emula aquí; si una migración falla en PGlite se corrige el shim, nunca la migración.
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const DIR = new URL("../migrations/", import.meta.url);
export const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
export const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

export function listMigrations(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}
const sql = (name: string) => readFileSync(new URL(name, DIR), "utf8");

export const ENV_SHIMS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, metadata jsonb);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant usage on schema auth, storage, public to anon, authenticated, service_role;
  grant select, insert, delete on storage.objects to authenticated;
`;

/** Sentencias que el entorno de Supabase hace por su cuenta y que aquí se reproducen tras cada migración concreta. */
export const HOOKS: Record<string, (db: PGlite) => Promise<void>> = {
  "20261109000001_core.sql": async (db) => {
    await db.exec("grant all on all tables in schema public to authenticated; grant all on all functions in schema public to authenticated;");
    // grants amplios arriba; los REVOKE/column GRANT de la migración deben seguir mandando:
    await db.exec(sql("20261109000001_core.sql").split("-- Los privilegios")[1].split("-- ───────── Storage")[0].replace(/^[^\n]*\n/, ""));
  },
  "20261109000004_workspace_fonts.sql": async (db) => { await db.exec("grant select, insert, delete on public.workspace_fonts to authenticated;"); },
  "20261109000008_pages.sql": async (db) => { await db.exec("grant select, insert, delete on public.text_styles to authenticated;"); },
  "20261110000011_automation_jobs.sql": async (db) => { await db.exec("grant execute on function public.request_automation_check(uuid) to authenticated;"); },
  "20261110000012_live.sql": async (db) => { await db.exec("grant select on public.live_sessions, public.live_windows to authenticated; grant execute on function public.start_live_session(text, text), public.set_live_status(uuid, text) to authenticated;"); },
};

/** Grants que Supabase concede por defecto y que las pruebas necesitan al final. */
export const FINAL_GRANTS = `
  grant execute on function public.share_view(text), public.share_comment(text, uuid, numeric, text, text), public.share_decide(text, uuid, text, text, text), public.share_path_ok(text) to anon;
  grant select, insert, delete on public.songs to authenticated; grant select on public.song_alignments, public.lyric_videos to authenticated; grant execute on function public.request_lyrics(uuid, jsonb, text) to authenticated;
  grant execute on function public.request_detection(uuid, text) to authenticated; grant execute on function public.request_render(uuid, int, text, boolean) to authenticated;
`;

export async function applyMigrations(db: PGlite): Promise<string[]> {
  const applied: string[] = [];
  for (const name of listMigrations()) {
    try { await db.exec(sql(name)); } catch (e) { throw new Error(`Migración ${name} falló en PGlite: ${(e as Error).message}`); }
    await HOOKS[name]?.(db);
    applied.push(name);
  }
  await db.exec(FINAL_GRANTS);
  return applied;
}

export async function freshDb() {
  const db = new PGlite();
  await db.exec(ENV_SHIMS);
  const applied = await applyMigrations(db);
  await db.exec(`insert into auth.users values ('${A}','a@test.dev'),('${B}','b@test.dev');`);
  const wsA = (await db.query<{ id: string }>(`select id from workspaces where created_by='${A}'`)).rows[0].id;
  const wsB = (await db.query<{ id: string }>(`select id from workspaces where created_by='${B}'`)).rows[0].id;
  const asUser = async (uid: string | null, fn: () => Promise<void>) => {
    await db.exec(`set role ${uid ? "authenticated" : "anon"}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
    try { await fn(); } finally { await db.exec("reset role;"); }
  };
  return { db, A, B, wsA, wsB, asUser, applied };
}
