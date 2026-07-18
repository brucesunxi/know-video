import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022
};

function loadTypeScript(source, dependencies = {}) {
  const module = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions }).outputText;
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    require: (specifier) => dependencies[specifier] ?? {}
  });
  return module.exports;
}

const attachmentSource = fs.readFileSync(new URL("../lib/attachment-context.ts", import.meta.url), "utf8");
const attachments = loadTypeScript(attachmentSource);

const uploadedImage = {
  id: "uploaded-image",
  type: "image",
  url: "https://assets.example/reference.webp",
  r2Key: "uploads/reference.webp",
  metadata: {
    source: "user-upload",
    name: "product-reference.webp",
    contentType: "image/webp"
  }
};
const uploadedAudio = {
  id: "uploaded-audio",
  type: "audio",
  url: "https://assets.example/narration.wav",
  r2Key: "uploads/narration.wav",
  metadata: {
    source: "user-upload",
    name: "founder-narration.wav",
    contentType: "audio/wav"
  }
};
const generatedImage = {
  id: "generated-image",
  type: "image",
  url: "https://assets.example/generated.webp",
  r2Key: "generated/scene.webp",
  metadata: { source: "cloudflare-ai" }
};
const scene = {
  id: "scene-2",
  sceneNumber: 2,
  title: "Product reveal",
  voiceover: "Meet the product.",
  visualPrompt: "A clean product close-up.",
  motionPrompt: "Slow push in.",
  durationSeconds: 6,
  style: { theme: "clean", palette: ["#ffffff", "#111111"], mood: "confident" },
  assets: [uploadedImage, uploadedAudio, generatedImage]
};

assert.deepEqual(Array.from(attachments.userAttachmentAssets(scene), (asset) => asset.id), ["uploaded-image", "uploaded-audio"]);
const summary = attachments.sceneAttachmentSummary(scene);
assert.match(summary, /Scene 2 user attachments/);
assert.match(summary, /product-reference\.webp/);
assert.match(summary, /founder-narration\.wav/);
assert.match(summary, /Preserve visible product\/person\/style identity/);
assert.doesNotMatch(summary, /generated\.webp/);

const versionContext = attachments.versionAttachmentContext({
  id: "version-1",
  scenes: [scene, { ...scene, id: "scene-3", sceneNumber: 3, assets: [generatedImage] }]
});
assert.match(versionContext, /User-provided attachment context/);
assert.match(versionContext, /only the scenes that actually need changes/);
assert.doesNotMatch(versionContext, /Scene 3 user attachments/);
assert.equal(attachments.versionAttachmentContext({ id: "empty", scenes: [{ ...scene, assets: [] }] }), "");

const retainedReferenceScene = {
  ...scene,
  assets: [generatedImage],
  style: {
    ...scene.style,
    referenceAssets: [{
      key: uploadedImage.r2Key,
      name: uploadedImage.metadata.name,
      size: 4321,
      contentType: uploadedImage.metadata.contentType
    }]
  }
};
assert.deepEqual(
  Array.from(attachments.sceneReferenceAssets(retainedReferenceScene), (reference) => reference.key),
  [uploadedImage.r2Key]
);
assert.match(attachments.sceneAttachmentSummary(retainedReferenceScene), /product-reference\.webp/);
assert.match(attachments.sceneAttachmentSummary(retainedReferenceScene), /visual identity and composition reference/);

const imageSource = fs.readFileSync(new URL("../lib/image-continuity.ts", import.meta.url), "utf8");
const imageContinuity = loadTypeScript(imageSource, {
  "@/lib/attachment-context": attachments
});
const project = {
  id: "project-1",
  title: "Attached Product",
  currentVersion: { id: "version-1", scenes: [scene] }
};
const prompt = imageContinuity.sceneImagePrompt(scene, project, ["current"]);
assert.match(prompt, /product-reference\.webp/);
assert.match(prompt, /user-provided source material/);

const aiVideoSource = fs.readFileSync(new URL("../lib/ai-video.ts", import.meta.url), "utf8");
assert.match(aiVideoSource, /versionAttachmentContext\(params\.version\)/);
assert.ok((aiVideoSource.match(/\$\{attachmentContext \?/g) ?? []).length >= 2);
assert.match(aiVideoSource, /User-uploaded attachments are authoritative source material/);

const imageAssetsSource = fs.readFileSync(new URL("../lib/image-assets.ts", import.meta.url), "utf8");
assert.match(imageAssetsSource, /sceneReferenceAssets\(scene\)/);
assert.match(imageAssetsSource, /loadSceneImageReference\(anchorTarget\.scene, "current"\)/);
assert.match(imageAssetsSource, /loadSceneImageReference\(scene, "current"\)/);

const generationReferencesSource = fs.readFileSync(new URL("../lib/generation-reference-assets.ts", import.meta.url), "utf8");
assert.match(generationReferencesSource, /referenceAssets:/);
assert.match(generationReferencesSource, /reference\.key !== asset\.r2Key/);

const storageCleanupSource = fs.readFileSync(new URL("../lib/storage-cleanup.ts", import.meta.url), "utf8");
assert.match(storageCleanupSource, /style_json->'referenceAssets'/);
assert.match(storageCleanupSource, /ref->>'key' = candidate\.key/);

const sceneAssetsSource = fs.readFileSync(new URL("../lib/scene-assets.ts", import.meta.url), "utf8");
assert.match(sceneAssetsSource, /remembered_reference/);
assert.match(sceneAssetsSource, /forgotten_reference/);

console.log("Attachment context smoke checks passed.");
