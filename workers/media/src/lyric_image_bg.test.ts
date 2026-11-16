import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { validateLyricComposition, lyricRenderArgs, lyricAss } from "@rafaga/composition";
// Regresión: las fotos JPG como fondo daban yuvj420p y la comprobación del worker rechazaba la variante.
test("un fondo JPG (rango completo) produce MP4 H.264 yuv420p estándar, no yuvj420p", () => {
  const c = validateLyricComposition({ aspect:"9:16",res:720,range:{start:0,end:3},words:[{text:"Hola",start:0.2,end:1,line:0}],preset:"texto_estatico",seed:7,style:{active:"none",entrance:"none"},background:{kind:"media",items:[{ref:"a",kind:"image"}],interval:3,fit:"fill"}});
  const d=new URL("../../../.fixtures/",import.meta.url).pathname; writeFileSync("/tmp/x.ass", lyricAss(c));
  const r = spawnSync("ffmpeg", lyricRenderArgs(c,{audio:d+"song_wav.wav",items:[d+"bg/fondo1.jpg"],ass:"/tmp/x.ass",fontsDir:"apps/web/public/fonts/caption",out:"/tmp/y.mp4"}),{encoding:"utf8"});
  assert.equal(r.status,0,r.stderr.slice(-400));
  const p = spawnSync("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=pix_fmt","-of","csv=p=0","/tmp/y.mp4"],{encoding:"utf8"}).stdout.trim();
  assert.equal(p,"yuv420p");
});
