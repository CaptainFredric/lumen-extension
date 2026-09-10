const LIMIT = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function header(size, values) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  for (const [offset, value, width] of values) {
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
  }
  return bytes;
}

// PNG is already compressed. ZIP's STORE method avoids a second compression
// pass, keeps memory bounded, and works in standard desktop archive tools.
export async function createCaptureZip(images, loadImage, { signal, onProgress = () => {} } = {}) {
  if (!images.length || images.length > 40) throw new Error("Choose between 1 and 40 images.");
  let offset = 0;
  let total = 0;
  const parts = [];
  const central = [];
  const check = () => { if (signal?.aborted) throw new DOMException("ZIP export cancelled", "AbortError"); };
  for (const [index, image] of images.entries()) {
    check();
    const asset = await loadImage(image.id);
    check();
    if (!asset?.blob || asset.blob.type !== "image/png") throw new Error("An original image is unavailable. Reopen the capture to refresh its files.");
    total += asset.blob.size;
    if (total > LIMIT) throw new Error("Choose fewer images. ZIP export is limited to 64 MB.");
    const bytes = new Uint8Array(await asset.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (let start = 0; start < bytes.length; start += 1048576) {
      const end = Math.min(start + 1048576, bytes.length);
      for (let position = start; position < end; position++) crc = crcTable[(crc ^ bytes[position]) & 255] ^ (crc >>> 8);
      await new Promise((resolve) => setTimeout(resolve, 0));
      check();
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const safe = String(image.filename || "capture.png").split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
    const name = encoder.encode(`${String(index + 1).padStart(2, "0")}-${safe}`);
    const local = header(30, [[0, 0x04034b50], [4, 20, 2], [6, 0x800, 2], [12, 33, 2], [14, crc], [18, bytes.length], [22, bytes.length], [26, name.length, 2]]);
    const directory = header(46, [[0, 0x02014b50], [4, 20, 2], [6, 20, 2], [8, 0x800, 2], [14, 33, 2], [16, crc], [20, bytes.length], [24, bytes.length], [28, name.length, 2], [42, offset]]);
    parts.push(local, name, asset.blob);
    central.push(directory, name);
    offset += local.length + name.length + bytes.length;
    onProgress(index + 1, images.length);
  }
  check();
  const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
  const end = header(22, [[0, 0x06054b50], [8, images.length, 2], [10, images.length, 2], [12, centralSize], [16, offset]]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
