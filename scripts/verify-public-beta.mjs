import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const release = JSON.parse(await readFile(new URL("../docs/beta-release.json", import.meta.url), "utf8"));
const temp = await mkdtemp(path.join(os.tmpdir(), "lumen-beta-verify-"));
try {
  let bytes;
  if (process.argv[2]) {
    bytes = await readFile(path.resolve(process.argv[2]));
  } else {
    const response = await fetch(release.downloadUrl, { signal: AbortSignal.timeout(60000) });
    assert.equal(response.ok, true, `Download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  // Verify the published bytes before handing the archive to a ZIP parser.
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, release.sha256, "Public beta checksum mismatch");
  const zip = path.join(temp, "beta.zip");
  await writeFile(zip, bytes);
  await run("unzip", ["-tq", zip]);
  const { stdout } = await run("unzip", ["-p", zip, "manifest.json"]);
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.version, release.version);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions || [], []);
  assert.equal(Boolean(manifest.oauth2), release.driveEnabled);
  console.log(JSON.stringify({ ok: true, tag: release.tag, sourceCommit: release.sourceCommit, sha256, bytes: bytes.length, driveEnabled: release.driveEnabled }, null, 2));
} finally {
  await rm(temp, { recursive: true, force: true });
}
