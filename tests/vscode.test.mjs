import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, cp, readFile, writeFile, rm, symlink} from "node:fs/promises";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
import Module from "node:module";
import {inside, playerHtml, sourceLocation} from "../vscode/runtime.mjs";
import {build} from "../skills/motion-explainer/scripts/build.mjs";
import {listHistory, snapshotFiles} from "../skills/motion-explainer/scripts/history.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
async function waitFor(fn) {
  for (let i = 0; i < 100; i++) {if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 30));}
  assert.fail("Extension condition timed out");
}
async function fixture(t) {
  const temporary = await mkdtemp("/tmp/motion-vscode-test-");
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const workspace = join(temporary, "workspace"), extension = join(temporary, "extension"), directory = join(workspace, "explainers/order-queue");
  await mkdir(join(workspace, ".git"), {recursive: true}); await mkdir(extension, {recursive: true});
  await cp(join(root, "skills/motion-explainer"), join(extension, "skill"), {recursive: true});
  await cp(join(root, "vscode/runtime.mjs"), join(extension, "runtime.mjs"));
  await cp(join(root, "skills/motion-explainer/examples/order-queue"), directory, {recursive: true});
  // Generated HTML is not committed. Fixtures must work on a clean checkout,
  // including when the release workflow tests before packaging examples.
  for (const target of [directory, join(extension, "skill/examples/order-queue")]) {
    await rm(join(target, "index.html"), {force: true});
    assert.equal((await build(target, {offline: true, strict: true})).ok, true);
  }
  await writeFile(join(workspace, "app.js"), "first\nsecond\nthird\n");
  return {temporary, workspace, extension, directory, index: join(directory, "index.html")};
}

test("portable bundled demos omit build-machine paths and retain native source references", async t => {
  const files = await fixture(t);
  const directory = join(files.extension, "skill/examples/build-pipeline");
  const result = await build(directory, {offline: true, strict: true, portable: true});
  assert.equal(result.ok, true);
  const html = await readFile(result.outPath, "utf8");
  assert.equal(html.includes(files.temporary), false);
  const data = JSON.parse(html.match(/const DATA = (.*);/)[1]);
  assert.equal(data.root, "");
  assert.deepEqual(await sourceLocation(directory, {file: "scripts/build.mjs", line: 42}, [files.extension]), {file: join(files.extension, "skill/scripts/build.mjs"), line: 42});
});

test("player and source references respect real workspace boundaries, including symlinks", async t => {
  const files = await fixture(t);
  assert.equal(inside(files.workspace + "-other/file", files.workspace), false);
  assert.ok((await playerHtml(files.index, [files.workspace])).html.includes("motion-explainer player."));
  assert.deepEqual(await sourceLocation(files.directory, {file: "app.js", line: 2}, [files.workspace]), {file: join(files.workspace, "app.js"), line: 2});
  const outside = join(files.temporary, "private.txt"); await writeFile(outside, "test fixture");
  await assert.rejects(() => sourceLocation(files.directory, {file: "../private.txt", line: 1}, [files.workspace]), /inside this workspace/);
  await symlink(outside, join(files.workspace, "link.txt"));
  await assert.rejects(() => sourceLocation(files.directory, {file: "link.txt", line: 1}, [files.workspace]), /inside this workspace/);
  await assert.rejects(() => sourceLocation(files.directory, {file: "app.js", line: -1}, [files.workspace]), /Invalid source/);
});

