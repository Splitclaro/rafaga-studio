"use client";
import { createClient } from "@supabase/supabase-js";

// URL y clave PUBLISHABLE: públicas por diseño (la seguridad la da RLS). Nunca poner aquí la clave secreta.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://attrnwbcgascvppncucl.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_X9ksBV_C-GLc75mGkOPo3g_yltsXTbB";

export const supabase = createClient(url, key);

/** El procesamiento (ASR/selección/render) requiere el worker; hasta que exista, la UI lo dice sin simular. */
export const PROCESSING_ENABLED = process.env.NEXT_PUBLIC_PROCESSING_ENABLED === "true";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // límite efectivo del plan Free de Supabase Storage
export const BRIEF_MAX = 2000;
