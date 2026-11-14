import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeOf } from "./grades.ts";
test("gradeOf: bandas de 0–10 a letra", () => {
  assert.deepEqual([10, 9.5, 9, 8.6, 8, 7.5, 7, 6, 5, 4, 0].map(gradeOf), ["A+", "A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D"]);
});
