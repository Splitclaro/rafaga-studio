export default function Soon({ title, what, status }: { title: string; what: string; status: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-[var(--muted)]">{what}</p>
      <p role="note" className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"><strong>Aún no disponible en la beta.</strong> {status}</p>
    </main>
  );
}
