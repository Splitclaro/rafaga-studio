#!/bin/bash
# Crea el secreto `rafaga-worker` en Modal pidiendo cada valor en la terminal (entrada oculta).
# Nada se imprime ni se guarda en el repo. Deja en blanco lo que no tengas: se omite.
set -u
MODAL="$HOME/.cache/rafaga/modal-venv/bin/modal"
args=()
ask() { # nombre, ayuda, secreto(1/0)
  local v
  echo; echo "• $1 — $2"
  if [ "$3" = 1 ]; then read -r -s -p "  valor (oculto, Enter para omitir): " v; echo; else read -r -p "  valor (Enter para omitir): " v; fi
  [ -n "$v" ] && args+=("$1=$v")
}
args+=("SUPABASE_URL=https://attrnwbcgascvppncucl.supabase.co" "R2_ACCOUNT_ID=0d655067d9a1a6ec25536615f31d9a43" "R2_BUCKET=rafaga-originals")
ask SUPABASE_SERVICE_ROLE_KEY "Supabase > Project Settings > API Keys > secret / service_role" 1
ask R2_ACCESS_KEY_ID "Cloudflare R2 > Manage API tokens (permiso Object Read & Write sobre rafaga-originals)" 0
ask R2_SECRET_ACCESS_KEY "el secreto del mismo token de R2" 1
ask GROQ_API_KEY "console.groq.com/keys" 1
ask DEEPGRAM_API_KEY "opcional" 1
ask GOOGLE_CLIENT_ID "opcional (YouTube/Drive)" 0
ask GOOGLE_CLIENT_SECRET "opcional" 1
ask DROPBOX_CLIENT_ID "opcional" 0
ask DROPBOX_CLIENT_SECRET "opcional" 1
ask TIKTOK_CLIENT_KEY "opcional" 0
ask TIKTOK_CLIENT_SECRET "opcional" 1
WAKE=$(openssl rand -hex 32)
args+=("WAKE_SECRET=$WAKE")
printf %s "$WAKE" | pbcopy
echo; echo "WAKE_SECRET generado y copiado al portapapeles (pégalo en Vercel como WAKE_SECRET; no lo copies antes de eso)."
"$MODAL" secret create rafaga-worker "${args[@]}" --force && echo "Secreto rafaga-worker creado."
