import { test } from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, kitFromTemplate } from "./templates.ts";
import { PRESETS } from "./subtitles.ts";
import { LOOKS } from "../../lyrics/src/looks.ts";

test("8 plantillas distintas con referencias válidas (presets y looks existen)", () => {
  assert.equal(TEMPLATES.length, 8); assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, 8);
  for (const t of TEMPLATES) {
    if (t.subtitle) assert.ok(PRESETS[t.subtitle], `${t.id}: preset de subtítulos ${t.subtitle}`);
    if (t.lyric?.look) assert.ok(LOOKS[t.lyric.look], `${t.id}: look ${t.lyric.look}`);
    if (t.lyric?.style) assert.ok(PRESETS[t.lyric.style], `${t.id}: estilo de letra ${t.lyric.style}`);
    assert.ok(t.ratios.length >= 1); assert.ok(t.description.length > 20);
    const k = kitFromTemplate(t); assert.equal(k.name, t.name); assert.ok(JSON.stringify(k).length < 8000);
  }
  assert.equal(new Set(TEMPLATES.map((t) => `${t.subtitle}|${t.lyric?.look}|${t.lyric?.style}|${t.layout}`)).size, 8, "ninguna es copia de otra");
  assert.ok(TEMPLATES.filter((t) => t.note).length >= 2, "las limitaciones se declaran");
});
