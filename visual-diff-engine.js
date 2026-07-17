const DEFAULT_THRESHOLD = 24;
const DEFAULT_MAX_REGIONS = 24;

/**
 * Compare two equally-sized RGBA buffers and return honest pixel statistics plus
 * clustered change regions. The engine is DOM-free so extension and smoke-test
 * code can use the same implementation.
 */
export function comparePixelBuffers(before, after, options = {}) {
  const beforeFrame = normalizeFrame(before, "before");
  const afterFrame = normalizeFrame(after, "after");

  if (beforeFrame.width !== afterFrame.width || beforeFrame.height !== afterFrame.height) {
    throw new Error("Before and after frames must use the same comparison dimensions.");
  }

  const width = beforeFrame.width;
  const height = beforeFrame.height;
  const totalPixels = width * height;
  const threshold = clampNumber(options.threshold, DEFAULT_THRESHOLD, 0, 255);
  const cellSize = Math.max(
    4,
    Math.round(clampNumber(options.cellSize, Math.ceil(Math.max(width, height) / 90), 4, 128))
  );
  const minimumChangedPixels = Math.max(
    1,
    Math.round(clampNumber(options.minimumChangedPixels, Math.max(4, Math.floor(totalPixels * 0.00001)), 1, totalPixels))
  );
  const maxRegions = Math.max(1, Math.round(clampNumber(options.maxRegions, DEFAULT_MAX_REGIONS, 1, 100)));
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const cells = Array.from({ length: columns * rows }, () => ({
    changedPixels: 0,
    deltaTotal: 0,
    maxDelta: 0
  }));

  let changedPixels = 0;
  let deltaTotal = 0;
  let changedDeltaTotal = 0;
  let maxDelta = 0;

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const delta = pixelDelta(beforeFrame.data, afterFrame.data, offset);
    deltaTotal += delta;
    maxDelta = Math.max(maxDelta, delta);

    if (delta < threshold) {
      continue;
    }

    changedPixels += 1;
    changedDeltaTotal += delta;
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    const cellIndex = Math.floor(y / cellSize) * columns + Math.floor(x / cellSize);
    const cell = cells[cellIndex];
    cell.changedPixels += 1;
    cell.deltaTotal += delta;
    cell.maxDelta = Math.max(cell.maxDelta, delta);
  }

  const regions = clusterChangedCells({
    cells,
    columns,
    rows,
    cellSize,
    width,
    height,
    minimumChangedPixels,
    maxRegions
  });
  const changePercent = percent(changedPixels, totalPixels);

  return {
    width,
    height,
    totalPixels,
    changedPixels,
    unchangedPixels: totalPixels - changedPixels,
    changePercent,
    similarityPercent: round(100 - changePercent, 3),
    meanDelta: round(deltaTotal / totalPixels, 2),
    meanChangedDelta: changedPixels ? round(changedDeltaTotal / changedPixels, 2) : 0,
    maxDelta: round(maxDelta, 2),
    threshold,
    cellSize,
    regions,
    regionCount: regions.length,
    classification: classifyChange(changePercent)
  };
}

/** Return true only when two captures represent the same monitor or page. */
export function areCapturesComparable(left, right) {
  if (!left?.id || !right?.id || left.id === right.id) {
    return false;
  }

  const leftWatchPlanId = String(left.watchPlanId || "").trim();
  const rightWatchPlanId = String(right.watchPlanId || "").trim();

  if (leftWatchPlanId || rightWatchPlanId) {
    return Boolean(leftWatchPlanId && rightWatchPlanId && leftWatchPlanId === rightWatchPlanId);
  }

  const leftSource = captureSourceKey(left);
  const rightSource = captureSourceKey(right);
  return Boolean(leftSource && rightSource && leftSource === rightSource);
}

/** Resolve the single monitor whose timeline belongs to the active selection. */
export function resolveReviewWatchPlanId(before, after) {
  const beforeWatchPlanId = String(before?.watchPlanId || "");
  const afterWatchPlanId = String(after?.watchPlanId || "");
  return afterWatchPlanId && (!before || beforeWatchPlanId === afterWatchPlanId)
    ? afterWatchPlanId
    : "";
}

