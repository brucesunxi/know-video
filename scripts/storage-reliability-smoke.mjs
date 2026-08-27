import assert from "node:assert/strict";
import fs from "node:fs";

const r2 = fs.readFileSync(new URL("../lib/r2.ts", import.meta.url), "utf8");
assert.match(r2, /let r2Client: S3Client \| undefined/);
assert.match(r2, /if \(r2Client\) return r2Client/);
assert.match(r2, /R2_UPLOAD_TIMEOUT_MS = 60_000/);
assert.match(r2, /R2_READ_TIMEOUT_MS = 60_000/);
assert.match(r2, /R2_HEAD_TIMEOUT_MS = 20_000/);
assert.match(r2, /R2_DELETE_TIMEOUT_MS = 45_000/);
assert.match(r2, /operationSignal\(input\.timeoutMs \?\? R2_UPLOAD_TIMEOUT_MS\)/);
assert.match(r2, /operationSignal\(R2_READ_TIMEOUT_MS\)/);
assert.match(r2, /operationSignal\(R2_HEAD_TIMEOUT_MS\)/);
assert.match(r2, /operationSignal\(R2_DELETE_TIMEOUT_MS\)/);

console.log("Storage reliability smoke checks passed.");
