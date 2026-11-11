import { redirect } from "next/navigation";

/** La entrada pública es el acceso: con sesión, /app; sin ella, /login (lo decide el propio /app). */
export default function Home() { redirect("/app"); }
