const LETTER_PORTRAIT = Object.freeze({ width: 612, height: 792 });
const LETTER_LANDSCAPE = Object.freeze({ width: 792, height: 612 });
const DEFAULT_MARGIN_POINTS = 24;
const DEFAULT_FOOTER_POINTS = 16;
const DEFAULT_MAX_RASTER_WIDTH = 2400;
const MAX_PDF_PAGES = 250;

export function buildExportFilename(title = "capture", suffix = "export", extension = "png") {
  const stem = String(title || "capture")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .toLowerCase() || "capture";
  const safeSuffix = String(suffix || "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const safeExtension = String(extension || "png").replace(/[^a-zA-Z0-9]+/g, "").toLowerCase() || "png";

  return `${stem}${safeSuffix ? `-${safeSuffix}` : ""}.${safeExtension}`;
}

export function calculatePdfPagination(sourceWidth, sourceHeight, options = {}) {
  const width = normalizeDimension(sourceWidth, "width");
  const height = normalizeDimension(sourceHeight, "height");
  const landscape = options.landscape ?? width / height > 1.25;
  const page = landscape ? LETTER_LANDSCAPE : LETTER_PORTRAIT;
  const margin = clampNumber(options.marginPoints, 0, 72, DEFAULT_MARGIN_POINTS);
  const footer = clampNumber(options.footerPoints, 0, 36, DEFAULT_FOOTER_POINTS);
  const printableWidth = page.width - margin * 2;
  const printableHeight = page.height - margin * 2 - footer;

  if (printableWidth <= 0 || printableHeight <= 0) {
    throw new Error("The PDF page margins leave no room for the capture.");
  }

  const sourcePixelsPerPage = Math.max(1, Math.floor(width * printableHeight / printableWidth));
  const pageCount = Math.ceil(height / sourcePixelsPerPage);

  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(`This capture would create ${pageCount} PDF pages. Export the PNG or crop the capture before creating a PDF.`);
  }

  const pages = [];

  for (let index = 0, sourceY = 0; sourceY < height; index += 1, sourceY += sourcePixelsPerPage) {
    const sourceSliceHeight = Math.min(sourcePixelsPerPage, height - sourceY);
    const drawHeight = sourceSliceHeight / width * printableWidth;
    pages.push({
      index,
      sourceY,
      sourceHeight: sourceSliceHeight,
      drawWidth: printableWidth,
      drawHeight,
      drawX: margin,
      drawY: page.height - margin - drawHeight
    });
  }

  return {
    sourceWidth: width,
    sourceHeight: height,
    pageWidth: page.width,
    pageHeight: page.height,
    margin,
    footer,
    printableWidth,
    printableHeight,
    sourcePixelsPerPage,
    pageCount,
    landscape,
    pages
  };
}

export async function createCanvasPdfBlob(sourceCanvas, options = {}) {
  if (!(sourceCanvas instanceof HTMLCanvasElement) || !sourceCanvas.width || !sourceCanvas.height) {
    throw new Error("A rendered capture canvas is required for PDF export.");
  }

  return createCanvasSequencePdfBlob([sourceCanvas], options);
}

