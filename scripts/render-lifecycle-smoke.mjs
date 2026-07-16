import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../lib/render-lifecycle.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022
  }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, { module, exports: module.exports, require: () => ({}) });
const { matchesRenderSandbox, publicRenderError, renderOutputKey, renderSandboxName } = module.exports;

const jobId = "d90dc514-7d0d-491e-994f-e52c6916cb68";
assert.equal(renderSandboxName(jobId), `know-video-job-${jobId}`);
assert.equal(renderOutputKey({
  id: jobId,
  projectId: "04c0432b-9f15-4c46-ae24-9163aa612284",
  versionId: "ee31d129-ff72-4dc5-a091-4867db85a262"
}), `renders/04c0432b-9f15-4c46-ae24-9163aa612284/ee31d129-ff72-4dc5-a091-4867db85a262/${jobId}.mp4`);
assert.equal(matchesRenderSandbox(jobId, renderSandboxName(jobId)), true);
assert.equal(matchesRenderSandbox(jobId, "know-video-job-another"), false);
assert.equal(matchesRenderSandbox(jobId), true);
assert.match(publicRenderError("failed"), /视频合成/);
assert.match(publicRenderError("cancelled"), /重新导出/);
assert.equal(publicRenderError("ready"), undefined);

console.log("Render lifecycle smoke checks passed.");
