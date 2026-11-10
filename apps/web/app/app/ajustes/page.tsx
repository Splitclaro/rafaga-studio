"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, MAX_UPLOAD_BYTES } from "../../../lib/supabase";
import AiUsage from "../../../components/AiUsage";

export default function Ajustes() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  useEffect(() => { supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? "")); }, []);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Ajustes</h1>
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="font-medium">Cuenta</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{email}</p>
        <button className="mt-3 rounded-lg border border-[var(--muted)] px-4 py-2 text-sm" onClick={async () => { await supabase.auth.signOut(); router.replace("/login"); }}>Cerrar sesión</button>
      </section>
      <AiUsage />
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">
        <h2 className="font-medium">Límites actuales de la beta</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
          <li>Tamaño máximo por vídeo: {MAX_UPLOAD_BYTES / 1048576} MB (plan gratuito de almacenamiento).</li>
          <li>Formatos: MP4, MOV y WebM. Clips: de 3 a 10 por proyecto.</li>
          <li>El procesamiento corre en un worker que revisa la cola cada pocos minutos.</li>
        </ul>
      </section>
    </main>
  );
}
