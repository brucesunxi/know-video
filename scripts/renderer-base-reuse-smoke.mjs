import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const renderer = fs.readFileSync(new URL("../lib/vercel-renderer.ts", import.meta.url), "utf8");
const lockfile = fs.readFileSync(new URL("../package-lock.json", import.meta.url));
const expectedRevision = createHash("sha256").update(lockfile).digest("hex").slice(0, 12);
const configuredRevision = renderer.match(/RENDERER_DEPENDENCY_REVISION = "lock-([a-f0-9]{12})"/)?.[1];

assert.equal(configuredRevision, expectedRevision, "Dependency changes must create a new renderer base sandbox");
const baseNameBody = renderer.match(/function baseSandboxName\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.match(baseNameBody, /RENDERER_DEPENDENCY_REVISION/);
assert.doesNotMatch(baseNameBody, /rendererRevision/);
assert.match(renderer, /await syncRendererSource\(sandbox\)/);
assert.match(renderer, /\["fetch", "--depth", "1", "origin", revision\]/);
assert.match(renderer, /\["checkout", "--force", "FETCH_HEAD"\]/);
assert.doesNotMatch(renderer, /git clean|\["clean"/);

console.log("Renderer base reuse smoke checks passed.");
