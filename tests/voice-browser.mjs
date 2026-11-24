// Optional browser verification: install Playwright separately or pass its module path.
import test, {after} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, cp, readFile, writeFile, rm} from "node:fs/promises";
import {fileURLToPath, pathToFileURL} from "node:url";
import {join} from "node:path";
import {build} from "../skills/motion-explainer/scripts/build.mjs";
const {chromium} = await import(process.env.MOTION_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MOTION_PLAYWRIGHT_MODULE).href : "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = await mkdtemp("/tmp/motion-voice-test-");
await cp(join(root, "skills/motion-explainer/examples/order-queue"), folder, {recursive: true});
const spec = JSON.parse(await readFile(join(folder, "explainer.json"), "utf8"));
spec.flows[0].steps = ["`API` validates **input**.", "The next stage runs.", "The request completes."].map(say => ({focus: ["api"], say}));
spec.flows[1].steps = [{focus: ["worker"], say: "The failure path runs."}];
await writeFile(join(folder, "explainer.json"), JSON.stringify(spec));
assert.equal((await build(folder, {offline: true, strict: true})).ok, true);
const browser = await chromium.launch({headless: true});
after(async () => {await browser.close(); await rm(folder, {recursive: true, force: true});});
const url = pathToFileURL(join(folder, "index.html")).href;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {for (let i = 0; i < 100; i++) {if (await fn()) return; await wait(40);} throw new Error("Browser condition timed out");}
async function pageFor(t) {
  const context = await browser.newContext({reducedMotion: "reduce", viewport: {width: 1200, height: 900}});
  t.after(() => context.close()); const page = await context.newPage();
  page.on("pageerror", error => assert.fail(error.message));
  await page.addInitScript(() => {
    window.__utterances = []; window.__paused = false; window.__cancels = 0;
    window.SpeechSynthesisUtterance = class {constructor(text) {this.text = text;}};
    Object.defineProperty(window, "speechSynthesis", {configurable: true, value: {
      getVoices: () => [{voiceURI: "local-one", name: "Local narrator", lang: "en-GB", localService: true}, {voiceURI: "local-two", name: "Second narrator", lang: "en-US", localService: true}],
      addEventListener() {}, removeEventListener() {},
      speak(utterance) {window.__utterances.push(utterance); window.__active = utterance; queueMicrotask(() => utterance.onstart?.());},
      cancel() {window.__cancels++;}, pause() {window.__paused = true;}, resume() {window.__paused = false;},
    }});
  });
  return page;
}
const step = page => new URL(page.url()).hash;
const finish = page => page.evaluate(() => window.__active.onend());

