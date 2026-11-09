import "./globals.css";
import type { ReactNode } from "react";
export const metadata = { title: "Ráfaga Studio", description: "Del vídeo largo al momento que importa" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="es"><body>{children}</body></html>);
}
