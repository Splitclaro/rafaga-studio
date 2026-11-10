import "./globals.css";
import type { ReactNode } from "react";
import { DM_Sans, Space_Grotesk } from "next/font/google";
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading", display: "swap" });
export const metadata = { title: "Ráfaga Studio", description: "Del vídeo largo al momento que importa" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="es" className={`${body.variable} ${display.variable}`}><body>{children}</body></html>);
}
