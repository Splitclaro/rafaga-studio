import { test } from "node:test";
import assert from "node:assert/strict";
import { feedbackHint } from "./select.ts";

const ctxWith = (r: unknown) => ({ rpc: async () => r }) as never;
test("feedbackHint: describe lo descartado y lo que gustó; sin señal o con error devuelve vacío", async () => {
  const h = await feedbackHint(ctxWith({ disliked: [{ title: "Anécdota larga", reason: "cuenta una historia" }], liked: [{ title: "Consejo claro", reason: "" }] }), "p");
  assert.match(h, /DESCARTÓ.*«Anécdota larga» \(cuenta una historia\)/); assert.match(h, /GUSTARON.*«Consejo claro»/);
  assert.equal(await feedbackHint(ctxWith({ disliked: [], liked: [] }), "p"), "");
  assert.equal(await feedbackHint({ rpc: async () => { throw new Error("x"); } } as never, "p"), "");
});
