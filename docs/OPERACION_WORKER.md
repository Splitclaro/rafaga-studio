# Operación del procesador (worker)

El procesador corre en GitHub Actions (`media-worker`). Un job espera en la cola de Supabase hasta que un worker lo recoge. El worker queda en marcha 10 min tras el último trabajo, así que los siguientes se procesan en segundos.

## Por qué esperaba horas
`cron: */5` no es fiable en GitHub: en este repositorio lanzó el worker cada ~6–7 h. La única forma de arrancar al instante es despertarlo al subir un vídeo (`/api/wake` → `workflow_dispatch`).

## Activar el despertador (una vez, ~3 min)
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens → Generate new token**.
   - Repository access: solo `Splitclaro/rafaga-studio`.
   - Repository permissions: **Actions → Read and write**. Nada más.
   - Expiración: la que prefieras (se renueva igual).
2. Copia el token.
3. Vercel → proyecto `rafaga-studio` → Settings → Environment Variables → añade **`GH_DISPATCH_TOKEN`** (Production) con ese valor → **Redeploy**.
4. Comprueba: sube un vídeo; la página del proyecto debe decir «Arrancando el procesador (≈1 min)» y terminar en 1–2 min.

## Mientras tanto (manual)
GitHub → Actions → `media-worker` → **Run workflow**.

## Tiempos medidos
- Arranque en frío del worker: ~25 s (con cachés).
- Proyecto de 1:40: ~53 s de punta a punta con el worker arrancado.