/** Pick the most useful same-source pair without discarding an explicit selection. */
export function selectReviewPair(captures = [], runs = [], options = {}) {
  const normalizedCaptures = (Array.isArray(captures) ? captures : [])
    .filter((capture) => capture?.id)
    .sort((left, right) => timestamp(left) - timestamp(right));
  const byId = new Map(normalizedCaptures.map((capture) => [capture.id, capture]));
  const requestedBeforeId = String(options.beforeCaptureId || "");
  const requestedAfterId = String(options.afterCaptureId || "");
  const explicitBefore = byId.get(requestedBeforeId);
  const explicitAfter = byId.get(requestedAfterId);

  if (requestedBeforeId && requestedAfterId) {
    if (!explicitBefore || !explicitAfter) {
      return {
        before: explicitBefore || null,
        after: explicitAfter || null,
        source: "requested-unavailable"
      };
    }

    if (explicitBefore.id === explicitAfter.id) {
      return { before: null, after: explicitAfter, source: "same-capture" };
    }

    if (!areCapturesComparable(explicitBefore, explicitAfter)) {
      return { before: null, after: explicitAfter, source: "incompatible" };
    }

    return { before: explicitBefore, after: explicitAfter, source: "explicit" };
  }

  if (requestedAfterId && !explicitAfter) {
    return { before: null, after: null, source: "requested-unavailable" };
  }

  if (explicitAfter) {
    const previous = findPreviousCompatibleCapture(normalizedCaptures, explicitAfter);

    if (previous) {
      return { before: previous, after: explicitAfter, source: "explicit-after" };
    }

    return { before: null, after: explicitAfter, source: "selected-unpaired" };
  }

  if (requestedBeforeId && !explicitBefore) {
    return { before: null, after: null, source: "requested-unavailable" };
  }

  if (explicitBefore) {
    const next = normalizedCaptures.find((capture) => (
      timestamp(capture) > timestamp(explicitBefore) &&
      areCapturesComparable(explicitBefore, capture)
    ));

    if (next) {
      return { before: explicitBefore, after: next, source: "explicit-before" };
    }

    return { before: explicitBefore, after: null, source: "selected-unpaired" };
  }

  const requestedWatchPlanId = String(options.watchPlanId || "");
  const completedRunCaptures = (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.captureId && ["captured", "unchanged"].includes(run.status))
    .filter((run) => !requestedWatchPlanId || run.watchPlanId === requestedWatchPlanId)
    .map((run) => ({ run, capture: byId.get(run.captureId) }))
    .filter((entry) => entry.capture)
    .sort((left, right) => timestamp(left.run) - timestamp(right.run));

  const monitorPair = findNewestCompatiblePair(completedRunCaptures.map((entry) => entry.capture));

  if (monitorPair) {
    return { ...monitorPair, source: "monitor" };
  }

  const watchCaptures = normalizedCaptures.filter((capture) => (
    !requestedWatchPlanId || capture.watchPlanId === requestedWatchPlanId
  ));
  const candidates = requestedWatchPlanId ? watchCaptures : normalizedCaptures;
  const recentPair = findNewestCompatiblePair(candidates);

  if (recentPair) {
    return { ...recentPair, source: "recent" };
  }

  const latest = candidates.at(-1) || completedRunCaptures.at(-1)?.capture || null;

  if (latest) {
    return { before: null, after: latest, source: "recent-unpaired" };
  }

  return { before: null, after: null, source: "empty" };
}

