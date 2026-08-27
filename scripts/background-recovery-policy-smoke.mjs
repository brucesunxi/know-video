import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/background-recovery-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports });

const {
  backgroundImageAttemptPlan,
  canContinueAfterSceneQualityFailure,
  MAX_PROJECT_MEDIA_RECOVERY_PASSES,
  nextProjectRecoveryPass
} = module.exports;

assert.deepEqual(
  { ...backgroundImageAttemptPlan({ deliveryCount: 1, requiresPremium: false }) },
  {
    completionRescue: false,
    recoveryCycle: false,
    requestedQuality: "standard",
    maxQualityAttempts: 2,
    useStockContentGuide: false
  }
);
assert.deepEqual(
  { ...backgroundImageAttemptPlan({ deliveryCount: 2, requiresPremium: false }) },
  {
    completionRescue: true,
    recoveryCycle: false,
    requestedQuality: "premium",
    maxQualityAttempts: 2,
    useStockContentGuide: true
  }
);
assert.deepEqual(
  { ...backgroundImageAttemptPlan({ deliveryCount: 1, recoveryPass: 1, requiresPremium: false }) },
  {
    completionRescue: true,
    recoveryCycle: true,
    requestedQuality: "premium",
    maxQualityAttempts: 2,
    useStockContentGuide: true
  }
);
assert.equal(canContinueAfterSceneQualityFailure(1, 0), false);
assert.equal(canContinueAfterSceneQualityFailure(2, 0), true);
assert.equal(canContinueAfterSceneQualityFailure(1, 1), true);
assert.equal(nextProjectRecoveryPass(), 1);
assert.equal(nextProjectRecoveryPass(1), 2);
assert.equal(MAX_PROJECT_MEDIA_RECOVERY_PASSES, 2);

console.log("Background recovery policy smoke checks passed.");
