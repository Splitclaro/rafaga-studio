import { redirect } from "next/navigation";

/** La biblioteca de medios vive ahora en Brand kit → Recursos de marca (el diseño no tiene una página aparte). */
export default async function Biblioteca({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  redirect(tab ? `/app/brand-kits?tab=${encodeURIComponent(tab)}` : "/app/brand-kits");
}
