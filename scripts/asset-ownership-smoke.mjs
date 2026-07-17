import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/scene-assets.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const queries = [];
const sql = async (strings) => {
  const query = strings.join("?").replace(/\s+/g, " ").trim();
  queries.push(query);
  return query.startsWith("select s.id") ? [{ id: "current-scene" }] : [];
};
const module = { exports: {} };
vm.runInNewContext(output, {
  crypto: { randomUUID: () => "asset-id" },
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "@/lib/db") return { getSql: () => sql, hasDatabaseUrl: () => true };
    if (specifier === "@/lib/asset-policy") return { replacementAssetTypes: () => ["image", "clip"], uploadedAssetType: () => "image" };
    if (specifier === "@/lib/r2") return { assetUrlForKey: (key) => `/api/assets/${key}` };
    if (specifier === "@/lib/render-jobs") return { invalidateVersionRender: async () => undefined };
    if (specifier === "@/lib/storage-cleanup") return { deleteUnreferencedStorageObjects: async () => undefined };
    throw new Error(`Unexpected import: ${specifier}`);
  }
});

const { detachSceneAsset, findOwnedScene } = module.exports;
assert.equal(await findOwnedScene({ projectId: "project", versionId: "version", sceneNumber: 2 }), "current-scene");
assert.match(queries[0], /join projects p on p\.id = pv\.project_id/);
assert.match(queries[0], /p\.current_version_id = \?/);

await detachSceneAsset({ projectId: "project", versionId: "version", sceneNumber: 2, assetId: "asset" });
assert.match(queries[1], /using scenes s, project_versions pv, projects p/);
assert.match(queries[1], /p\.id = pv\.project_id/);
assert.match(queries[1], /p\.current_version_id = \?/);

console.log("Scene asset ownership smoke passed.");
