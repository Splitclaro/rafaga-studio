"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMsg(null);
    const { data, error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setMsg(error.message);
    // Volver a la página pedida (p. ej. una invitación) solo si es una ruta interna de la app
    const next = new URLSearchParams(window.location.search).get("next") ?? "";
    if (data.session) return router.replace(/^\/app(\/[\w\-/?=&%.]*)?$/.test(next) && !next.startsWith("//") ? next : "/app");
    setMsg("Cuenta creada. Revisa tu correo para confirmarla y vuelve a entrar.");
  }

  return (
    <main className="grid min-h-screen md:grid-cols-2">
      <section className="hidden flex-col justify-between bg-[#0D111C] p-12 text-white md:flex" aria-hidden>
        <span className="flex items-center gap-2.5 font-display text-xl font-bold"><span className="grid h-9 w-9 place-items-center rounded-[10px] bg-[var(--accent)] text-lg">⚡</span>ráfaga</span>
        <div><h2 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight !text-white">Tú pones el vídeo. Ráfaga hace de clipper.</h2>
          <p className="mt-5 max-w-md text-[17px] leading-relaxed text-white/70">Elige los momentos, los compone en vertical, los subtitula y te los deja listos para revisar. Tú decides el resultado final.</p></div>
        <span className="text-sm text-white/50">Clips con puntuación de encaje estimada, no garantizada.</span>
      </section>
      <section className="flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div role="tablist" aria-label="Acceso" className="mb-6 inline-flex rounded-xl border hairline bg-[var(--card)] p-1 text-sm">
            {(["in", "up"] as const).map((k) => <button key={k} role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setMsg(null); }} className={`rounded-lg px-4 py-1.5 font-medium ${mode === k ? "bg-[var(--ink)] text-white" : "text-[var(--muted)]"}`}>{k === "in" ? "Entrar" : "Crear cuenta"}</button>)}
          </div>
          <h1 className="mb-6 text-3xl">{mode === "in" ? "Entra en Ráfaga" : "Crea tu cuenta"}</h1>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-sm font-medium">Correo
              <input type="email" required autoComplete="email" placeholder="tu@correo.com" className="input mt-1" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="block text-sm font-medium">Contraseña
              <input type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} placeholder="Mínimo 8 caracteres" className="input mt-1" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button disabled={busy} className="btn btn-primary w-full !min-h-11">{busy ? "Un momento…" : mode === "in" ? "Entrar" : "Crear cuenta"}</button>
            <p role="status" aria-live="polite" className="min-h-5 text-sm text-[var(--danger)]">{msg}</p>
          </form>
        </div>
      </section>
    </main>
  );
}
