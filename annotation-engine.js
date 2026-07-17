const ANNOTATION_TYPES = new Set(["arrow", "text", "rectangle", "blur", "pixelate"]);
const RECTANGLE_TYPES = new Set(["text", "rectangle", "blur", "pixelate"]);
const HISTORY_LIMIT = 100;

export function createAnnotation(input = {}) {
  const type = String(input.type || "").toLowerCase();

  if (!ANNOTATION_TYPES.has(type)) {
    throw new Error(`Unsupported annotation type: ${type || "unknown"}`);
  }

  const base = {
    id: normalizeId(input.id),
    type,
    color: normalizeColor(input.color),
    strokeWidth: clampNumber(input.strokeWidth, 1, 80, 4),
    createdAt: normalizeTimestamp(input.createdAt)
  };

  if (type === "arrow") {
    return {
      ...base,
      x1: finiteNumber(input.x1),
      y1: finiteNumber(input.y1),
      x2: finiteNumber(input.x2),
      y2: finiteNumber(input.y2)
    };
  }

  const rectangle = normalizeRect(input);

  if (type === "text") {
    return {
      ...base,
      ...rectangle,
      text: String(input.text || "Note").slice(0, 2000),
      fontSize: clampNumber(input.fontSize, 8, 400, 28),
      fontFamily: "system-ui",
      background: input.background !== false
    };
  }

  if (type === "blur") {
    return {
      ...base,
      ...rectangle,
      radius: clampNumber(input.radius, 2, 80, 14)
    };
  }

  if (type === "pixelate") {
    return {
      ...base,
      ...rectangle,
      pixelSize: clampNumber(input.pixelSize, 2, 120, 14)
    };
  }

  return {
    ...base,
    ...rectangle,
    fillOpacity: clampNumber(input.fillOpacity, 0, 1, 0.08)
  };
}

export function normalizeRect(input = {}) {
  let x = finiteNumber(input.x ?? input.left);
  let y = finiteNumber(input.y ?? input.top);
  let width = finiteNumber(input.width);
  let height = finiteNumber(input.height);

  if (width < 0) {
    x += width;
    width = Math.abs(width);
  }

  if (height < 0) {
    y += height;
    height = Math.abs(height);
  }

  return { x, y, width, height };
}

export function getAnnotationBounds(annotation) {
  if (!annotation || !ANNOTATION_TYPES.has(annotation.type)) {
    return null;
  }

  if (annotation.type === "arrow") {
    const left = Math.min(annotation.x1, annotation.x2);
    const top = Math.min(annotation.y1, annotation.y2);

    return {
      x: left,
      y: top,
      width: Math.abs(annotation.x2 - annotation.x1),
      height: Math.abs(annotation.y2 - annotation.y1)
    };
  }

  return normalizeRect(annotation);
}

export function getResizeHandles(annotation) {
  if (!annotation) {
    return [];
  }

  if (annotation.type === "arrow") {
    return [
      { name: "start", x: annotation.x1, y: annotation.y1 },
      { name: "end", x: annotation.x2, y: annotation.y2 }
    ];
  }

  const bounds = getAnnotationBounds(annotation);

  if (!bounds) {
    return [];
  }

  const left = bounds.x;
  const centerX = bounds.x + bounds.width / 2;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const centerY = bounds.y + bounds.height / 2;
  const bottom = bounds.y + bounds.height;

  return [
    { name: "nw", x: left, y: top },
    { name: "n", x: centerX, y: top },
    { name: "ne", x: right, y: top },
    { name: "e", x: right, y: centerY },
    { name: "se", x: right, y: bottom },
    { name: "s", x: centerX, y: bottom },
    { name: "sw", x: left, y: bottom },
    { name: "w", x: left, y: centerY }
  ];
}

export function findResizeHandle(annotation, point, tolerance = 10) {
  const maximumDistance = Math.max(1, Number(tolerance) || 10);

  return getResizeHandles(annotation).find((handle) =>
    Math.hypot(point.x - handle.x, point.y - handle.y) <= maximumDistance
  ) || null;
}

