import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const backgroundPath = path.join(repoRoot, "background.js");
const NOW_MS = Date.parse("2026-07-16T12:00:00.000Z");
const MINUTE_MS = 60_000;

const scheduler = await loadSchedulerTestApi();
const results = [];

runNormalizationChecks();
runAlarmDefinitionChecks();
runLifecycleChecks();

console.log(JSON.stringify({
  ok: true,
  suite: "watch schedule",
  checks: results
}, null, 2));

function runNormalizationChecks() {
  const onceAt = new Date(NOW_MS + 45 * MINUTE_MS).toISOString();
  const once = scheduler.normalizeWatchSchedule({
    mode: "once",
    runAt: onceAt,
    intervalMinutes: 999,
    maxRuns: 12
  }, NOW_MS);

  assert.equal(readMode(once), "once", "Once schedules must retain the once mode.");
  assert.equal(readTimestamp(once, ["runAt", "startAt", "onceAt", "nextRunAt"]), Date.parse(onceAt), "Once schedules must retain their chosen run time.");
  assert.equal(readMaxRuns(once), 1, "Once schedules must normalize to exactly one run.");
  results.push({ name: "normalize once", mode: readMode(once), maxRuns: readMaxRuns(once) });

  const repeat = scheduler.normalizeWatchSchedule({
    mode: "repeat",
    intervalMinutes: 60
  }, NOW_MS);

  assert.equal(readMode(repeat), "repeat", "Repeat schedules must retain the repeat mode.");
  assert.equal(readIntervalMinutes(repeat), 60, "Repeat cadence changed during normalization.");
  results.push({ name: "normalize repeat", mode: readMode(repeat), intervalMinutes: readIntervalMinutes(repeat) });

  const expiresAt = new Date(NOW_MS + 2 * 60 * MINUTE_MS).toISOString();
  const continuous = scheduler.normalizeWatchSchedule({
    mode: "continuous",
    intervalMinutes: 5,
    maxRuns: 5,
    expiresAt
  }, NOW_MS);

  assert.equal(readMode(continuous), "continuous", "Continuous schedules must retain the continuous mode.");
  assert.equal(readIntervalMinutes(continuous), 5, "Continuous cadence changed during normalization.");
  assert.equal(readMaxRuns(continuous), 5, "Continuous max-run protection changed during normalization.");
  assert.equal(readTimestamp(continuous, ["expiresAt", "endAt", "stopAt"]), Date.parse(expiresAt), "Continuous expiry changed during normalization.");
  results.push({
    name: "normalize continuous",
    mode: readMode(continuous),
    intervalMinutes: readIntervalMinutes(continuous),
    maxRuns: readMaxRuns(continuous)
  });
}

function runAlarmDefinitionChecks() {
  const onceAt = NOW_MS + 45 * MINUTE_MS;
  const once = normalize({
    mode: "once",
    runAt: new Date(onceAt).toISOString()
  });
  const onceAlarm = buildAlarm(once);

  assert.equal(readAlarmStartMs(onceAlarm, NOW_MS), onceAt, "Once alarm must fire at the exact selected time.");
  assert.equal(readAlarmPeriodMinutes(onceAlarm), null, "Once alarm must not repeat.");
  results.push({ name: "once alarm", when: new Date(onceAt).toISOString(), repeating: false });

  const repeat = normalize({ mode: "repeat", intervalMinutes: 60 });
  const repeatAlarm = buildAlarm(repeat);
  const repeatStart = readAlarmStartMs(repeatAlarm, NOW_MS);

  assert.equal(readAlarmPeriodMinutes(repeatAlarm), 60, "Repeat alarm period must match the selected cadence.");
  assert.equal(repeatStart, NOW_MS + 60 * MINUTE_MS, "Repeat alarm must wait for the selected cadence before its first automatic run.");
  assert.notEqual(repeatStart, NOW_MS + MINUTE_MS, "Repeat alarm regressed to the old one-minute first run.");
  results.push({ name: "repeat alarm", delayMinutes: (repeatStart - NOW_MS) / MINUTE_MS, periodMinutes: 60 });

  const continuous = normalize({
    mode: "continuous",
    intervalMinutes: 5,
    maxRuns: 5,
    expiresAt: new Date(NOW_MS + 60 * MINUTE_MS).toISOString()
  });
  const continuousAlarm = buildAlarm(continuous);
  const continuousStart = readAlarmStartMs(continuousAlarm, NOW_MS);

  assert.equal(readAlarmPeriodMinutes(continuousAlarm), 5, "Continuous alarm period must match the selected cadence.");
  assert.equal(continuousStart, NOW_MS + 5 * MINUTE_MS, "Continuous alarm must wait for its selected cadence before the first run.");
  results.push({ name: "continuous alarm", delayMinutes: 5, periodMinutes: 5 });
}

