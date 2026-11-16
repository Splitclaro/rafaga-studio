import Link from "next/link";
export const metadata = { title: "Condiciones de uso · Ráfaga Studio" };
// Página pública exigida por TikTok for Developers.
export default function Condiciones() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-[15px] leading-relaxed">
      <h1 className="text-3xl">Condiciones de uso</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Ráfaga Studio · vigentes desde el 16 de noviembre de 2026</p>
      <h2 className="mt-8 text-xl">El servicio</h2>
      <p className="mt-2">Ráfaga Studio permite subir audio y vídeo, generar clips y vídeos con letra, y publicar o programar esos vídeos en las cuentas que el usuario conecta. El acceso es privado y por invitación.</p>
      <h2 className="mt-8 text-xl">Tu contenido</h2>
      <p className="mt-2">Eres responsable del contenido que subes y publicas, incluida la música. Debes tener los derechos necesarios (propios, con licencia o libres) y cumplir las normas de cada plataforma, incluidas las Normas de la Comunidad y las Condiciones de servicio de TikTok. La app te pide declarar el origen de la música antes de programar.</p>
      <h2 className="mt-8 text-xl">Publicación en TikTok</h2>
      <p className="mt-2">Solo se publica lo que eliges, en la cuenta y a la hora que indicas. Puedes cancelar una publicación programada antes de su hora. La disponibilidad, la privacidad efectiva y el alcance dependen de TikTok.</p>
      <h2 className="mt-8 text-xl">Uso aceptable</h2>
      <p className="mt-2">No está permitido usar la app para spam, contenido ilegal, suplantación ni para eludir los límites de las plataformas.</p>
      <h2 className="mt-8 text-xl">Sin garantías</h2>
      <p className="mt-2">Las estimaciones de interés o viralidad son orientativas. El servicio se ofrece tal cual y puede cambiar.</p>
      <p className="mt-10 text-sm"><Link href="/privacidad" className="underline">Política de privacidad</Link></p>
    </main>
  );
}
