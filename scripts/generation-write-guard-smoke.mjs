import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/project-mutations.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

let current = false;
let invalidations = 0;
const observedQueries = [];
const sql = async (strings) => {
  const query = strings.join("?").replace(/\s+/g, " ").trim();
  observedQueries.push(query);
  if (query.startsWith("select s.id, s.scene_number")) {
    return [{ id: "scene-id", scene_number: 1 }];
  }
  if (query.includes("count(*)::int as scene_count")) {
    return [{ scene_count: 1, visual_count: 1, audio_count: 1 }];
  }
  return [];
};
sql.transaction = async (queries) => [
  current ? [{ id: "project-id" }] : [],
  ...queries.slice(1).map(() => [])
];

const module = { exports: {} };
vm.runInNewContext(output, {
  crypto: { randomUUID: () => "id" },
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "@/lib/db") return { getSql: () => sql, hasDatabaseUrl: () => true };
    if (specifier === "@/lib/render-jobs") return { invalidateVersionRender: async () => { invalidations += 1; } };
    if (specifier === "@/lib/storage-cleanup") return { deleteUnreferencedStorageObjects: async () => undefined };
    if (specifier === "@/lib/r2") return { assetUrlForKey: (key) => key };
    if (specifier === "@/lib/mock-data") return { demoProject: {} };
    return {};
  }
});

const { persistGeneratedSceneAssets } = module.exports;
const scenes = [{
  id: "scene-id",
  sceneNumber: 1,
  title: "标题",
  voiceover: "旁白",
  visualPrompt: "画面",
  motionPrompt: "运镜",
  durationSeconds: 5,
  style: { theme: "电影", palette: ["#000"], mood: "专注" },
  assets: [{ id: "image", type: "image", r2Key: "image.png", url: "/image.png" }]
}];

await assert.rejects(
  () => persistGeneratedSceneAssets("version-id", scenes, { replaceImages: true }),
  /生成的素材未写入旧版本/
);
assert.equal(invalidations, 0);

current = true;
await persistGeneratedSceneAssets("version-id", scenes, { replaceImages: true });
assert.equal(invalidations, 1);
assert(observedQueries.some((query) => /for update/.test(query)));
assert(observedQueries.some((query) => /p\.current_version_id = \?/.test(query)));

console.log("Generated asset version write guard smoke passed.");
