import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/image-candidates.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

let generatedProject;
let persisted;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  crypto: webcrypto,
  require: (name) => {
    if (name === "@/lib/image-assets") return {
      generateProjectSceneImages: async () => generatedProject
    };
    if (name === "@/lib/project-mutations") return {
      persistGeneratedSceneAssets: async (...args) => { persisted = args; }
    };
    throw new Error(`Unexpected import: ${name}`);
  }
});
const { CandidateImageError, generateSceneImageCandidate } = module.exports;

const image = { id: "image", type: "image", r2Key: "image.png", url: "https://example.com/image.png" };
const project = {
  id: "project",
  currentVersion: {
    id: "version",
    scenes: [{ id: "scene", sceneNumber: 1, assets: [image] }]
  }
};

await assert.rejects(
  () => generateSceneImageCandidate(project, { sceneNumber: 2, quality: "standard" }),
  (error) => error instanceof CandidateImageError && error.status === 404
);
await assert.rejects(
  () => generateSceneImageCandidate({ ...project, currentVersion: { ...project.currentVersion, scenes: [{ ...project.currentVersion.scenes[0], assets: [] }] } }, { sceneNumber: 1, quality: "standard" }),
  (error) => error instanceof CandidateImageError && error.status === 409
);
const fullScene = {
  ...project.currentVersion.scenes[0],
  assets: [image, ...[1, 2, 3].map((index) => ({ id: `candidate-${index}`, type: "thumbnail", r2Key: `candidate-${index}.png`, url: "https://example.com/candidate.png", metadata: { candidate: true } }))]
};
await assert.rejects(
  () => generateSceneImageCandidate({ ...project, currentVersion: { ...project.currentVersion, scenes: [fullScene] } }, { sceneNumber: 1, quality: "standard" }),
  (error) => error instanceof CandidateImageError && error.status === 409
);

const candidate = { id: "candidate-new", type: "thumbnail", r2Key: "candidate-new.png", url: "https://example.com/candidate-new.png", metadata: { candidate: true } };
generatedProject = {
  ...project,
  currentVersion: {
    ...project.currentVersion,
    scenes: [{ ...project.currentVersion.scenes[0], assets: [image, candidate] }]
  }
};
const result = await generateSceneImageCandidate(project, { sceneNumber: 1, instruction: "更明亮", quality: "standard" });
assert.equal(result.candidate.id, "candidate-new");
assert.equal(persisted[0], "version");
assert.deepEqual(JSON.parse(JSON.stringify(persisted[2])), { invalidateRender: false, sceneNumbers: [1] });

console.log("Image candidate service smoke checks passed.");
