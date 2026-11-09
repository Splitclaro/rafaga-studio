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
    if (data.session) return router.replace("/app");
    setMsg("Cuenta creada. Revisa tu correo para confirmarla y vuelve a entrar.");
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">{mode === "in" ? "Entrar" : "Crear cuenta"}</h1>
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm">Correo
          <input type="email" required autoComplete="email" className="mt-1 w-full rounded bg-[var(--surface)] px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block text-sm">Contraseña
          <input type="password" required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} className="mt-1 w-full rounded bg-[var(--surface)] px-3 py-2" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        <button disabled={busy} className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-60">{busy ? "Un momento…" : mode === "in" ? "Entrar" : "Crear cuenta"}</button>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-[var(--danger)]">{msg}</p>
      </form>
      <button className="text-sm text-[var(--muted)] underline" onClick={() => setMode(mode === "in" ? "up" : "in")}>{mode === "in" ? "No tengo cuenta" : "Ya tengo cuenta"}</button>
    </main>
  );
}
