import { AreaReviewMessage } from "./area-review-controller.js";

const id = new URL(location.href).searchParams.get("id");
const ui = Object.fromEntries(["mode", "source", "areaMap", "geometry", "checks", "warnings", "status", "cancel", "approve"].map(key => [key, document.getElementById(key)]));
let loaded = false;
let finished = false;

function render(review) {
  ui.mode.textContent = review.privateReview ? "Private Review Mode" : "Review before save";
  ui.source.textContent = review.host;
  const { region, page } = review;
  ui.areaMap.setAttribute("viewBox", `0 0 ${page.viewportWidth} ${page.viewportHeight}`);
  const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  const points = region.shape === "lasso" ? region.points : [
    { x: region.left, y: region.top }, { x: region.left + region.width, y: region.top },
    { x: region.left + region.width, y: region.top + region.height }, { x: region.left, y: region.top + region.height }
  ];
  polygon.setAttribute("points", points.map(point => `${point.x - page.scrollLeft},${point.y - page.scrollTop}`).join(" "));
  ui.areaMap.replaceChildren(polygon);
  ui.geometry.textContent = `${region.shape === "lasso" ? "Lasso" : "Rectangle"} / ${Math.round(region.width)} x ${Math.round(region.height)} CSS px`;
  for (const [label, value] of [
    ["Automatic redaction", review.autoRedact ? "On" : "Off"],
    ["Page scan matches", review.autoRedact ? String(review.autoRedactionCount) : "Not run"],
    ["Manual boxes on page", String(review.manualAppliedCount)],
    ["Capture details file", review.exportManifest ? "Included" : "Off"]
  ]) {
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = value;
    ui.checks.append(term, detail);
  }
  for (const warning of review.warnings) {
    const item = document.createElement("li"); item.textContent = warning;
    ui.warnings.append(item);
  }
  ui.status.textContent = "Nothing has been saved. Approval expires after two minutes. Keep the source page in place.";
  ui.approve.disabled = false;
  ui.cancel.focus();
}

async function refresh() {
  if (finished) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: AreaReviewMessage.READ, id });
    if (!response?.ok) throw new Error(response?.error || "This review is unavailable. Select the area again.");
    if (!loaded) { render(response.review); loaded = true; }
  } catch (error) {
    ui.status.textContent = error.message;
    ui.approve.disabled = true;
    finished = true;
    clearInterval(timer);
  }
}

async function decide(approved) {
  if (finished || !loaded) { if (!approved) window.close(); return; }
  ui.approve.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: AreaReviewMessage.DECIDE, id, approved });
    if (!response?.ok) throw new Error(response?.error || "Approval failed. Select the area again.");
    finished = true;
    clearInterval(timer);
    window.close();
  } catch (error) {
    ui.status.textContent = error.message;
    finished = true;
    clearInterval(timer);
  }
}

ui.approve.addEventListener("click", () => decide(true));
ui.cancel.addEventListener("click", () => decide(false));
document.addEventListener("keydown", event => { if (event.key === "Escape") decide(false); });
// A bounded heartbeat also detects worker restart; a lost approval fails closed.
const timer = setInterval(refresh, 10000);
await refresh();
