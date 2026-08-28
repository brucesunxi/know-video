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
