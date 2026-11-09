import { redirect } from "next/navigation";

/** Proyectos y Biblioteca eran lo mismo: ahora todo vive en Biblioteca (cada proyecto con sus clips). */
export default function Proyectos() { redirect("/app/biblioteca"); }