export function hitTestAnnotation(annotation, point, tolerance = 8) {
  if (!annotation || !point) {
    return false;
  }

  const margin = Math.max(1, Number(tolerance) || 8);

  if (annotation.type === "arrow") {
    return distanceToSegment(
      point,
      { x: annotation.x1, y: annotation.y1 },
      { x: annotation.x2, y: annotation.y2 }
    ) <= Math.max(margin, annotation.strokeWidth * 1.5);
  }

  const bounds = getAnnotationBounds(annotation);

  if (!bounds) {
    return false;
  }

  if (annotation.type === "rectangle") {
    const outer = containsPoint(expandRect(bounds, margin), point);
    const inner = containsPoint(expandRect(bounds, -Math.max(0, margin)), point);
    return outer && (!inner || bounds.width <= margin * 3 || bounds.height <= margin * 3);
  }

  return containsPoint(expandRect(bounds, margin), point);
}

export function hitTestAnnotations(annotations, point, tolerance = 8) {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (hitTestAnnotation(annotations[index], point, tolerance)) {
      return annotations[index];
    }
  }

  return null;
}

export function translateAnnotation(annotation, deltaX, deltaY, canvasBounds = null) {
  const translated = cloneAnnotation(annotation);
  const dx = finiteNumber(deltaX);
  const dy = finiteNumber(deltaY);

  if (translated.type === "arrow") {
    translated.x1 += dx;
    translated.x2 += dx;
    translated.y1 += dy;
    translated.y2 += dy;
  } else {
    translated.x += dx;
    translated.y += dy;
  }

  return canvasBounds ? constrainAnnotation(translated, canvasBounds) : translated;
}

export function resizeAnnotation(annotation, handleName, point, canvasBounds = null, minimumSize = 8) {
  const resized = cloneAnnotation(annotation);
  const target = canvasBounds ? clampPoint(point, canvasBounds) : point;

  if (resized.type === "arrow") {
    if (handleName === "start") {
      resized.x1 = finiteNumber(target.x);
      resized.y1 = finiteNumber(target.y);
    } else if (handleName === "end") {
      resized.x2 = finiteNumber(target.x);
      resized.y2 = finiteNumber(target.y);
    }

    return resized;
  }

  if (!RECTANGLE_TYPES.has(resized.type)) {
    return resized;
  }

  const original = getAnnotationBounds(resized);
  let left = original.x;
  let top = original.y;
  let right = original.x + original.width;
  let bottom = original.y + original.height;

  if (handleName.includes("w")) {
    left = Math.min(finiteNumber(target.x), right - minimumSize);
  }

  if (handleName.includes("e")) {
    right = Math.max(finiteNumber(target.x), left + minimumSize);
  }

  if (handleName.includes("n")) {
    top = Math.min(finiteNumber(target.y), bottom - minimumSize);
  }

  if (handleName.includes("s")) {
    bottom = Math.max(finiteNumber(target.y), top + minimumSize);
  }

  resized.x = left;
  resized.y = top;
  resized.width = right - left;
  resized.height = bottom - top;

  return canvasBounds ? constrainAnnotation(resized, canvasBounds) : resized;
}

