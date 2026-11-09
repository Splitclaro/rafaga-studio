import { task } from "@trigger.dev/sdk";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir, cpus, totalmem, freemem } from "node:os";
import { join } from "node:path";
import { buildAss, PRESET_IMPACTO } from "@rafaga/composition";

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
  return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
};

/** Spike de runtime (encargo §7/§12-B): ¿hay libass, fuentes, libx264 y recursos suficientes en Trigger cloud? */
export const runtimeCheck = task({
  id: "runtime-check",
  run: async () => {
    const dir = mkdtempSync(join(tmpdir(), "rc-"));
    const words = [
      { text: "Mañana", start: 0, end: 0.5 }, { text: "empieza", start: 0.5, end: 1 },
      { text: "tu", start: 1, end: 1.2 }, { text: "canción", start: 1.2, end: 1.9 },
    ];
    const assPath = join(dir, "t.ass");
    writeFileSync(assPath, buildAss(words, { ...PRESET_IMPACTO, fontName: "Liberation Sans" }, { width: 1080, height: 1920 }));
    const filters = run("ffmpeg", ["-hide_banner", "-filters"]).out;
    const out = join(dir, "o.mp4");
    const t0 = Date.now();
    const r = run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x303640:s=1080x1920:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-vf", `subtitles=${assPath}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", out]);
    return {
      ffmpegVersion: run("ffmpeg", ["-version"]).out.split("\n")[0],
      hasSubtitlesFilter: /\bsubtitles\b/.test(filters),
      hasAss: /\bass\b/.test(filters),
      renderExit: r.code, renderErr: r.out.slice(0, 400), renderMs: Date.now() - t0,
      outBytes: r.code === 0 ? statSync(out).size : 0,
      fonts: run("fc-list", [":family"]).out.split("\n").slice(0, 8),
      cpus: cpus().length, totalMemMB: Math.round(totalmem() / 1048576), freeMemMB: Math.round(freemem() / 1048576),
      disk: run("df", ["-m", tmpdir()]).out,
    };
  },
});
