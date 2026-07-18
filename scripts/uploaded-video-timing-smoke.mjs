import assert from "node:assert/strict";
import fs from "node:fs";

const workspace = fs.readFileSync(new URL("../app/workspace-client.tsx", import.meta.url), "utf8");
assert.match(workspace, /uploadDirectAsset\(file, videoMetadata\?\.durationSeconds\)/);
assert.match(workspace, /form\.set\("actualDurationSeconds", String\(videoMetadata\.durationSeconds\)\)/);
assert.match(workspace, /actualDurationSeconds\?: number/);

const directAttach = fs.readFileSync(new URL("../app/api/assets/attach/route.ts", import.meta.url), "utf8");
assert.match(directAttach, /actualDurationSeconds: z\.number\(\)\.positive\(\)\.max\(21_600\)\.optional\(\)/);
assert.match(directAttach, /narration\?\.actualDurationSeconds \?\? body\.actualDurationSeconds/);

const multipart = fs.readFileSync(new URL("../app/api/assets/upload/route.ts", import.meta.url), "utf8");
assert.match(multipart, /form\.get\("actualDurationSeconds"\)/);
assert.match(multipart, /narration\?\.actualDurationSeconds \?\? fields\.actualDurationSeconds/);

console.log("Uploaded video timing smoke checks passed.");