async function harness(t) {
  const files = await fixture(t), commands = new Map(), watchers = [], panels = [], opened = [], messages = [], logs = [], trees = new Map();
  const uri = file => ({scheme: "file", fsPath: file, toString: () => "file://" + file});
  const settings = {enabled: true, offline: true, autoOpen: true, autoRebuild: true, autoPlay: true};
  const folders = [{uri: uri(files.workspace)}], discovery = [files.directory], dialog = {confirm: null};
  const context = {extensionPath: files.extension, subscriptions: []};
  const disposable = () => ({dispose() {}});
  class Emitter {event = () => disposable(); fire() {} dispose() {}}
  const makePanel = () => {
    let received;
    const panel = {htmlWrites: [], webview: {onDidReceiveMessage(fn) {received = fn; return disposable();}, async postMessage(message) {messages.push(message);}},
      onDidDispose(fn) {this.closed = fn;}, dispose() {this.closed?.();}, reveal() {}, receive: message => received(message)};
    Object.defineProperty(panel.webview, "html", {get: () => panel.htmlWrites.at(-1), set(value) {panel.htmlWrites.push(value); queueMicrotask(() => void received({type: "motion:ready"}));}});
    return panel;
  };
  const vscode = {
    EventEmitter: Emitter, StatusBarAlignment: {Right: 2}, ViewColumn: {Beside: 2, One: 1}, Uri: {file: uri}, Range: class {constructor(line) {this.start = {line};}},
    commands: {registerCommand(id, action) {commands.set(id, action); return disposable();}, executeCommand(id, ...args) {return commands.get(id)?.(...args);}},
    workspace: {isTrusted: true, workspaceFolders: folders, getConfiguration: () => ({get: (key, fallback) => settings[key] ?? fallback}), asRelativePath: file => file,
      async findFiles(glob) {return discovery.map(directory => uri(join(directory, glob.endsWith("index.html") ? "index.html" : "explainer.json")));}, onDidChangeConfiguration: () => disposable(),
      async openTextDocument(file) {return {uri: file, content: file.content, lineCount: (file.content ?? await readFile(file.fsPath, "utf8")).split("\n").length};},
      createFileSystemWatcher(glob) {const listeners = {}; const watcher = {glob, listeners, onDidCreate(fn) {listeners.create = fn; return disposable();}, onDidChange(fn) {listeners.change = fn; return disposable();}, onDidDelete(fn) {listeners.delete = fn; return disposable();}, dispose() {}}; watchers.push(watcher); return watcher;},
    },
    window: {createOutputChannel: () => ({appendLine: text => logs.push(text), show() {}, dispose() {}}), createStatusBarItem: () => ({show() {}, dispose() {}}),
      registerTreeDataProvider(id, tree) {trees.set(id, tree); return disposable();}, registerWebviewPanelSerializer: () => disposable(),
      createWebviewPanel() {const panel = makePanel(); panels.push(panel); return panel;}, showErrorMessage: text => logs.push(text), showInformationMessage() {},
      async showTextDocument(document, options) {opened.push({document, options});}, showQuickPick: async items => items[0],
      async showWarningMessage() {return dialog.confirm;},
    },
  };
  const file = join(root, "vscode/extension.cjs"), original = Module._load;
  Module._load = function(name, parent, ...rest) {return name === "vscode" && parent?.filename === file ? vscode : original.call(this, name, parent, ...rest);};
  let extension;
  try {delete require.cache[file]; extension = require(file);} finally {Module._load = original;}
  extension.activate(context);
  t.after(() => {for (const item of context.subscriptions) item.dispose?.();});
  return {...files, commands, watchers, panels, opened, messages, logs, uri, settings, trees, folders, discovery, dialog};
}

test("native sample uses the packaged player, ready handshake and safe source links", async t => {
  const app = await harness(t);
  await app.commands.get("motionExplainer.sample")();
  assert.equal(app.panels.length, 1); assert.doesNotMatch(app.panels[0].webview.html, /<iframe/);
  assert.equal(app.messages.at(-1).type, "motion:configure");
  await app.commands.get("motionExplainer.open")(app.uri(app.index));
  assert.equal(app.panels.length, 1);
  await app.panels[0].receive({type: "motion:open-source", file: "app.js", line: 2});
  assert.equal(app.opened[0].options.selection.start.line, 1);
  const outside = join(app.temporary, "private.txt"); await writeFile(outside, "fixture");
  await app.panels[0].receive({type: "motion:open-source", file: "../private.txt", line: 1});
  assert.equal(app.opened.length, 1); assert.ok(app.logs.some(message => message.includes("inside this workspace")));
});

