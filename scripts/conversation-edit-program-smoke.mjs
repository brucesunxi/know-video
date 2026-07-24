import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../lib/conversation-edit-program.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;
const module = { exports: {} };
vm.runInNewContext(output, {
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === "zod") return require("zod");
    return {};
  }
});

const {
  canonicalConversationDirectAction,
  canonicalConversationOperations,
  conversationEditProgramSchema
} = module.exports;
const scenes = [
  { id: "11111111-1111-4111-8111-111111111111", sceneNumber: 1, title: "问题" },
  { id: "22222222-2222-4222-8222-222222222222", sceneNumber: 2, title: "库存告警" },
  { id: "33333333-3333-4333-8333-333333333333", sceneNumber: 3, title: "解决方案" }
];
const program = conversationEditProgramSchema.parse({
  classification: "mixed",
  understoodRequest: "删除库存告警场景，并把解决方案放到开头，再把旁白改得更有力。",
  operations: [
    {
      operation: "delete",
      sceneId: scenes[1].id,
      sceneNumber: 99
    },
    {
      operation: "move-to",
      sceneId: scenes[2].id,
      sceneNumber: 88,
      targetSceneId: scenes[0].id,
      targetSceneNumber: 77
    },
    {
      operation: "insert",
      sceneId: scenes[2].id,
      sceneNumber: 66,
      placement: "after",
      scene: {
        title: "行动建议",
        voiceover: "现在就统一库存规则。",
        visualPrompt: "A clear inventory action workflow without embedded text.",
        motionPrompt: "Push forward through the workflow.",
        durationSeconds: 4
      }
    }
  ],
  remainingInstruction: "把全片旁白改得更有力。",
  confidence: 0.96
});
const operations = canonicalConversationOperations(program, { scenes });
assert.equal(operations[0].sceneNumber, 2);
assert.equal(operations[1].sceneNumber, 3);
assert.equal(operations[1].targetSceneNumber, 1);
assert.equal(operations[2].sceneNumber, 3);
assert.equal(operations[2].scene.title, "行动建议");
assert.equal(program.remainingInstruction, "把全片旁白改得更有力。");

const candidateProgram = conversationEditProgramSchema.parse({
  classification: "content",
  understoodRequest: "为当前选中的库存告警场景生成一张候选图，不要替换。",
  operations: [],
  directAction: {
    kind: "visual-candidate",
    sceneId: scenes[1].id,
    sceneNumber: 99,
    instruction: "保留库存告警语义，重新设计更清楚的风险可视化。"
  },
  remainingInstruction: "",
  confidence: 0.98
});
const directAction = canonicalConversationDirectAction(candidateProgram.directAction, { scenes });
assert.equal(directAction.sceneNumber, 2);
assert.match(directAction.instruction, /库存告警/);

const restoreProgram = conversationEditProgramSchema.parse({
  classification: "content",
  understoodRequest: "撤销刚才的修改，回到上一版。",
  operations: [],
  directAction: { kind: "restore-parent-version" },
  remainingInstruction: "",
  confidence: 0.99
});
assert.deepEqual(
  JSON.parse(JSON.stringify(canonicalConversationDirectAction(restoreProgram.directAction, { scenes }))),
  { kind: "restore-parent-version" }
);

const renameProgram = conversationEditProgramSchema.parse({
  classification: "content",
  understoodRequest: "把这个视频项目重命名为全球库存中枢。",
  operations: [],
  projectTitle: "全球库存中枢",
  remainingInstruction: "",
  confidence: 0.97
});
assert.equal(renameProgram.projectTitle, "全球库存中枢");

const productionAssetProgram = conversationEditProgramSchema.parse({
  classification: "production",
  understoodRequest: "把上传图片作为 Logo，并移除原来的背景音乐。",
  operations: [],
  productionAssets: {
    logo: "attach-upload",
    music: "remove"
  },
  remainingInstruction: "",
  confidence: 0.99
});
assert.equal(productionAssetProgram.productionAssets.logo, "attach-upload");
assert.equal(productionAssetProgram.productionAssets.music, "remove");

const productionSettingsProgram = conversationEditProgramSchema.parse({
  classification: "production",
  understoodRequest: "字幕使用重点高亮，全片播放快一点。",
  operations: [],
  productionSettings: {
    captionsEnabled: true,
    captionStyle: "highlight",
    playbackRate: 1.25
  },
  remainingInstruction: "",
  confidence: 0.98
});
assert.equal(productionSettingsProgram.productionSettings.captionStyle, "highlight");
assert.equal(productionSettingsProgram.productionSettings.playbackRate, 1.25);

assert.throws(() => canonicalConversationOperations({
  ...program,
  operations: [{ operation: "delete", sceneId: "44444444-4444-4444-8444-444444444444", sceneNumber: 1 }]
}, { scenes }), /outside the current version/);

console.log("Conversation edit program smoke checks passed.");
