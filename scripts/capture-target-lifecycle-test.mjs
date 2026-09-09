import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const start = background.indexOf("async function createCaptureTarget(");
const end = background.indexOf("async function calibrateCaptureViewport(", start);
assert(start >= 0 && end > start);
const source = background.slice(start, end);
const variant = { mode: "viewport", label: "Tablet", viewport: { width: 1024, height: 1366 } };

for (const failure of ["missing tab", "query rejection", "navigation timeout", "success"]) {
  test(`temporary capture window lifecycle: ${failure}`, async () => {
    const closed = [];
    const context = vm.createContext({
      chrome: {
        windows: { create: async () => ({ id: 71 }) },
        tabs: { query: async () => {
          if (failure === "query rejection") throw new Error(failure);
          return failure === "missing tab" ? [] : [{ id: 82 }];
        } }
      },
      waitForTabComplete: async () => {
        if (failure === "navigation timeout") throw new Error(failure);
      },
      sleep: async () => {},
      createFriendlyError: (title, description) => new Error(`${title}: ${description}`),
      closeWindowSafely: async (id) => closed.push(id)
    });
    vm.runInContext(source, context);
    const pending = context.createCaptureTarget({ url: "https://example.test" }, variant);
    if (failure === "success") {
      assert.equal((await pending).windowId, 71);
      assert.deepEqual(closed, []);
    } else {
      await assert.rejects(pending);
      assert.deepEqual(closed, [71]);
    }
  });
}
