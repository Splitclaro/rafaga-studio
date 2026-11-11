import "./globals.css";
import type { ReactNode } from "react";
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-heading", display: "swap", weight: ["600", "700", "800"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-ui", display: "swap", weight: ["500"] });
export const metadata = { title: "Ráfaga Studio", description: "Del vídeo largo al momento que importa" };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="es" className={`${body.variable} ${display.variable} ${mono.variable}`}><body>{children}</body></html>);
}
