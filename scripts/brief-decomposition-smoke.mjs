import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const semanticsSource = fs.readFileSync(new URL("../lib/brief-semantics.ts", import.meta.url), "utf8");
const semanticsOutput = ts.transpileModule(semanticsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(semanticsOutput, { module, exports: module.exports });
const {
  extractBriefFacts,
  extractBriefSubject,
  isProductionInstructionClause
} = module.exports;

const mixedBrief = "请为 VYBEA 制作一个 30 秒企业产品介绍视频，风格高级、节奏明快、适合官网首屏。VYBEA 是面向娱乐 IP 的项目级责任治理平台。它帮助团队把分散风险信号转化为可审查证据和可追溯决策。";
const facts = Array.from(extractBriefFacts(mixedBrief, true));
assert.equal(extractBriefSubject(mixedBrief, true), "VYBEA");
assert.equal(facts.some((fact) => /30\s*秒|官网首屏|风格高级/u.test(fact)), false);
assert.equal(facts.some((fact) => fact.includes("项目级责任治理平台")), true);
assert.equal(facts.some((fact) => fact.includes("可审查证据")), true);

const commaBrief = "生成一个30秒横屏介绍片，风格高级，VYBEA 是项目治理平台，帮助娱乐团队追踪授权和风险";
const commaFacts = Array.from(extractBriefFacts(commaBrief, true));
assert.equal(commaFacts.some((fact) => /30秒|横屏|风格高级/u.test(fact)), false);
assert.equal(commaFacts.some((fact) => fact.includes("VYBEA 是项目治理平台")), true);
assert.equal(commaFacts.some((fact) => fact.includes("追踪授权和风险")), true);

const listPunctuationBrief = "请制作产品视频，30秒、横屏、适合官网首屏，产品帮助销售团队自动整理客户线索";
const listPunctuationFacts = Array.from(extractBriefFacts(listPunctuationBrief, true));
assert.equal(listPunctuationFacts.some((fact) => /30秒|横屏|官网首屏/u.test(fact)), false);
assert.equal(listPunctuationFacts.some((fact) => fact.includes("自动整理客户线索")), true);

assert.equal(isProductionInstructionClause("视频时长：30 秒"), true);
assert.equal(isProductionInstructionClause("Know Video 是 AI 视频生成平台"), false);
assert.equal(isProductionInstructionClause("帮助企业快速完成品牌内容制作"), false);

const aiVideo = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
const videoBrain = fs.readFileSync(new URL("../lib/video-brain.ts", import.meta.url), "utf8");
assert.match(aiVideo, /commercialBrief: z\.object/);
assert.match(aiVideo, /narrationLine: z\.string/);
assert.match(aiVideo, /voiceover: treatment\.beats\[index\]\?\.narrationLine/);
assert.match(aiVideo, /copy treatment\.beats\[N-1\]\.narrationLine into voiceover exactly/);
assert.match(aiVideo, /production instruction rather than the promoted company or product/);
assert.match(aiVideo, /one or more locked narration lines exceed their scene-level spoken-time budget/);
assert.match(aiVideo, /locked narration is too sparse for the requested video duration/);
assert.match(aiVideo, /one or more locked narration lines are too sparse to carry their scene/);
assert.match(aiVideo, /preserveNarration: true/);
assert.match(aiVideo, /cannot fit the requested integer scene durations without truncation/);
assert.doesNotMatch(aiVideo, /Falling back to heuristic storyboard/);
assert.doesNotMatch(videoBrain, /briefFacts\[index %/);

console.log("Commercial brief decomposition smoke checks passed.");
