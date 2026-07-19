import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(workspace, /function elapsedGenerationLabel/);
assert.match(workspace, /function generationSpecItems/);
assert.match(workspace, /function GenerationSpecStrip/);
assert.match(workspace, /stage === "generating"\s*\? "新视频制作中"/);
assert.match(workspace, /label: "正在创建新项目"/);
assert.match(workspace, /label: "生成进度自动保存"/);
assert.match(workspace, /projectStatusBadges\(project, source, stage\)/);
assert.match(workspace, /startedAt\?: number/);
assert.match(workspace, /options: GenerationOptions/);
assert.match(workspace, /setGenerationStartedAt\(pending\.startedAt\)/);
assert.match(workspace, /const startedAt = Date\.now\(\)/);
assert.match(workspace, /startedAt=\{generationStartedAt\}/);
assert.match(workspace, /options=\{generationOptions\}/);
assert.match(workspace, /aria-label="生成规格确认"/);
assert.match(workspace, /目标时长/);
assert.match(workspace, /分镜策略/);
assert.match(workspace, /动态策略/);
assert.match(workspace, /className="kv-generation-status-strip"/);
assert.match(workspace, /刷新后继续找回任务/);
assert.match(workspace, /\{Math\.min\(activeIndex \+ 1, steps\.length\)\} \/ \{steps\.length\}/);

assert.match(styles, /\.kv-generation-status-strip/);
assert.match(styles, /\.kv-generation-spec/);
assert.match(styles, /\.kv-generation-spec strong/);
assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*\.kv-generation-status-strip/);
assert.match(styles, /@media \(max-width: 1040px\)[\s\S]*\.kv-generation-spec/);

console.log("Generating screen smoke checks passed.");
