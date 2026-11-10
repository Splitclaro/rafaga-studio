"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";

type Person = { user_id: string; email: string; display_name: string | null; role: string; joined_at: string; is_me: boolean };
type Invite = { id: string; email: string; role: string; expires_at: string; accepted_at: string | null; revoked_at: string | null; created_at: string };
type Ev = { id: number; action: string; detail: Record<string, string>; created_at: string; actor: string | null };
const ROLE: Record<string, string> = { owner: "Propietario", admin: "Administrador", editor: "Editor", reviewer: "Revisor", viewer: "Lector", member: "Editor" };
const ROLE_HELP: Record<string, string> = { admin: "Todo lo del editor + invitar y gestionar miembros", editor: "Crear, editar, generar y exportar", reviewer: "Ver y revisar resultados, sin modificar", viewer: "Solo ver" };
const ACTION: Record<string, string> = { "workspace.create": "Creó el espacio", "invite.create": "Invitó", "invite.accept": "Aceptó una invitación", "invite.revoke": "Revocó una invitación", "member.role": "Cambió un rol", "member.remove": "Quitó a un miembro", "member.leave": "Salió del espacio" };

export default function Equipo() {
  const [me, setMe] = useState<{ name: string; role: string; personal: boolean } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [email, setEmail] = useState(""), [role, setRole] = useState("editor");
  const [link, setLink] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const admin = me?.role === "owner" || me?.role === "admin";

  const load = useCallback(async () => {
    const [{ data: w }, { data: p }] = await Promise.all([supabase.rpc("my_workspaces"), supabase.rpc("workspace_people")]);
    const cur = ((w ?? []) as { name: string; role: string; personal: boolean; active: boolean }[]).find((x) => x.active);
    setMe(cur ? { name: cur.name, role: cur.role, personal: cur.personal } : null);
    setPeople((p ?? []) as Person[]);
    if (cur && (cur.role === "owner" || cur.role === "admin")) {
      const [{ data: i }, { data: e }] = await Promise.all([
        supabase.from("workspace_invites").select("id,email,role,expires_at,accepted_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(50),
        supabase.from("audit_events").select("id,action,detail,created_at,actor").order("id", { ascending: false }).limit(50),
      ]);
      setInvites((i ?? []) as Invite[]); setEvents((e ?? []) as Ev[]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setLink(null);
    const { data, error } = await supabase.rpc("create_invite", { p_email: email, p_role: role });
    if (error) return setMsg(error.message);
    setLink(`${window.location.origin}/app/invitacion?token=${data as string}`); setEmail(""); load();
  }
  const call = async (fn: string, args: Record<string, unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const { error } = await supabase.rpc(fn, args); setMsg(error ? error.message : null); load();
  };
  const who = (id: string | null) => people.find((p) => p.user_id === id)?.email ?? "otra persona";

  return (
    <main className="mx-auto max-w-4xl px-4 pb-16 pt-8 md:px-8">
      <h1 className="text-3xl">Equipo y permisos</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Espacio activo: <strong>{me?.name ?? "…"}</strong>{me ? ` · tu rol: ${ROLE[me.role]}` : ""}. Cada espacio separa proyectos, canciones, medios, estilos y automatizaciones; los permisos se comprueban en el servidor.</p>
      {msg && <p role="alert" className="card mt-4 p-3 text-sm">{msg}</p>}

      <section className="card mt-6 p-5">
        <h2 className="text-lg">Miembros <span className="mono text-sm text-[var(--muted)]">{people.length}</span></h2>
        <ul className="mt-3 divide-y divide-[var(--border)]">{people.map((p) => (
          <li key={p.user_id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--accent)] text-xs text-white">{p.email[0]?.toUpperCase()}</span>
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{p.display_name ?? p.email}{p.is_me ? " (tú)" : ""}</span><span className="block truncate text-xs text-[var(--muted)]">{p.email}</span></span>
            {admin && p.role !== "owner" && !p.is_me ? (
              <select aria-label={`Rol de ${p.email}`} value={p.role === "member" ? "editor" : p.role} onChange={(e) => call("set_member_role", { p_user: p.user_id, p_role: e.target.value })} className="rounded-full border border-[var(--border)] bg-white px-3 py-1">
                {(me?.role === "owner" ? ["admin", "editor", "reviewer", "viewer"] : ["editor", "reviewer", "viewer"]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select>
            ) : <span className="chip !py-0.5">{ROLE[p.role]}</span>}
            {p.role !== "owner" && (admin || p.is_me) && <button className="btn btn-ghost !px-3 !py-1 !text-xs" onClick={() => call("remove_member", { p_user: p.user_id }, p.is_me ? "¿Salir de este espacio? Perderás el acceso." : `¿Quitar a ${p.email} del espacio?`)}>{p.is_me ? "Salir" : "Quitar"}</button>}
          </li>))}</ul>
      </section>

      {admin ? (<>
        <section className="card mt-6 p-5">
          <h2 className="text-lg">Invitar</h2>
          {me?.personal && <p className="mt-1 text-sm text-[var(--muted)]">Consejo: para trabajar con un cliente o un artista, crea un espacio nuevo desde el menú de espacios e invita allí.</p>}
          <form onSubmit={invite} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
            <label className="sr-only" htmlFor="inv-email">Email</label>
            <input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@ejemplo.com" className="input" />
            <label className="sr-only" htmlFor="inv-role">Rol</label>
            <select id="inv-role" value={role} onChange={(e) => setRole(e.target.value)} className="input">{(me?.role === "owner" ? ["admin", "editor", "reviewer", "viewer"] : ["editor", "reviewer", "viewer"]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}</select>
            <button className="btn btn-primary">Crear invitación</button>
          </form>
          <p className="mt-2 text-xs text-[var(--muted)]">{ROLE_HELP[role]}. El enlace es de un solo uso, caduca en 7 días y solo funciona con ese email. Aún no enviamos emails: copia el enlace y compártelo tú.</p>
          {link && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--surface)] p-3 text-sm"><code className="min-w-0 flex-1 truncate">{link}</code><button className="btn btn-ghost !px-3 !py-1 !text-xs" onClick={() => navigator.clipboard.writeText(link).then(() => setMsg("Enlace copiado. Solo se muestra ahora."))}>Copiar</button></div>}
          {!!invites.length && <ul className="mt-4 divide-y divide-[var(--border)] text-sm">{invites.map((i) => {
            const st = i.accepted_at ? "Aceptada" : i.revoked_at ? "Revocada" : new Date(i.expires_at) < new Date() ? "Caducada" : "Pendiente";
            return <li key={i.id} className="flex items-center gap-3 py-2"><span className="min-w-0 flex-1 truncate">{i.email}</span><span className="text-xs text-[var(--muted)]">{ROLE[i.role]}</span><span className="chip !py-0.5">{st}</span>{st === "Pendiente" && <button className="text-xs underline" onClick={() => call("revoke_invite", { p_id: i.id })}>Revocar</button>}</li>;
          })}</ul>}
        </section>
        <section className="card mt-6 p-5">
          <h2 className="text-lg">Registro de actividad</h2>
          {!events.length ? <p className="mt-2 text-sm text-[var(--muted)]">Sin actividad de equipo todavía.</p> : (
            <ul className="mt-3 space-y-1.5 text-sm">{events.map((e) => <li key={e.id} className="flex gap-3"><span className="mono w-36 shrink-0 text-xs text-[var(--muted)]">{new Date(e.created_at).toLocaleString("es")}</span><span>{who(e.actor)}: {ACTION[e.action] ?? e.action}{e.detail?.email ? ` a ${e.detail.email}` : ""}{e.detail?.role ? ` (${ROLE[e.detail.role] ?? e.detail.role})` : ""}{e.detail?.to ? ` → ${ROLE[e.detail.to]}` : ""}</span></li>)}</ul>)}
        </section>
      </>) : <p className="mt-6 text-sm text-[var(--muted)]">Solo propietarios y administradores pueden invitar y gestionar permisos.</p>}
    </main>
  );
}
