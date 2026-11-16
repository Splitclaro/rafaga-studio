import type { NextConfig } from "next";
// Cabeceras de seguridad (auditoría 2026-11-16): sin marcos de terceros (clickjacking), sin adivinar tipos MIME, referrer mínimo y sin permisos de hardware que la app no usa.
const headers = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];
const config: NextConfig = { transpilePackages: ["@rafaga/composition", "@rafaga/lyrics", "@rafaga/selection", "@rafaga/providers"], async headers() { return [{ source: "/:path*", headers }]; } };
export default config;
