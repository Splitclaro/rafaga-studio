import Link from "next/link";
export const metadata = { title: "Política de privacidad · Ráfaga Studio" };
// Página pública exigida por TikTok for Developers (Login Kit y Content Posting API). Describe lo que la app hace de verdad.
export default function Privacidad() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-[15px] leading-relaxed">
      <h1 className="text-3xl">Política de privacidad</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">Ráfaga Studio · vigente desde el 16 de noviembre de 2026</p>
      <h2 className="mt-8 text-xl">Qué es Ráfaga Studio</h2>
      <p className="mt-2">Ráfaga Studio es una herramienta privada para crear vídeos cortos (clips y vídeos con letra) a partir de material que sube el propio usuario, y para programar su publicación en las cuentas de redes sociales que el usuario conecta.</p>
      <h2 className="mt-8 text-xl">Datos que tratamos</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Cuenta: correo electrónico y sesión de acceso.</li>
        <li>Contenido: archivos de audio, vídeo e imagen que subes, transcripciones y los vídeos que genera la app.</li>
        <li>Cuentas conectadas (TikTok y otras): identificador de la cuenta, nombre visible y los tokens de acceso que la plataforma entrega al autorizar. Los tokens se guardan cifrados en reposo en nuestra base de datos y nunca se muestran en la interfaz.</li>
        <li>Publicaciones: texto, fecha programada, estado y el identificador que devuelve la plataforma.</li>
      </ul>
      <h2 className="mt-8 text-xl">Para qué usamos los datos de TikTok</h2>
      <p className="mt-2">Solo para lo que pides en la app: mostrar qué cuenta está conectada, subir y publicar en esa cuenta los vídeos que eliges, con el texto y la hora que indicas, y consultar el estado de esas publicaciones. No vendemos ni compartimos estos datos con terceros, no los usamos para publicidad y no publicamos nada que no hayas elegido.</p>
      <h2 className="mt-8 text-xl">Proveedores</h2>
      <p className="mt-2">La app funciona sobre Supabase (base de datos y autenticación), Cloudflare R2 (almacenamiento de archivos), Vercel (web) y Modal (procesado de vídeo). La transcripción y los textos sugeridos pueden usar Groq. Cada proveedor trata los datos solo para prestar su servicio.</p>
      <h2 className="mt-8 text-xl">Conservación y borrado</h2>
      <p className="mt-2">Puedes borrar proyectos, canciones y vídeos desde la app; los archivos se eliminan del almacenamiento en minutos. Al desconectar una cuenta de TikTok se borran sus tokens y se cancelan sus publicaciones programadas; también puedes retirar el acceso desde la propia app de TikTok.</p>
      <h2 className="mt-8 text-xl">Tus derechos</h2>
      <p className="mt-2">Puedes pedir acceso, rectificación o eliminación de tus datos desde tu cuenta en la app.</p>
      <p className="mt-10 text-sm"><Link href="/condiciones" className="underline">Condiciones de uso</Link></p>
    </main>
  );
}