export function constrainAnnotation(annotation, canvasBounds = {}) {
  const width = Math.max(1, finiteNumber(canvasBounds.width));
  const height = Math.max(1, finiteNumber(canvasBounds.height));
  const constrained = cloneAnnotation(annotation);
  const bounds = getAnnotationBounds(constrained);

  if (!bounds) {
    return constrained;
  }

  const dx = bounds.width > width
    ? -bounds.x
    : bounds.x < 0
      ? -bounds.x
      : bounds.x + bounds.width > width
        ? width - bounds.x - bounds.width
        : 0;
  const dy = bounds.height > height
    ? -bounds.y
    : bounds.y < 0
      ? -bounds.y
      : bounds.y + bounds.height > height
        ? height - bounds.y - bounds.height
        : 0;

  if (constrained.type === "arrow") {
    constrained.x1 = clampNumber(constrained.x1 + dx, 0, width, 0);
    constrained.x2 = clampNumber(constrained.x2 + dx, 0, width, 0);
    constrained.y1 = clampNumber(constrained.y1 + dy, 0, height, 0);
    constrained.y2 = clampNumber(constrained.y2 + dy, 0, height, 0);
  } else {
    constrained.x = clampNumber(constrained.x + dx, 0, width, 0);
    constrained.y = clampNumber(constrained.y + dy, 0, height, 0);
    constrained.width = Math.min(constrained.width, width - constrained.x);
    constrained.height = Math.min(constrained.height, height - constrained.y);
  }

  return constrained;
}

export function createHistory(initialAnnotations = []) {
  return {
    past: [],
    present: cloneAnnotations(initialAnnotations),
    future: []
  };
}

export function commitHistory(history, annotations) {
  const next = cloneAnnotations(annotations);

  if (annotationsEqual(history.present, next)) {
    return history;
  }

  return {
    past: [...history.past, cloneAnnotations(history.present)].slice(-HISTORY_LIMIT),
    present: next,
    future: []
  };
}

export function undoHistory(history) {
  if (!history.past.length) {
    return history;
  }

  const previous = history.past.at(-1);

  return {
    past: history.past.slice(0, -1),
    present: cloneAnnotations(previous),
    future: [cloneAnnotations(history.present), ...history.future].slice(0, HISTORY_LIMIT)
  };
}

export function redoHistory(history) {
  if (!history.future.length) {
    return history;
  }

  const [next, ...remaining] = history.future;

  return {
    past: [...history.past, cloneAnnotations(history.present)].slice(-HISTORY_LIMIT),
    present: cloneAnnotations(next),
    future: remaining
  };
}

export function replaceAnnotation(annotations, annotation) {
  return annotations.map((item) => item.id === annotation.id ? cloneAnnotation(annotation) : item);
}

export function removeAnnotation(annotations, annotationId) {
  return annotations.filter((annotation) => annotation.id !== annotationId);
}

export function cloneAnnotations(annotations) {
  return (Array.isArray(annotations) ? annotations : []).map(cloneAnnotation);
}

export function buildAnnotationFilename(title = "capture") {
  const stem = String(title || "capture")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .toLowerCase() || "capture";

  return `${stem}-annotated.png`;
}

function cloneAnnotation(annotation) {
  return { ...annotation };
}

function annotationsEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function distanceToSegment(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;

  if (!lengthSquared) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const projection = Math.max(0, Math.min(1,
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared
  ));

  return Math.hypot(
    point.x - (start.x + projection * segmentX),
    point.y - (start.y + projection * segmentY)
  );
}

function expandRect(rectangle, amount) {
  return {
    x: rectangle.x - amount,
    y: rectangle.y - amount,
    width: Math.max(0, rectangle.width + amount * 2),
    height: Math.max(0, rectangle.height + amount * 2)
  };
}

function containsPoint(rectangle, point) {
  return point.x >= rectangle.x &&
    point.y >= rectangle.y &&
    point.x <= rectangle.x + rectangle.width &&
    point.y <= rectangle.y + rectangle.height;
}

function clampPoint(point, bounds) {
  return {
    x: clampNumber(point.x, 0, Math.max(1, finiteNumber(bounds.width)), 0),
    y: clampNumber(point.y, 0, Math.max(1, finiteNumber(bounds.height)), 0)
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value).toLowerCase() : "#ff5f87";
}

function normalizeId(value) {
  const existing = String(value || "").trim().slice(0, 120);

  if (existing) {
    return existing;
  }

  if (globalThis.crypto?.randomUUID) {
    return `annotation-${globalThis.crypto.randomUUID()}`;
  }

  return `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}
