import { redirect } from "next/navigation";

/** «En vivo» se retiró de la app; los enlaces antiguos vuelven a Inicio. */
export default function Page() { redirect("/app"); }