test("voice is enabled by default, selects system voices, and waits for narration under native autoplay", async t => {
  const page = await pageFor(t);
  await page.addInitScript(() => {window.acquireVsCodeApi = () => ({setState() {}, postMessage(message) {if (message.type === "motion:ready") queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", {data: {type: "motion:configure", file: "/demo/index.html", autoplay: true}})));}});});
  await page.goto(url);
  await until(() => page.evaluate(() => window.__utterances.length === 1));
  assert.equal(await page.locator("#voiceEnabled").isChecked(), true);
  assert.equal(await page.locator("#voiceSelect option").count(), 3);
  assert.equal(await page.evaluate(() => window.__active.text), "API validates input.");
  await wait(900); assert.equal(step(page), "#happy-path/1");
  await page.getByRole("button", {name: "Pause", exact: true}).click();
  assert.equal(await page.evaluate(() => window.__paused), true);
  await finish(page); await wait(150); assert.equal(step(page), "#happy-path/1");
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => step(page) === "#happy-path/2");
  assert.equal(await page.evaluate(() => window.__utterances.length), 2);
  await finish(page); await until(() => step(page) === "#happy-path/3"); await finish(page);
  await until(() => page.getByRole("button", {name: "Play", exact: true}).isVisible());
});

test("manual stepping and flow changes cancel narration and ignore stale speech callbacks", async t => {
  const page = await pageFor(t); await page.goto(url);
  await page.getByRole("button", {name: "Next step", exact: true}).click();
  await page.evaluate(() => {window.__old = window.__active;});
  await page.getByRole("button", {name: "Next step", exact: true}).click();
  await page.evaluate(() => window.__old.onend()); assert.equal(step(page), "#happy-path/2");
  await page.getByRole("tab", {name: /Payment keeps failing/}).click();
  await page.getByRole("button", {name: "Next step", exact: true}).click();
  await page.evaluate(() => window.__old.onend()); await wait(150);
  assert.equal(step(page), "#payment-fails/1");
  assert.equal(await page.evaluate(() => window.__active.text), "The failure path runs.");
  assert.ok(await page.evaluate(() => window.__cancels > 2));
});

test("voice and speed changes restart only the current narration and preferences survive reload", async t => {
  const page = await pageFor(t); await page.goto(url);
  await page.getByRole("button", {name: "Next step", exact: true}).click();
  await page.getByTitle("Playback speed").click();
  assert.equal(await page.evaluate(() => window.__active.rate), 1.5);
  await page.getByRole("combobox", {name: "Narration voice"}).selectOption("local-two");
  assert.equal(await page.evaluate(() => window.__active.voice.voiceURI), "local-two");
  assert.equal(step(page), "#happy-path/1");
  await page.locator("#voiceEnabled").uncheck(); await page.reload();
  assert.equal(await page.locator("#voiceEnabled").isChecked(), false);
  assert.equal(await page.locator("#voiceSelect").inputValue(), "local-two");
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({path: join(root, "trial-results/voiceover-mobile.png"), fullPage: true});
});

test("silent playback uses readable pacing and pausing freezes it", async t => {
  const page = await pageFor(t); await page.goto(url); await page.locator("#voiceEnabled").uncheck();
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => step(page) === "#happy-path/1"); await wait(250);
  await page.getByRole("button", {name: "Pause", exact: true}).click(); await wait(2300);
  assert.equal(step(page), "#happy-path/1");
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => step(page) === "#happy-path/2");
  assert.equal(await page.evaluate(() => window.__utterances.length), 0);
});

test("manual navigation after pause resumes the speech engine and failed speech falls back", async t => {
  const page = await pageFor(t); await page.goto(url);
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => step(page) === "#happy-path/1");
  await page.getByRole("button", {name: "Pause", exact: true}).click();
  await page.getByRole("button", {name: "Next step", exact: true}).click();
  assert.equal(await page.evaluate(() => window.__paused), false);
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await page.evaluate(() => window.__active.onerror({error: "voice-unavailable"}));
  assert.equal(await page.locator("#voiceStatus").isVisible(), true);
  await until(() => step(page) === "#happy-path/3");
});


test("toggling voice during autoplay waits for the newly enabled narration", async t => {
  const page = await pageFor(t); await page.goto(url);
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => step(page) === "#happy-path/1");
  await page.locator("#voiceEnabled").uncheck(); await wait(100); await page.locator("#voiceEnabled").check();
  await wait(200); assert.equal(step(page), "#happy-path/1");
  assert.equal(await page.evaluate(() => window.__utterances.length), 2);
  await finish(page); await until(() => step(page) === "#happy-path/2");
});

test("pausing freezes the camera animation and resumes the same step", async t => {
  const page = await pageFor(t); await page.emulateMedia({reducedMotion: "no-preference"}); await page.goto(url);
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => step(page) === "#happy-path/1"); await wait(100);
  await page.getByRole("button", {name: "Pause", exact: true}).click();
  const paused = await page.locator("#stage > svg").getAttribute("viewBox");
  await wait(200); assert.equal(await page.locator("#stage > svg").getAttribute("viewBox"), paused);
  await page.getByRole("button", {name: "Play", exact: true}).click(); await wait(200);
  assert.notEqual(await page.locator("#stage > svg").getAttribute("viewBox"), paused);
  assert.equal(step(page), "#happy-path/1");
});


test("Play narrates the current step when opening a saved deep link", async t => {
  const page = await pageFor(t); await page.goto(url + "#happy-path/2");
  assert.equal(await page.evaluate(() => window.__utterances.length), 0);
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => page.evaluate(() => window.__utterances.length === 1));
  assert.equal(await page.evaluate(() => window.__active.text), "The next stage runs.");
  assert.equal(step(page), "#happy-path/2");
});