export async function createCanvasSequencePdfBlob(sourceCanvases, options = {}) {
  const canvases = Array.isArray(sourceCanvases) ? sourceCanvases : [];

  if (!canvases.length || canvases.some((canvas) =>
    !(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height
  )) {
    throw new Error("One or more rendered capture canvases are required for PDF export.");
  }

  const sourceWidth = canvases[0].width;

  if (canvases.some((canvas) => canvas.width !== sourceWidth)) {
    throw new Error("Capture tiles must have the same width before they can be paginated.");
  }

  return createSourceSequencePdfBlob(
    canvases.map((canvas) => ({
      source: canvas,
      width: canvas.width,
      height: canvas.height
    })),
    options
  );
}

async function createSourceSequencePdfBlob(sources, options = {}) {
  const sourceWidth = sources[0].width;
  const sourceHeight = sources.reduce((sum, source) => sum + source.height, 0);

  const layout = calculatePdfPagination(sourceWidth, sourceHeight, options);
  const maxRasterWidth = Math.round(clampNumber(
    options.maxRasterWidth,
    800,
    4000,
    DEFAULT_MAX_RASTER_WIDTH
  ));
  const outputWidth = Math.min(sourceWidth, maxRasterWidth);
  const scale = outputWidth / sourceWidth;
  const pageRasterHeight = Math.max(1, Math.round(
    (layout.pageHeight - layout.margin * 2) / layout.printableWidth * outputWidth
  ));
  const footerRasterHeight = Math.max(1, Math.round(layout.footer / layout.printableWidth * outputWidth));
  const imagePages = [];

  for (const page of layout.pages) {
    const captureHeight = Math.max(1, Math.round(page.sourceHeight * scale));
    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = outputWidth;
    pageCanvas.height = pageRasterHeight;
    const context = pageCanvas.getContext("2d", { alpha: false });

    if (!context) {
      throw new Error("The browser could not prepare a PDF page.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputWidth, pageRasterHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    drawSourceSequencePage(context, sources, page, {
      outputWidth,
      captureHeight,
      scale
    });
    drawRasterPageNumber(context, {
      pageNumber: page.index + 1,
      pageCount: layout.pageCount,
      footerHeight: footerRasterHeight
    });
    const jpegBlob = await canvasToBlob(pageCanvas, "image/jpeg", options.jpegQuality ?? 0.92);
    imagePages.push({
      bytes: new Uint8Array(await jpegBlob.arrayBuffer()),
      width: outputWidth,
      height: pageRasterHeight,
      drawWidth: layout.printableWidth,
      drawHeight: layout.pageHeight - layout.margin * 2,
      drawX: layout.margin,
      drawY: layout.margin
    });
    pageCanvas.width = 1;
    pageCanvas.height = 1;
  }

  const bytes = buildImagePdfBytes(imagePages, layout);
  return {
    blob: new Blob([bytes], { type: "application/pdf" }),
    pageCount: layout.pageCount,
    sourceWidth,
    sourceHeight,
    rasterWidth: outputWidth,
    sourceExact: options.sourceExact !== false,
    layout
  };
}

export async function createImagePdfBlob(imageBlob, options = {}) {
  const image = await decodeImageBlob(imageBlob);

  try {
    return await createSourceSequencePdfBlob([{
      source: image.source,
      width: image.width,
      height: image.height
    }], options);
  } finally {
    image.release();
  }
}

export async function createPngBlobFromImage(imageBlob) {
  if (!(imageBlob instanceof Blob) || !imageBlob.size || !imageBlob.type.startsWith("image/")) {
    throw new Error("A local capture image is required for PNG export.");
  }

  const image = await decodeImageBlob(imageBlob);

  try {
    if (imageBlob.type.toLowerCase() === "image/png") {
      return {
        blob: imageBlob,
        width: image.width,
        height: image.height
      };
    }

    const canvas = drawDecodedImage(image);
    return {
      blob: await canvasToBlob(canvas, "image/png"),
      width: image.width,
      height: image.height
    };
  } finally {
    image.release();
  }
}

export async function downloadBlob(blob, filename, options = {}) {
  if (!(blob instanceof Blob) || !blob.size) {
    throw new Error("There is no rendered file to download.");
  }

  const objectUrl = URL.createObjectURL(blob);
  let downloadId = null;

  try {
    if (globalThis.chrome?.downloads?.download) {
      downloadId = await chrome.downloads.download({
        url: objectUrl,
        filename: options.folder ? `${options.folder}/${filename}` : filename,
        saveAs: options.saveAs !== false
      });
      const lifecycleTracked = await waitForChromeDownload(downloadId, options);

      if (lifecycleTracked) {
        URL.revokeObjectURL(objectUrl);
      } else {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  return downloadId;
}

async function waitForChromeDownload(downloadId, options = {}) {
  const downloads = globalThis.chrome?.downloads;
  const changed = downloads?.onChanged;

  if (!Number.isInteger(downloadId) || !changed?.addListener || !changed?.removeListener) {
    return false;
  }

  const timeoutMs = Math.max(5_000, Math.min(10 * 60_000, Number(options.completionTimeoutMs) || 120_000));

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (completed, error = null) => {
      if (settled) {
        return;
      }

      settled = true;
      changed.removeListener(onChanged);
      window.clearTimeout(timeoutId);
      error ? reject(error) : resolve(completed);
    };
    const inspectState = (state, reason = "") => {
      if (state === "complete") {
        finish(true);
      } else if (state === "interrupted") {
        finish(false, new Error(reason ? `The download was interrupted (${reason}).` : "The download was interrupted."));
      }
    };
    const onChanged = (delta) => {
      if (delta?.id !== downloadId) {
        return;
      }

      inspectState(delta.state?.current, delta.error?.current || "");
    };
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);

    changed.addListener(onChanged);

    if (downloads.search) {
      Promise.resolve(downloads.search({ id: downloadId }))
        .then((items) => {
          const item = Array.isArray(items) ? items[0] : null;
          inspectState(item?.state, item?.error || "");
        })
        .catch(() => {});
    }
  });
}

export function buildImagePdfBytes(imagePages, layout) {
  if (!Array.isArray(imagePages) || imagePages.length !== layout?.pageCount || !imagePages.length) {
    throw new Error("Every PDF page needs one rendered image slice.");
  }

  const encoder = new TextEncoder();
  const objectCount = 2 + imagePages.length * 3;
  const chunks = [];
  const offsets = new Array(objectCount + 1).fill(0);
  let byteLength = 0;
  const appendBytes = (bytes) => {
    chunks.push(bytes);
    byteLength += bytes.length;
  };
  const appendText = (value) => appendBytes(encoder.encode(value));
  const appendObject = (id, body) => {
    offsets[id] = byteLength;
    appendText(`${id} 0 obj\n`);
    if (typeof body === "string") {
      appendText(body);
    } else {
      appendBytes(body);
    }
    appendText("\nendobj\n");
  };

  appendText("%PDF-1.4\n%Lumen\n");
  appendObject(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const pageIds = imagePages.map((_page, index) => 3 + index * 3);
  appendObject(2, `<< /Type /Pages /Count ${imagePages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);

  imagePages.forEach((image, index) => {
    const layoutPage = layout.pages[index];
    const pageId = 3 + index * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const imageName = `Im${index + 1}`;
    const drawWidth = image.drawWidth ?? layoutPage.drawWidth;
    const drawHeight = image.drawHeight ?? layoutPage.drawHeight;
    const drawX = image.drawX ?? layoutPage.drawX;
    const drawY = image.drawY ?? layoutPage.drawY;
    const content = [
      "q",
      `${formatPdfNumber(drawWidth)} 0 0 ${formatPdfNumber(drawHeight)} ${formatPdfNumber(drawX)} ${formatPdfNumber(drawY)} cm`,
      `/${imageName} Do`,
      "Q",
      ""
    ].join("\n");
    const contentBytes = encoder.encode(content);

    appendObject(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPdfNumber(layout.pageWidth)} ${formatPdfNumber(layout.pageHeight)}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    appendObject(contentId, joinBinary([
      encoder.encode(`<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      encoder.encode("endstream")
    ]));
    appendObject(imageId, joinBinary([
      encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`),
      image.bytes,
      encoder.encode("\nendstream")
    ]));
  });

  const xrefOffset = byteLength;
  appendText(`xref\n0 ${objectCount + 1}\n`);
  appendText("0000000000 65535 f \n");

  for (let id = 1; id <= objectCount; id += 1) {
    appendText(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }

  appendText(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return joinBinary(chunks);
}

async function decodeImageBlob(blob) {
  if (!(blob instanceof Blob) || !blob.size || !blob.type.startsWith("image/")) {
    throw new Error("A readable local image is required for export.");
  }

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close()
    };
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = "async";

  try {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("The local image could not be decoded for export.")), { once: true });
      image.src = objectUrl;
    });
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }

  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(objectUrl)
  };
}

function drawSourceSequencePage(context, sources, page, { outputWidth, captureHeight, scale }) {
  const pageTop = page.sourceY;
  const pageBottom = page.sourceY + page.sourceHeight;
  let sourceTop = 0;

  for (const source of sources) {
    const sourceBottom = sourceTop + source.height;
    const overlapTop = Math.max(pageTop, sourceTop);
    const overlapBottom = Math.min(pageBottom, sourceBottom);

    if (overlapBottom > overlapTop) {
      const sourceY = overlapTop - sourceTop;
      const sourceHeight = overlapBottom - overlapTop;
      const destinationTop = Math.round((overlapTop - pageTop) * scale);
      const destinationBottom = overlapBottom === pageBottom
        ? captureHeight
        : Math.round((overlapBottom - pageTop) * scale);

      context.drawImage(
        source.source,
        0,
        sourceY,
        source.width,
        sourceHeight,
        0,
        destinationTop,
        outputWidth,
        Math.max(1, destinationBottom - destinationTop)
      );
    }

    sourceTop = sourceBottom;

    if (sourceTop >= pageBottom) {
      break;
    }
  }
}

function drawDecodedImage(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { alpha: true });

  if (!context) {
    throw new Error("The browser could not prepare the capture for export.");
  }

  context.drawImage(image.source, 0, 0, image.width, image.height);
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(`The browser could not render the ${type === "image/png" ? "PNG" : "PDF image"}.`));
      }
    }, type, quality);
  });
}

function normalizeDimension(value, label) {
  const dimension = Math.round(Number(value));

  if (!Number.isFinite(dimension) || dimension < 1) {
    throw new Error(`The capture ${label} is invalid.`);
  }

  return dimension;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function formatPdfNumber(value) {
  return Number(value.toFixed(3)).toString();
}

function drawRasterPageNumber(context, { pageNumber, pageCount, footerHeight }) {
  if (footerHeight < 2) {
    return;
  }

  const baselineY = context.canvas.height - footerHeight / 2;
  const fontSize = Math.max(8, Math.round(footerHeight * 0.38));
  context.fillStyle = "#596773";
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "middle";
  context.fillText(
    `Page ${pageNumber} / ${pageCount}`,
    context.canvas.width - Math.max(8, Math.round(footerHeight * 0.45)),
    baselineY
  );
}

function joinBinary(chunks) {
  const byteLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
