import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
const deleteHandler = workspace.slice(
  workspace.indexOf("async function deleteProject"),
  workspace.indexOf("return (", workspace.indexOf("async function deleteProject"))
);

assert.match(deleteHandler, /setProjects\(\(current\) => current\.filter/);
assert.match(deleteHandler, /if \(project\.id === projectId\)/);
assert.match(deleteHandler, /setProjectSource\("empty"\)/);
assert.match(deleteHandler, /setMessages\(\[\]\)/);
assert.match(deleteHandler, /setStage\("projects"\)/);
assert.doesNotMatch(deleteHandler, /window\.location\.assign/);

console.log("Project library delete smoke checks passed.");
