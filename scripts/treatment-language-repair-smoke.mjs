import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function compileModule(source, context = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, ...context });
  return module.exports;
}

const semantics = compileModule(
  fs.readFileSync(new URL("../lib/brief-semantics.ts", import.meta.url), "utf8")
);
const language = compileModule(
  fs.readFileSync(new URL("../lib/language-quality.ts", import.meta.url), "utf8")
);
const aiVideoSource = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const repairSource = aiVideoSource.slice(
  aiVideoSource.indexOf("function isChineseTreatment"),
  aiVideoSource.indexOf("function shouldLocallyRepairNarrationLine")
);
assert.ok(repairSource.includes("function locallyRepairTreatmentLanguage"));

const repairModule = compileModule(`${repairSource}\nmodule.exports = { locallyRepairTreatmentLanguage };`, {
  detectBriefDomain: semantics.detectBriefDomain,
  looksSimplifiedChineseLocalized: language.looksSimplifiedChineseLocalized,
  requiredNamedBriefSubject: semantics.requiredNamedBriefSubject
});

const treatment = {
  workingTitle: "Risk Governance Platform Overview",
  language: "中文",
  audience: "enterprise teams",
  corePromise: "clearer risk decisions",
  commercialBrief: {
    subject: "VYBEA",
    category: "enterprise risk governance platform",
    audience: "project teams",
    customerProblem: "scattered project risk signals",
    offering: "traceable decision records",
    differentiators: ["approval gates", "evidence packets", "accountability chain"],
    proofPoints: ["reviewable records"],
    outcomes: ["clearer decisions", "traceable delivery"],
    callToAction: "start a review"
  },
  creativeConcept: "linked checkpoints",
  narrativeArc: "problem to proof",
  visualBible: {
    world: "governance studio",
    artDirection: "clean business film",
    palette: ["#111111", "#eeeeee", "#f5c518"],
    lighting: "soft",
    cameraLanguage: "measured",
    recurringMotif: "linked gates",
    avoid: ["text", "logos"]
  },
  beats: Array.from({ length: 5 }, (_, index) => ({
    purpose: `beat ${index + 1}`,
    sourceFact: "traceable decision records",
    narrationLine: "This video explains how the platform manages risk for project teams.",
    emotionalBeat: "confident",
    visualAnchor: "gate",
    transition: "match cut"
  }))
};

const repaired = repairModule.locallyRepairTreatmentLanguage(
  treatment,
  30,
  "请为 VYBEA 制作企业风险治理平台介绍片",
  { language: "中文" }
);
assert.equal(repaired.workingTitle, "VYBEA 产品介绍");
assert.equal(repaired.beats.length, treatment.beats.length);
assert(repaired.beats.every((beat) => language.looksSimplifiedChineseLocalized(beat.narrationLine)));
assert(repaired.beats.every((beat) => !/this video|platform manages risk/iu.test(beat.narrationLine)));

const repairedWithLongerScenes = repairModule.locallyRepairTreatmentLanguage(
  treatment,
  90,
  "请为 VYBEA 制作企业风险治理平台介绍片",
  { language: "中文" }
);
assert(repairedWithLongerScenes.beats.every((beat) => !/start a review/iu.test(beat.narrationLine)));

const untouched = repairModule.locallyRepairTreatmentLanguage(
  treatment,
  30,
  "Create a VYBEA product film",
  { language: "英文" }
);
assert.equal(untouched, treatment);

console.log("Treatment language repair smoke checks passed.");