/** Normalize runs for deterministic, accessible timeline rendering. */
export function buildMonitorTimeline(captures = [], runs = [], options = {}) {
  const captureById = new Map(
    (Array.isArray(captures) ? captures : [])
      .filter((capture) => capture?.id)
      .map((capture) => [capture.id, capture])
  );
  const watchPlanId = String(options.watchPlanId || "");
  const normalizedRuns = (Array.isArray(runs) ? runs : [])
    .filter((run) => !watchPlanId || run?.watchPlanId === watchPlanId)
    .map((run, index) => normalizeTimelineEntry(run, captureById.get(run?.captureId), index));

  if (!normalizedRuns.length) {
    for (const capture of captureById.values()) {
      if (capture.sourceType !== "timed" || (watchPlanId && capture.watchPlanId !== watchPlanId)) {
        continue;
      }

      normalizedRuns.push(normalizeTimelineEntry({
        id: `capture-${capture.id}`,
        captureId: capture.id,
        watchPlanId: capture.watchPlanId,
        status: "captured",
        title: capture.title,
        url: capture.url,
        completedAt: capture.capturedAt,
        changePercent: capture.changePercent
      }, capture, normalizedRuns.length));
    }
  }

  return normalizedRuns
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, Math.max(1, Math.round(clampNumber(options.limit, 80, 1, 300))));
}

export function formatChangePercent(value) {
  const normalized = clampNumber(value, 0, 0, 100);
  return normalized < 0.01 && normalized > 0
    ? "<0.01%"
    : `${round(normalized, normalized < 1 ? 2 : 1)}%`;
}

function normalizeFrame(frame, label) {
  const width = Math.round(Number(frame?.width) || 0);
  const height = Math.round(Number(frame?.height) || 0);
  const data = frame?.data;

  if (width < 1 || height < 1) {
    throw new Error(`The ${label} frame needs positive dimensions.`);
  }

  if (!(data instanceof Uint8ClampedArray) && !(data instanceof Uint8Array)) {
    throw new Error(`The ${label} frame needs an RGBA pixel buffer.`);
  }

  if (data.length !== width * height * 4) {
    throw new Error(`The ${label} frame pixel buffer does not match its dimensions.`);
  }

  return { width, height, data };
}

function pixelDelta(before, after, offset) {
  const red = Math.abs(before[offset] - after[offset]);
  const green = Math.abs(before[offset + 1] - after[offset + 1]);
  const blue = Math.abs(before[offset + 2] - after[offset + 2]);
  const alpha = Math.abs(before[offset + 3] - after[offset + 3]);
  return Math.sqrt((red ** 2 + green ** 2 + blue ** 2 + alpha ** 2) / 4);
}

function clusterChangedCells({
  cells,
  columns,
  rows,
  cellSize,
  width,
  height,
  minimumChangedPixels,
  maxRegions
}) {
  const visited = new Uint8Array(cells.length);
  const regions = [];

  for (let origin = 0; origin < cells.length; origin += 1) {
    if (visited[origin] || !cells[origin].changedPixels) {
      continue;
    }

    const queue = [origin];
    visited[origin] = 1;
    let minColumn = columns;
    let maxColumn = 0;
    let minRow = rows;
    let maxRow = 0;
    let changedPixels = 0;
    let deltaTotal = 0;
    let maxDelta = 0;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const cellIndex = queue[cursor];
      const row = Math.floor(cellIndex / columns);
      const column = cellIndex % columns;
      const cell = cells[cellIndex];
      minColumn = Math.min(minColumn, column);
      maxColumn = Math.max(maxColumn, column);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      changedPixels += cell.changedPixels;
      deltaTotal += cell.deltaTotal;
      maxDelta = Math.max(maxDelta, cell.maxDelta);

      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          if (!rowOffset && !columnOffset) {
            continue;
          }

          const nextRow = row + rowOffset;
          const nextColumn = column + columnOffset;

          if (nextRow < 0 || nextRow >= rows || nextColumn < 0 || nextColumn >= columns) {
            continue;
          }

          const nextIndex = nextRow * columns + nextColumn;
          if (!visited[nextIndex] && cells[nextIndex].changedPixels) {
            visited[nextIndex] = 1;
            queue.push(nextIndex);
          }
        }
      }
    }

    if (changedPixels < minimumChangedPixels) {
      continue;
    }

    const left = minColumn * cellSize;
    const top = minRow * cellSize;
    const right = Math.min(width, (maxColumn + 1) * cellSize);
    const bottom = Math.min(height, (maxRow + 1) * cellSize);

    regions.push({
      id: `change-${regions.length + 1}`,
      left,
      top,
      width: right - left,
      height: bottom - top,
      leftPercent: round((left / width) * 100, 4),
      topPercent: round((top / height) * 100, 4),
      widthPercent: round(((right - left) / width) * 100, 4),
      heightPercent: round(((bottom - top) / height) * 100, 4),
      changedPixels,
      changePercent: percent(changedPixels, width * height),
      meanDelta: round(deltaTotal / changedPixels, 2),
      maxDelta: round(maxDelta, 2)
    });
  }

  return regions
    .sort((left, right) => right.changedPixels - left.changedPixels)
    .slice(0, maxRegions)
    .map((region, index) => ({ ...region, id: `change-${index + 1}`, rank: index + 1 }));
}

