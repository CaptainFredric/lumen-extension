import assert from "node:assert/strict";
import test from "node:test";
import { createCaptureZip } from "../capture-zip.js";

test("ZIP contains valid STORE headers, CRC and safe unique filenames", async () => {
  const blob = new Blob(["123456789"], { type: "image/png" });
  const zip = await createCaptureZip([{ id: "a", filename: "../../one.png" }, { id: "b", filename: "one.png" }], async () => ({ blob }));
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  assert.equal(view.getUint16(bytes.length - 12, true), 2);
  assert(new TextDecoder().decode(bytes).includes("01-one.png"));
  assert(new TextDecoder().decode(bytes).includes("02-one.png"));
  assert(!new TextDecoder().decode(bytes).includes("../"));
});
test("ZIP rejects empty, missing, and oversized originals", async () => {
  await assert.rejects(createCaptureZip([], async () => null), /Choose/);
  await assert.rejects(createCaptureZip([{ id: "x" }], async () => null), /unavailable/);
  await assert.rejects(createCaptureZip([{ id: "x" }], async () => ({ blob: { type: "image/png", size: 65 * 1024 * 1024 } })), /64 MB/);
});
test("ZIP cancellation interrupts loading and CRC work", async () => {
  const abort = new AbortController();
  await assert.rejects(createCaptureZip([{ id: "x" }], async () => {
    abort.abort();
    return { blob: new Blob(["data"], { type: "image/png" }) };
  }, { signal: abort.signal }), { name: "AbortError" });
  const duringCrc = new AbortController();
  setTimeout(() => duringCrc.abort(), 0);
  await assert.rejects(createCaptureZip([{ id: "x" }], async () => ({ blob: new Blob([new Uint8Array(2 * 1024 * 1024)], { type: "image/png" }) }), { signal: duringCrc.signal }), { name: "AbortError" });
});
