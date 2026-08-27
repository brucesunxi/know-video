import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/image-completion-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });

const { imageCompletionFallbackScore, shouldUseImageCompletionFallback } = module.exports;
const orderedReasons = [
  "semantic_mismatch",
  "semantic_check_failed",
  "style_mismatch"
];

const scores = orderedReasons.map(imageCompletionFallbackScore);
assert.deepEqual(scores, [...scores].sort((left, right) => left - right));
assert.equal(new Set(scores).size, scores.length);
assert.ok(imageCompletionFallbackScore("style_mismatch") > imageCompletionFallbackScore("semantic_mismatch"));
assert.doesNotMatch(source, /composition_duplicate|semantic_pass_style|technical_only|text_detected|combined_text_disagreement|text_free_nonduplicate/);
assert.equal(shouldUseImageCompletionFallback(undefined, { seed: 1, prompt: "a", score: 10 }), true);
assert.equal(shouldUseImageCompletionFallback(
  { seed: 1, prompt: "a", score: 50 },
  { seed: 1, prompt: "a", score: 45 }
), true, "a later verdict must be able to downgrade the same candidate");
assert.equal(shouldUseImageCompletionFallback(
  { seed: 1, prompt: "a", score: 50 },
  { seed: 2, prompt: "b", score: 25 }
), false, "a weaker different candidate must not replace the retained frame");
assert.equal(shouldUseImageCompletionFallback(
  { seed: 1, prompt: "a", score: 50 },
  { seed: 2, prompt: "b", score: 70 }
), true, "a stronger different candidate must replace the retained frame");

console.log("Image completion fallback policy smoke checks passed.");