function normalizeTimelineEntry(run, capture, index) {
  const status = ["queued", "running", "captured", "unchanged", "skipped", "failed"].includes(run?.status)
    ? run.status
    : "captured";
  const timeText = run?.completedAt || run?.startedAt || run?.scheduledAt || capture?.capturedAt || run?.createdAt || "";

  return {
    id: String(run?.id || `timeline-${index + 1}`),
    watchPlanId: String(run?.watchPlanId || capture?.watchPlanId || ""),
    captureId: String(run?.captureId || capture?.id || ""),
    title: String(run?.title || capture?.title || capture?.host || "Timed capture"),
    url: String(run?.url || capture?.url || ""),
    status,
    changePercent: Number.isFinite(Number(run?.changePercent)) ? clampNumber(run.changePercent, 0, 0, 100) : null,
    error: String(run?.error || ""),
    timeText,
    timestamp: Date.parse(timeText) || 0,
    selectable: Boolean(run?.captureId && capture)
  };
}

function findNewestCompatiblePair(captures) {
  const ordered = (Array.isArray(captures) ? captures : [])
    .filter((capture) => capture?.id)
    .sort((left, right) => timestamp(left) - timestamp(right));

  for (let afterIndex = ordered.length - 1; afterIndex > 0; afterIndex -= 1) {
    const after = ordered[afterIndex];
    const before = findPreviousCompatibleCapture(ordered.slice(0, afterIndex), after);

    if (before) {
      return { before, after };
    }
  }

  return null;
}

function findPreviousCompatibleCapture(captures, after) {
  return [...(Array.isArray(captures) ? captures : [])]
    .filter((capture) => timestamp(capture) < timestamp(after))
    .filter((capture) => areCapturesComparable(capture, after))
    .sort((left, right) => timestamp(left) - timestamp(right))
    .at(-1) || null;
}

function captureSourceKey(capture) {
  const rawUrl = String(capture?.url || "").trim();

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      const pathname = parsed.pathname.length > 1
        ? parsed.pathname.replace(/\/+$/, "") || "/"
        : "/";
      return `page:${parsed.origin.toLowerCase()}${pathname}`;
    } catch {
      // Fall back to the stored host when legacy metadata has no parseable URL.
    }
  }

  const host = String(capture?.host || "").trim().toLowerCase();
  return host ? `host:${host}` : "";
}

function classifyChange(changePercent) {
  if (changePercent === 0) {
    return "identical";
  }

  if (changePercent < 0.5) {
    return "minor";
  }

  if (changePercent < 5) {
    return "noticeable";
  }

  return "major";
}

function timestamp(value) {
  return Date.parse(
    value?.completedAt || value?.startedAt || value?.capturedAt || value?.createdAt || ""
  ) || 0;
}

function percent(part, total) {
  return total ? round((part / total) * 100, 3) : 0;
}

function round(value, precision = 2) {
  const multiplier = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
}

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : fallback));
}
