import assert from "node:assert/strict";
import test from "node:test";
import { AreaReviewMessage, createAreaReviewController, sameAreaReviewPage } from "../area-review-controller.js";

function harness(options) {
  let removedListener;
  let openedUrl;
  const removed = [];
  const api = {
    runtime: { getURL: path => `chrome-extension://fixture/${path}` },
    windows: {
      onRemoved: { addListener: listener => { removedListener = listener; } },
      create: async ({ url }) => { openedUrl = url; return { id: 7, tabs: [{ id: 9 }] }; },
      remove: async id => { removed.push(id); }
    }
  };
  const controller = createAreaReviewController(api, options);
  const message = (approved, override = {}) => ({
    type: approved === undefined ? AreaReviewMessage.READ : AreaReviewMessage.DECIDE,
    id: new URL(openedUrl).searchParams.get("id"), approved, ...override
  });
  const sender = () => ({ url: openedUrl, tab: { id: 9, windowId: 7 } });
  const send = (request, source = sender()) => {
    let response;
    assert.equal(controller.handle(request, source, value => { response = value; }), true);
    return response;
  };
  return { controller, api, removed, message, sender, send, close: () => removedListener(7) };
}

test("approval belongs to its exact extension page and can be consumed only once", async () => {
  const h = harness();
  const request = h.controller.request({ host: "example.test" });
  await Promise.resolve();
  assert.equal(h.send(h.message()).review.host, "example.test");
  assert.equal(h.send(h.message(true), { url: "https://example.test/", tab: { id: 9, windowId: 7 } }).ok, false);
  assert.equal(h.send(h.message(true), { ...h.sender(), tab: { id: 10, windowId: 7 } }).ok, false);
  assert.equal(h.send(h.message(true), { ...h.sender(), tab: { id: 9, windowId: 8 } }).ok, false);
  assert.equal(h.send(h.message(true, { id: "forged" })).ok, false);
  assert.equal(h.send(h.message("yes")).ok, false);
  assert.equal(h.send(h.message(true)).ok, true);
  assert.equal(await request, true);
  assert.equal(h.send(h.message(true)).ok, false);
  assert.deepEqual(h.removed, [7]);
});

for (const action of ["cancel", "close", "timeout"]) {
  test(`${action} saves nothing and permits another review`, async () => {
    const h = harness({ timeoutMs: 20 });
    const request = h.controller.request({});
    await Promise.resolve();
    if (action === "cancel") h.send(h.message(false));
    if (action === "close") h.close();
    assert.equal(await request, false);
    const next = h.controller.request({});
    await Promise.resolve();
    h.controller.cancel();
    assert.equal(await next, false);
  });
}

test("opening failure and worker restart fail closed", async () => {
  const h = harness();
  h.api.windows.create = async () => { throw new Error("Window unavailable"); };
  await assert.rejects(h.controller.request({}), /Window unavailable/);
  let response;
  h.controller.handle({ type: AreaReviewMessage.DECIDE, id: "old", approved: true }, {}, value => { response = value; });
  assert.equal(response.ok, false);
});

test("a second request cannot replace the pending selection", async () => {
  const h = harness();
  const first = h.controller.request({ host: "first.test" });
  await Promise.resolve();
  await assert.rejects(h.controller.request({ host: "second.test" }), /already open/);
  assert.equal(h.send(h.message()).review.host, "first.test");
  h.controller.cancel();
  assert.equal(await first, false);
});

test("approval geometry expires on navigation, scroll, zoom and viewport movement", () => {
  const page = { url: "https://example.test", viewportWidth: 1000, viewportHeight: 700,
    browserViewportWidth: 1000, browserViewportHeight: 700, scrollTop: 100, scrollLeft: 0,
    scrollMode: "document", scrollContainer: "document", devicePixelRatio: 2,
    captureRect: { left: 0, top: 0, width: 1000, height: 700 } };
  assert.equal(sameAreaReviewPage(page, structuredClone(page)), true);
  for (const [key, value] of Object.entries(page)) {
    if (key === "captureRect") continue;
    assert.equal(sameAreaReviewPage(page, { ...page, [key]: typeof value === "number" ? value + 1 : `${value}changed` }), false, key);
  }
  assert.equal(sameAreaReviewPage(page, { ...page, captureRect: { ...page.captureRect, left: 10 } }), false);
  assert.equal(sameAreaReviewPage(null, page), false);
});