function runLifecycleChecks() {
  const expiresAtMs = NOW_MS + 60 * MINUTE_MS;
  const continuous = normalize({
    mode: "continuous",
    intervalMinutes: 5,
    maxRuns: 5,
    expiresAt: new Date(expiresAtMs).toISOString()
  });

  const beforeLimit = evaluateState(continuous, {
    completedRuns: 4,
    nowMs: NOW_MS + 30 * MINUTE_MS
  });
  assert.equal(readActive(beforeLimit), true, "Continuous schedule stopped before its max-run or expiry guard.");

  const atLimit = evaluateState(continuous, {
    completedRuns: 5,
    nowMs: NOW_MS + 30 * MINUTE_MS
  });
  assert.equal(readActive(atLimit), false, "Continuous schedule remained active after reaching maxRuns.");
  assert.match(readReason(atLimit), /max|limit|runs?/i, "Max-run stop state must explain why scheduling stopped.");

  const expired = evaluateState(continuous, {
    completedRuns: 2,
    nowMs: expiresAtMs + 1
  });
  assert.equal(readActive(expired), false, "Continuous schedule remained active after expiry.");
  assert.match(readReason(expired), /expir|end|time/i, "Expiry stop state must explain why scheduling stopped.");

  const once = normalize({
    mode: "once",
    runAt: new Date(NOW_MS + 10 * MINUTE_MS).toISOString()
  });
  const onceComplete = evaluateState(once, {
    completedRuns: 1,
    nowMs: NOW_MS + 11 * MINUTE_MS
  });
  assert.equal(readActive(onceComplete), false, "Once schedule remained active after its only run completed.");

  results.push({
    name: "max-run and expiry guards",
    beforeLimit: readActive(beforeLimit),
    atLimit: readReason(atLimit),
    expired: readReason(expired),
    onceComplete: readActive(onceComplete)
  });
}

function normalize(schedule) {
  return scheduler.normalizeWatchSchedule(schedule, NOW_MS);
}

function buildAlarm(schedule) {
  const attempts = [
    () => scheduler.buildWatchAlarmDefinition(schedule, NOW_MS),
    () => scheduler.buildWatchAlarmDefinition({
      id: "watch-schedule-smoke",
      status: "active",
      schedule
    }, NOW_MS)
  ];

  for (const attempt of attempts) {
    try {
      const value = attempt();
      const alarm = value?.createInfo || value?.alarm || value;

      if (alarm && typeof alarm === "object" && (
        Number.isFinite(alarm.when) ||
        Number.isFinite(alarm.delayInMinutes) ||
        Number.isFinite(alarm.periodInMinutes)
      )) {
        return alarm;
      }
    } catch {
      // Try the supported plan-shaped contract next.
    }
  }

  assert.fail("buildWatchAlarmDefinition must return Chrome alarm createInfo, directly or under createInfo/alarm.");
}

function evaluateState(schedule, state) {
  const attempts = [
    () => scheduler.evaluateWatchScheduleState(schedule, state),
    () => scheduler.evaluateWatchScheduleState({
      id: "watch-schedule-smoke",
      status: "active",
      schedule,
      completedRuns: state.completedRuns
    }, state.nowMs),
    () => scheduler.evaluateWatchScheduleState(schedule, state.completedRuns, state.nowMs)
  ];

  for (const attempt of attempts) {
    try {
      const value = attempt();

      if (value && typeof value === "object" && readActive(value) !== null) {
        return value;
      }
    } catch {
      // Try the next documented adapter shape.
    }
  }

  assert.fail("evaluateWatchScheduleState must return an object with active/shouldSchedule/eligible/expired state.");
}

function readMode(schedule) {
  return String(schedule?.mode || schedule?.type || schedule?.kind || "").toLowerCase();
}

function readIntervalMinutes(schedule) {
  return Number(schedule?.intervalMinutes ?? schedule?.cadenceMinutes ?? schedule?.periodMinutes);
}

function readMaxRuns(schedule) {
  return Number(schedule?.maxRuns ?? schedule?.runLimit ?? schedule?.limit);
}

