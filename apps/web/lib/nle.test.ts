import { test } from "node:test";
import assert from "node:assert/strict";
import { clipsToXmeml } from "./nle.ts";

test("clipsToXmeml: secuencia con un clipitem por clip, tiempos en fotogramas y nombres escapados", () => {
  const x = clipsToXmeml({ project: "Mi <vídeo> & co", source: { name: "original 1.mp4", durationMs: 151_000, width: 1920, height: 1080 }, fps: 30,
    clips: [{ title: "Uno \"A\"", startMs: 0, endMs: 28_000 }, { title: "Dos", startMs: 28_000, endMs: 56_000 }, { title: "vacío", startMs: 5, endMs: 5 }] });
  assert.match(x, /^<\?xml version="1.0"/); assert.ok(x.includes("<xmeml version=\"4\">"));
  assert.ok(x.includes("Mi &lt;vídeo&gt; &amp; co") && x.includes("Uno &quot;A&quot;"));
  assert.equal((x.match(/<clipitem id="v-/g) ?? []).length, 2); assert.equal((x.match(/<clipitem id="a-/g) ?? []).length, 2);   // el clip de duración 0 se omite
  assert.ok(x.includes("<in>0</in><out>840</out>") && x.includes("<start>840</start><end>1680</end>"));
  assert.ok(x.includes("<sequence id=\"sequence-1\"><name>Mi &lt;vídeo&gt; &amp; co</name><duration>1680</duration>"));
  assert.equal((x.match(/<file id="file-1">/g) ?? []).length, 1);   // el archivo se define una vez y se referencia después
  assert.ok(x.includes("original%201.mp4"));
});