test("history groups projects, replays separately, opens saved source copies and deletes only confirmed versions", async t => {
  const app = await harness(t);
  await waitFor(() => app.logs.some(message => message.startsWith("Monitoring")));
  await app.commands.get("motionExplainer.open")(app.uri(app.index));
  const first = (await listHistory(app.directory))[0];
  const old = await snapshotFiles(app.directory, first.id);
  const specFile = join(app.directory, "explainer.json"), spec = JSON.parse(await readFile(specFile, "utf8"));
  spec.flows[0].steps[0].say = "A new version of this walkthrough.";
  await writeFile(specFile, JSON.stringify(spec));
  await app.commands.get("motionExplainer.build")(app.uri(specFile));
  const live = app.panels[0].webview.html;
  await app.commands.get("motionExplainer.historyOpen")({directory: app.directory, id: first.id});
  assert.equal(app.panels.length, 2);
  assert.equal(app.panels[0].webview.html, live);
  assert.equal(app.panels[1].webview.html, await readFile(old.html, "utf8"));
  assert.equal(app.messages.at(-1).autoplay, false);
  await app.panels[1].receive({type: "motion:open-source", file: "app.js", line: 2});
  assert.equal(app.opened.at(-1).options.selection.start.line, 1);
  await app.commands.get("motionExplainer.historySources")({directory: app.directory, id: first.id});
  assert.ok(app.opened.at(-1).document.content.includes(spec.title));
  const writes = app.panels[0].htmlWrites.length;
  app.watchers[0].listeners.change(app.uri(old.html));
  app.watchers[1].listeners.change(app.uri(old.spec));
  await new Promise(resolve => setTimeout(resolve, 650));
  assert.equal(app.panels[0].htmlWrites.length, writes, "archive events must not reopen or rebuild");
  const secondWorkspace = join(app.temporary, "second-workspace"), second = join(secondWorkspace, "explainers/orders");
  await mkdir(join(secondWorkspace, ".git"), {recursive: true});
  await cp(join(root, "skills/motion-explainer/examples/order-queue"), second, {recursive: true});
  await build(second, {offline: true, strict: true});
  app.folders.push({uri: app.uri(secondWorkspace)}); app.discovery.push(second);
  const groups = await app.trees.get("motionExplainer.history").getChildren();
  assert.equal(groups.length, 2);
  const versions = await app.trees.get("motionExplainer.history").getChildren(groups.find(group => group.directory === app.directory));
  assert.equal(versions.length, 2);
  await app.commands.get("motionExplainer.historyDelete")({directory: app.directory, id: first.id});
  assert.equal((await listHistory(app.directory)).length, 2, "cancel must preserve the version");
  app.dialog.confirm = "Delete version";
  await app.commands.get("motionExplainer.historyDelete")({directory: app.directory, id: first.id});
  assert.equal((await listHistory(app.directory)).length, 1);
  assert.equal(app.panels[0].webview.html, live);
  assert.equal(await readFile(app.index, "utf8"), live);
});

test("generated files auto-open and follow-up saves rebuild the same player; invalid saves preserve the last valid view", async t => {
  const app = await harness(t);
  app.watchers[0].listeners.create(app.uri(app.index));
  await waitFor(() => app.panels.length === 1 && app.messages.length);
  assert.equal(app.messages.at(-1).autoplay, true);
  const before = app.panels[0].htmlWrites.length;
  const specFile = join(app.directory, "explainer.json"), spec = JSON.parse(await readFile(specFile, "utf8"));
  spec.flows[0].steps[0].say = "Follow-up explanation grounded in the changed source.";
  await writeFile(specFile, JSON.stringify(spec));
  app.watchers[1].listeners.change(app.uri(specFile));
  await waitFor(() => app.panels[0].htmlWrites.length > before);
  assert.equal(app.panels.length, 1); assert.ok(app.panels[0].webview.html.includes("Follow-up explanation"));
  const valid = app.panels[0].webview.html;
  await writeFile(specFile, "{"); app.watchers[1].listeners.change(app.uri(specFile));
  await waitFor(() => app.logs.some(message => /JSON|Expected property/.test(message)));
  assert.equal(app.panels[0].webview.html, valid);
  await writeFile(join(app.temporary, "private.kymo"), 'secret fixture');
  spec.diagram = "../../../private.kymo";
  await writeFile(specFile, JSON.stringify(spec));
  app.watchers[1].listeners.change(app.uri(specFile));
  await waitFor(() => app.logs.some(message => message.includes("inside this workspace")));
  assert.equal(app.panels[0].webview.html, valid);
});

test("walkthrough updates auto-open when VS Code drops file watcher events", async t => {
  const app = await harness(t);
  await waitFor(() => app.logs.some(message => message.startsWith("Monitoring")));
  assert.equal(app.panels.length, 0, "startup must not play existing walkthroughs");
  await writeFile(app.index, (await readFile(app.index, "utf8")) + "\n<!-- updated walkthrough -->");
  await waitFor(() => app.panels.length === 1 && app.messages.length);
  assert.equal(app.messages.at(-1).autoplay, true);
  assert.ok(app.logs.some(message => message.startsWith("Detected walkthrough update:")));
  const writes = app.panels[0].htmlWrites.length;
  await new Promise(resolve => setTimeout(resolve, 2400));
  assert.equal(app.panels[0].htmlWrites.length, writes, "unchanged outputs must not restart playback");
  app.settings.autoOpen = false;
  await writeFile(app.index, (await readFile(app.index, "utf8")) + "\n<!-- auto-open disabled -->");
  await new Promise(resolve => setTimeout(resolve, 2700));
  assert.equal(app.panels[0].htmlWrites.length, writes);
});
