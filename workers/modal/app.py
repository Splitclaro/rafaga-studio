"""Ráfaga Studio — worker en Modal. Envoltorio fino: la lógica vive en node workers/media/src/stage.ts."""
import hmac, json, os, subprocess
import modal
try:  # FastAPI solo existe en la imagen; `modal deploy` importa este archivo en local sin ella.
    from fastapi import Header, HTTPException
except ImportError:  # pragma: no cover
    Header = None
    HTTPException = None

NODE_VERSION = "24.22.3"
NODE_TARBALL = f"node-v{NODE_VERSION}-linux-x64.tar.xz"
FF_TAG = "autobuild-2026-11-10-12-39"
FF_FILE = "ffmpeg-n9.0.2-48-gd4070a14ce-linux64-gpl-9.0.tar.xz"
FF_SHA256 = "8206a48ce342b5075d0e0293e468a61198a55b3ef479bec3f7e83b04a18667d4"
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAX_PARALLEL = 4
WAKE_HEADER = "X-Rafaga-Wake"  # FastAPI lo entrega en el parámetro x_rafaga_wake
FN_ENV = {"ASR_PROVIDER": "groq", "RAFAGA_CPU_CORES": "2", "RAFAGA_MEM_GIB": "4", "PYTHON_BIN": "python3"}

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ca-certificates", "curl", "xz-utils", "fonts-liberation")
    .run_commands(
        f"curl -fsSLO https://nodejs.org/dist/v{NODE_VERSION}/{NODE_TARBALL}",
        f"curl -fsSLO https://nodejs.org/dist/v{NODE_VERSION}/SHASUMS256.txt",
        f"grep ' {NODE_TARBALL}$' SHASUMS256.txt | sha256sum -c -",
        f"tar -xJf {NODE_TARBALL} -C /usr/local --strip-components=1",
        "npm install -g pnpm@12.18.0",
        f"curl -fsSLo /tmp/{FF_FILE} https://github.com/BtbN/FFmpeg-Builds/releases/download/{FF_TAG}/{FF_FILE}",
        f"echo '{FF_SHA256}  /tmp/{FF_FILE}' | sha256sum -c -",
        f"tar -xJf /tmp/{FF_FILE} -C /usr/local/bin --strip-components=2 --wildcards '*/bin/ffmpeg' '*/bin/ffprobe'",
    )
    .pip_install("opencv-python-headless==4.10.0.84", "numpy<2.1", "fastapi[standard]")
    # modal 1.6.4: add_local_dir(local_path, remote_path, *, copy=False, ignore=[...]) (firma leída del paquete instalado)
    .add_local_dir(REPO, remote_path="/repo", copy=True,
                   ignore=["**/node_modules", "**/.next", ".git", "**/.fixtures", "blueprints", "**/*.mp4", "**/*.mov"])
    .run_commands("cd /repo && pnpm install --frozen-lockfile")
)
app = modal.App("rafaga-worker")
secret = modal.Secret.from_name("rafaga-worker")
wake_secret = modal.Secret.from_name("rafaga-wake")  # solo WAKE_SECRET; el último secreto prevalece

import re as _re

def _clean(v):
    """Quita secuencias de teclado pegadas por error y una clave duplicada (misma mitad dos veces)."""
    v = _re.sub(r"\x1b\[[0-9;]*[A-Za-z~]", "", v).strip()
    h = len(v) // 2
    return v[:h] if len(v) % 2 == 0 and h > 8 and v[:h] == v[h:] else v

def _env():
    e = {k: _clean(x) for k, x in os.environ.items()}
    if "SUPABASE_SERVICE_ROLE_KEY" in e:  # run.ts exige SUPABASE_SECRET_KEY; stage.ts acepta ambas
        e.setdefault("SUPABASE_SECRET_KEY", e["SUPABASE_SERVICE_ROLE_KEY"])
    return {**e, **FN_ENV}

def _node(*args, timeout):  # solo opciones que imprime `stage.ts --list-flags`
    return subprocess.run(["node", "workers/media/src/stage.ts", *args], cwd="/repo", env=_env(),
                          timeout=timeout, capture_output=True, text=True)

def _plan_and_spawn():
    out = _node("--plan", timeout=60)
    plan = json.loads(out.stdout or "{}") if out.returncode == 0 else {}
    for _ in range(min(int(plan.get("ready", 0)), MAX_PARALLEL)):
        drain.spawn()
    if int(plan.get("legacy", 0)) > 0:
        run_legacy.spawn()
    return plan

@app.function(image=image, secrets=[secret], cpu=2.0, memory=4096, timeout=3600, max_containers=MAX_PARALLEL)   # tope duro de contenedores: protege el presupuesto de 1 USD
def drain():
    return _node("--drain", "--max-idle-s", "60", timeout=3540).returncode

@app.function(image=image, secrets=[secret], cpu=2.0, memory=4096, timeout=3600, max_containers=1)
def run_legacy():  # tipos v1 durante la coexistencia; mismo código que en Actions
    return subprocess.run(["node", "src/run.ts"], cwd="/repo/workers/media", env=_env(), timeout=3540).returncode

@app.function(image=image, secrets=[secret, wake_secret], timeout=60)
@modal.fastapi_endpoint(method="POST")
def dispatch(body: dict, x_rafaga_wake: str | None = (Header(default=None) if Header else None)):
    if not hmac.compare_digest((x_rafaga_wake or "").encode(), os.environ["WAKE_SECRET"].encode()):
        raise HTTPException(status_code=401, detail="bad_wake_secret")
    return {"accepted": True, "plan": _plan_and_spawn()}

@app.function(image=image, secrets=[secret], timeout=120, schedule=modal.Period(minutes=3))
def sweeper():
    _node("--sweep", timeout=60)  # sweep_stale + enqueue_due_publications
    _plan_and_spawn()
    try:
        _node("--purge", timeout=120)  # eliminaciones de proyecto pedidas por el usuario (borrado inmediato)
    except Exception as e:  # nunca debe romper el barrido
        print("purga:", str(e)[:200])

@app.function(image=image, secrets=[secret], timeout=1800, schedule=modal.Period(days=1))
def keep_alive():
    _node("--keep-alive", timeout=60)  # evita la pausa de Supabase Free (además del barrido por minuto)
    _node("--purge", timeout=1700)     # retención (paso 18)
