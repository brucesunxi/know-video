import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/stock-candidate-policy.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  URL,
  require: () => ({})
});

const { evaluateStockCandidate, rankStockCandidates } = module.exports;
const salesScene = {
  title: "Sales introduction for prospects",
  voiceover: "Help sales teams explain the common customer problem and show a successful outcome.",
  visualPrompt: "A professional team meets a prospective customer in a bright office.",
  style: { theme: "clean illustration", mood: "confident" }
};
const candidates = [
  {
    id: "rain",
    query: "business team office meeting",
    pageUrl: "https://www.pexels.com/video/rainy-window-with-night-lights-passing-28911884/"
  },
  {
    id: "hands",
    query: "business team office meeting",
    pageUrl: "https://www.pexels.com/video/silhouette-hands-on-frosted-glass-at-night-37554583/"
  },
  {
    id: "meeting",
    query: "business team office meeting",
    pageUrl: "https://www.pexels.com/video/professional-business-team-having-a-meeting-in-office-12345/"
  }
];

const ranked = rankStockCandidates(salesScene, candidates, "sales-scene");
assert.deepEqual(Array.from(ranked, ({ candidate }) => candidate.id), ["meeting"]);
assert.equal(ranked[0].evaluation.locallyTrusted, true);
assert.equal(evaluateStockCandidate(salesScene, candidates[0]).safe, false);
assert.equal(evaluateStockCandidate(salesScene, candidates[1]).safe, false);

const library = evaluateStockCandidate({
  title: "Library introduction",
  voiceover: "Readers find books and study together.",
  visualPrompt: "A reader chooses a book between library shelves.",
  style: { theme: "bright documentary", mood: "welcoming" }
}, {
  query: "library bookshelves people reading",
  pageUrl: "https://www.pexels.com/photo/reader-choosing-a-book-in-a-library-54321/",
  description: "A reader choosing a book between library bookshelves"
});
assert.equal(library.safe, true);
assert.equal(library.locallyTrusted, true);
assert.ok(library.relevanceScore >= 10);

const constructionSafety = evaluateStockCandidate({
  title: "Job-site safety briefing",
  voiceover: "工人入场前检查安全帽、防护背心和安全绳。",
  visualPrompt: "A construction worker performs a complete PPE inspection in daylight.",
  style: { theme: "cinematic documentary", mood: "calm and professional" }
}, {
  query: "construction workers safety equipment inspection",
  pageUrl: "https://www.pexels.com/photo/construction-worker-checking-safety-equipment-76543/",
  description: "Construction worker checking helmet vest and safety harness at a daylight worksite"
});
assert.equal(constructionSafety.safe, true);
assert.equal(constructionSafety.locallyTrusted, true);
assert.ok(constructionSafety.relevanceScore >= 10);

const salesContext = "Sales introduction for prospects. Help sales teams explain a customer problem and reach a successful business outcome.";
const chineseSalesContext = "面向潜在客户的销售介绍，帮助销售团队解释客户问题并展示企业服务成果。";
const contextualMeeting = evaluateStockCandidate(salesScene, {
  query: "business team office meeting",
  pageUrl: "https://pixabay.com/videos/id-39890/",
  tags: ["office", "people", "business", "work", "team", "corporate", "meeting", "planning", "project"]
}, salesContext);
assert.equal(contextualMeeting.locallyTrusted, true);
assert.equal(evaluateStockCandidate(salesScene, {
  query: "business team office meeting",
  pageUrl: "https://pixabay.com/videos/id-39890/",
  tags: ["office", "people", "business", "work", "team", "corporate", "meeting", "planning", "project"]
}, chineseSalesContext).locallyTrusted, true);

const rejectedTexture = evaluateStockCandidate(salesScene, {
  query: "premium business material design",
  pageUrl: "https://pixabay.com/videos/id-121430/",
  tags: ["texture", "pattern", "material", "fabric", "surface", "space", "design", "wallpaper", "black", "grunge", "rough", "backdrop", "wool", "dark"]
}, salesContext);
assert.equal(rejectedTexture.safe, false);
assert.equal(rejectedTexture.locallyTrusted, false);
assert.equal(rejectedTexture.safetyReason, "abstract texture or background footage");

const rejectedBeachDrift = evaluateStockCandidate(salesScene, {
  query: "calm beach sunrise",
  pageUrl: "https://pixabay.com/videos/id-230028/",
  tags: ["seascape", "sand", "beach", "water", "sea", "sunrise", "relaxation", "shore", "ocean", "coast", "island"]
}, salesContext);
assert.equal(rejectedBeachDrift.safe, true);
assert.equal(rejectedBeachDrift.locallyTrusted, false);
assert.equal(evaluateStockCandidate(salesScene, {
  query: "calm beach sunrise",
  pageUrl: "https://pixabay.com/videos/id-230028/",
  tags: ["seascape", "sand", "beach", "water", "sea", "sunrise", "shore", "ocean", "coast"]
}, chineseSalesContext).locallyTrusted, false);

const rejectedOrganicMacro = evaluateStockCandidate(salesScene, {
  query: "business transformation detail",
  pageUrl: "https://example.com/video/microscopic-cell-tissue-surface-42/",
  tags: ["microscopic", "cell", "tissue", "surface"]
}, salesContext);
assert.equal(rejectedOrganicMacro.safe, false);
assert.equal(rejectedOrganicMacro.safetyReason, "potentially disturbing organic macro imagery");

const mobilePhoneCandidate = evaluateStockCandidate({
  title: "Mobile service introduction",
  voiceover: "Customers use a mobile phone to stay connected.",
  visualPrompt: "A customer uses a smartphone in a bright workplace.",
  style: { theme: "documentary", mood: "welcoming" }
}, {
  query: "mobile phone communication",
  pageUrl: "https://example.com/video/cell-phone-mobile-communication-84/",
  tags: ["cell", "phone", "mobile", "communication", "technology"]
}, "Mobile technology service for customers");
assert.equal(mobilePhoneCandidate.safe, true);
assert.equal(mobilePhoneCandidate.locallyTrusted, true);

const weakSingleWordMatch = evaluateStockCandidate(salesScene, {
  query: "business team office meeting",
  pageUrl: "https://www.pexels.com/photo/business-person-outdoors-98765/"
});
assert.equal(weakSingleWordMatch.safe, true);
assert.equal(weakSingleWordMatch.locallyTrusted, false);

const horrorOptIn = evaluateStockCandidate({
  title: "Horror short film",
  voiceover: "A frightening silhouette appears behind the glass.",
  visualPrompt: "Silhouette hands press against frosted glass at night.",
  style: { theme: "horror", mood: "scary" }
}, candidates[1]);
assert.equal(horrorOptIn.safe, true);
assert.equal(evaluateStockCandidate({
  title: "Horror short film",
  voiceover: "A frightening silhouette appears behind the glass.",
  visualPrompt: "Silhouette hands press against frosted glass at night.",
  style: { theme: "horror", mood: "scary" }
}, {
  query: "haunted house suspense",
  pageUrl: "https://www.pexels.com/video/bloody-knife-at-a-crime-scene-45678/"
}).safe, false);

console.log("Stock candidate safety and relevance checks passed.");