test("restored native tabs stay silent until Play", async t => {
  const page = await pageFor(t);
  await page.addInitScript(() => {window.acquireVsCodeApi = () => ({setState() {}, postMessage(message) {if (message.type === "motion:ready") queueMicrotask(() => window.dispatchEvent(new MessageEvent("message", {data: {type: "motion:configure", file: "/demo/index.html", flow: "happy-path", step: 2, autoplay: false}})));}});});
  await page.goto(url); await until(() => step(page) === "#happy-path/2");
  await wait(300); assert.equal(await page.evaluate(() => window.__utterances.length), 0);
  await page.getByRole("button", {name: "Play", exact: true}).click();
  await until(() => page.evaluate(() => window.__utterances.length === 1));
  assert.equal(await page.evaluate(() => window.__active.text), "The next stage runs.");
});

test("paused diagrams support scroll, drag, zoom and fit; playback owns the camera", async t => {
  const page = await pageFor(t); await page.goto(url);
  const canvas = page.locator("#stage > svg"), box = await canvas.boundingBox();
  const initial = await canvas.getAttribute("viewBox");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 100); await wait(50);
  assert.notEqual(await canvas.getAttribute("viewBox"), initial);
  await page.getByRole("button", {name: "Zoom in", exact: true}).click();
  const zoomed = (await canvas.getAttribute("viewBox")).split(" ").map(Number);
  assert.ok(zoomed[2] < Number(initial.split(" ")[2]));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, {steps: 4}); await page.mouse.up();
  assert.ok(Math.abs(Number((await canvas.getAttribute("viewBox")).split(" ")[0]) - zoomed[0]) > 1);
  const released = await canvas.getAttribute("viewBox");
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60);
  assert.equal(await canvas.getAttribute("viewBox"), released, "releasing the pointer must end panning");
  await page.getByRole("button", {name: "Fit diagram", exact: true}).click();
  assert.equal(await canvas.getAttribute("viewBox"), initial);
  await page.locator("#stage").focus(); await page.keyboard.press("ArrowRight");
  assert.equal(step(page), "#happy-path/0"); assert.notEqual(await canvas.getAttribute("viewBox"), initial);
  await page.getByRole("button", {name: "Play", exact: true}).click();
  assert.equal(await page.getByRole("button", {name: "Zoom in", exact: true}).isDisabled(), true);
  const playing = await canvas.getAttribute("viewBox");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 100); await wait(50);
  assert.equal(await canvas.getAttribute("viewBox"), playing);
  await page.getByRole("button", {name: "Pause", exact: true}).click();
  assert.equal(await page.getByRole("button", {name: "Zoom in", exact: true}).isEnabled(), true);
});

test("consumer walkthrough keeps every focused node inside a narrow canvas", {skip: !process.env.MOTION_CONSUMER_DIR}, async t => {
  const directory = process.env.MOTION_CONSUMER_DIR;
  assert.equal((await build(directory, {offline: true, strict: true})).ok, true);
  const consumer = JSON.parse(await readFile(join(directory, "explainer.json"), "utf8"));
  const page = await pageFor(t);
  await page.goto(pathToFileURL(join(directory, "index.html")).href);
  await page.locator("#voiceEnabled").uncheck();
  for (const width of [1200, 750, 390]) {
    await page.setViewportSize({width, height: 700});
    for (let flow = 0; flow < consumer.flows.length; flow++) {
      await page.locator(`[data-flow="${flow}"]`).click();
      for (let index = 0; index < consumer.flows[flow].steps.length; index++) {
        await page.locator(`[data-step="${index + 1}"]`).click();
        const missing = await page.evaluate(() => {
          const stage = document.getElementById("stage").getBoundingClientRect();
          return [...document.querySelectorAll("#stage .me-focus")].filter(el => {
            const r = el.getBoundingClientRect();
            return r.left < stage.left - 1 || r.right > stage.right + 1 || r.top < stage.top - 1 || r.bottom > stage.bottom + 1;
          }).map(el => el.dataset.node || el.dataset.nodeLabel || el.dataset.sub);
        });
        assert.deepEqual(missing, [], `clipped nodes at ${width}px, flow ${flow}, step ${index + 1}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
    }
    await page.getByRole("button", {name: "Play", exact: true}).click();
    const stage = await page.locator("#stage").boundingBox();
    assert.ok(stage.y >= -1 && stage.y + stage.height <= 700, `canvas must stay on screen at ${width}px`);
    await page.getByRole("button", {name: "Pause", exact: true}).click();
    await page.screenshot({path: join(root, `trial-results/canvas-${width}.png`), fullPage: true});
  }
  await page.getByRole("button", {name: "Toggle theme", exact: true}).click();
  await page.screenshot({path: join(root, "trial-results/canvas-mobile-light.png"), fullPage: true});
});