function readTimestamp(value, fields) {
  for (const field of fields) {
    const candidate = value?.[field];
    const timestamp = typeof candidate === "number" ? candidate : Date.parse(candidate || "");

    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return NaN;
}

function readAlarmStartMs(alarm, nowMs) {
  if (Number.isFinite(alarm?.when)) {
    return alarm.when;
  }

  if (Number.isFinite(alarm?.delayInMinutes)) {
    return nowMs + alarm.delayInMinutes * MINUTE_MS;
  }

  return NaN;
}

function readAlarmPeriodMinutes(alarm) {
  return Number.isFinite(alarm?.periodInMinutes) ? alarm.periodInMinutes : null;
}

function readActive(state) {
  if (typeof state?.active === "boolean") {
    return state.active;
  }

  if (typeof state?.shouldSchedule === "boolean") {
    return state.shouldSchedule;
  }

  if (typeof state?.eligible === "boolean") {
    return state.eligible;
  }

  if (typeof state?.expired === "boolean") {
    return !state.expired;
  }

  return null;
}

function readReason(state) {
  return String(state?.reason || state?.stopReason || state?.status || "");
}

async function loadSchedulerTestApi() {
  const originalSource = await readFile(backgroundPath, "utf8");
  const executableSource = stripModuleSyntax(originalSource);
  const context = createBackgroundContext();
  const discoverySource = `
    globalThis.__LUMEN_DISCOVERED_WATCH_SCHEDULE_API__ =
      globalThis.__LUMEN_WATCH_SCHEDULE_TEST_API__ || {
        normalizeWatchSchedule:
          typeof normalizeWatchSchedule === "function" ? normalizeWatchSchedule :
          typeof normalizeWatchScheduleDefinition === "function" ? normalizeWatchScheduleDefinition : null,
        buildWatchAlarmDefinition:
          typeof buildWatchAlarmDefinition === "function" ? buildWatchAlarmDefinition :
          typeof buildWatchAlarmCreateInfo === "function" ? buildWatchAlarmCreateInfo : null,
        evaluateWatchScheduleState:
          typeof evaluateWatchScheduleState === "function" ? evaluateWatchScheduleState :
          typeof evaluateWatchPlanLifecycle === "function" ? evaluateWatchPlanLifecycle : null
      };
  `;

  vm.runInContext(`${executableSource}\n${discoverySource}`, context, {
    filename: backgroundPath,
    timeout: 5_000
  });

  const api = context.__LUMEN_DISCOVERED_WATCH_SCHEDULE_API__;
  const missing = [
    "normalizeWatchSchedule",
    "buildWatchAlarmDefinition",
    "evaluateWatchScheduleState"
  ].filter((name) => typeof api?.[name] !== "function");

  if (missing.length) {
    throw new Error([
      `Missing scheduler test hooks: ${missing.join(", ")}.`,
      "Expose pure helpers in background.js under those names, or assign them to",
      "globalThis.__LUMEN_WATCH_SCHEDULE_TEST_API__. The helpers must not call Chrome APIs.",
      "Expected contracts:",
      "  normalizeWatchSchedule(schedule, nowMs) -> normalized schedule",
      "  buildWatchAlarmDefinition(scheduleOrPlan, nowMs) -> Chrome alarm createInfo",
      "  evaluateWatchScheduleState(scheduleOrPlan, { completedRuns, nowMs }) -> { active, reason }"
    ].join("\n"));
  }

  return api;
}

function stripModuleSyntax(source) {
  return source
    .replace(/^\s*import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^\s*export\s*\{[\s\S]*?\};?\s*$/gm, "")
    .replace(/^\s*export\s+(?=(?:async\s+)?function\b|(?:const|let|var|class)\b)/gm, "");
}

function createBackgroundContext() {
  const event = {
    addListener() {},
    removeListener() {}
  };
  const chrome = {
    alarms: {
      onAlarm: event,
      async clear() {
        return true;
      },
      async create() {}
    },
    runtime: {
      onInstalled: event,
      onMessage: event,
      getManifest() {
        return { host_permissions: [] };
      },
      getURL(value = "") {
        return `chrome-extension://lumen-smoke/${value}`;
      },
      async sendMessage() {}
    }
  };

  return vm.createContext({
    URL,
    chrome,
    console,
    crypto: globalThis.crypto,
    structuredClone,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder
  });
}
