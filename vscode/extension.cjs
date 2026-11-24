const vscode = require("vscode");
const path = require("node:path");
const {readFile, stat, cp, mkdir} = require("node:fs/promises");
const {pathToFileURL} = require("node:url");

function activate(context) {
  const output = vscode.window.createOutputChannel("Motion Explainer");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.name = "Motion Explainer"; status.command = "motionExplainer.menu"; status.show();
  const config = () => vscode.workspace.getConfiguration("motionExplainer");
  const skill = path.join(context.extensionPath, "skill");
  const runtime = import(pathToFileURL(path.join(context.extensionPath, "runtime.mjs")).href);
  const builder = import(pathToFileURL(path.join(skill, "scripts/build.mjs")).href);
  const history = import(pathToFileURL(path.join(skill, "scripts/history.mjs")).href);
  const archived = file => file.split(path.sep).includes(".history");
  const roots = () => (vscode.workspace.workspaceFolders || []).filter(folder => ["file", "vscode-remote"].includes(folder.uri.scheme)).map(folder => folder.uri.fsPath);
  const allowedRoots = () => [...roots(), skill];
  const enabled = () => vscode.workspace.isTrusted && config().get("enabled", true);
  const setStatus = (state, detail = "") => {status.text = `${state === "Building" ? "$(sync~spin)" : state === "Error" ? "$(warning)" : "$(play-circle)"} Motion: ${state}`; status.tooltip = detail || "Open walkthroughs, build, or view diagnostics.";};
  const events = new vscode.EventEmitter();
  const tree = {onDidChangeTreeData: events.event, getTreeItem: item => item, async getChildren() {
    if (!enabled()) return [];
    const files = await vscode.workspace.findFiles("**/explainers/**/explainer.json", "**/{node_modules,.git,.venv,.history}/**");
    return files.filter(file => !archived(file.fsPath)).map(file => ({label: path.basename(path.dirname(file.fsPath)), description: vscode.workspace.asRelativePath(path.dirname(file.fsPath)), tooltip: file.fsPath, command: {command: "motionExplainer.open", title: "Open", arguments: [vscode.Uri.file(path.join(path.dirname(file.fsPath), "index.html"))]}}));
  }};
  const historyPanels = new Map();
  const historyTree = {onDidChangeTreeData: events.event, getTreeItem: item => item, async getChildren(item) {
    if (!enabled()) return [];
    if (item) return item.versions.map(version => ({label: new Date(version.createdAt).toLocaleString(), description: version.summary,
      tooltip: `${version.title}\n${version.createdAt}\n${version.summary}`, contextValue: "motionHistoryVersion", directory: item.directory, id: version.id,
      command: {command: "motionExplainer.historyOpen", title: "Replay version", arguments: [{directory: item.directory, id: version.id}]}}));
    const walkthroughs = await tree.getChildren(), groups = [];
    for (const walkthrough of walkthroughs) {
      const directory = path.dirname(walkthrough.command.arguments[0].fsPath);
      try {
        const versions = await (await history).listHistory(directory);
        if (versions.length) groups.push({id: directory, label: versions[0].title, description: vscode.workspace.asRelativePath(directory), directory, versions, collapsibleState: 1});
      } catch (error) {output.appendLine(`History: ${error.message}`);}
    }
    return groups;
  }};
  let panel, current, opening, readyTimer, timer, disposed = false;
  const pending = new Map(), building = new Map();
  const command = (id, action) => context.subscriptions.push(vscode.commands.registerCommand(id, async (...args) => {
    try {if (!enabled()) throw new Error("Enable Motion Explainer in a trusted workspace first."); return await action(...args);}
    catch (error) {setStatus("Error", error.message); output.appendLine(error.stack || error.message); await vscode.window.showErrorMessage(`Motion Explainer: ${error.message}`);}
  }));
  async function select(uri) {
    const active = uri || vscode.window.activeTextEditor?.document.uri;
    if (active && ["file", "vscode-remote"].includes(active.scheme)) {
      const directory = path.extname(active.fsPath) ? path.dirname(active.fsPath) : active.fsPath;
      try {await stat(path.join(directory, "explainer.json")); return directory;} catch {}
    }
    const items = await tree.getChildren();
    if (!items.length) throw new Error("No walkthroughs yet. Use Open Sample, or ask your agent to build explainers/<name>/.");
    const chosen = await vscode.window.showQuickPick(items, {placeHolder: "Choose a walkthrough"});
    return chosen ? path.dirname(chosen.command.arguments[0].fsPath) : null;
  }
  async function render(file, {autoplay = false, restore, restoredPanel} = {}) {
    const loaded = await (await runtime).playerHtml(file, allowedRoots());
    if (disposed || !enabled()) return;
    if (!panel) {
      panel = restoredPanel || vscode.window.createWebviewPanel("motionExplainer.player", "Motion Explainer", {viewColumn: vscode.ViewColumn.Beside, preserveFocus: true}, {enableScripts: true, retainContextWhenHidden: true, localResourceRoots: []});
      const target = panel;
      target.onDidDispose(() => {if (panel === target) {panel = null; current = null; clearTimeout(readyTimer);}});
      target.webview.onDidReceiveMessage(async message => {
        if (!current || panel !== target) return;
        if (message?.type === "motion:ready") {
          clearTimeout(readyTimer);
          await target.webview.postMessage({type: "motion:configure", file: current.file, autoplay: current.autoplay, ...current.restore});
          setStatus("Ready", current.file);
        } else if (message?.type === "motion:error" && typeof message.message === "string") {
          clearTimeout(readyTimer); setStatus("Error", message.message); output.appendLine(message.message);
        } else if (message?.type === "motion:open-source") {
          try {
            const location = await (await runtime).sourceLocation(path.dirname(current.file), message, allowedRoots());
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.file));
            const line = Math.min(location.line - 1, Math.max(0, document.lineCount - 1));
            await vscode.window.showTextDocument(document, {viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(line, 0, line, 0), preserveFocus: false});
          } catch (error) {await vscode.window.showErrorMessage(`Motion Explainer: ${error.message}`);}
        }
      });
    } else if (restoredPanel && restoredPanel !== panel) restoredPanel.dispose();
    panel.webview.options = {enableScripts: true, localResourceRoots: []};
    current = {...loaded, autoplay, restore};
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {setStatus("Error", "The player did not initialize. Use Motion Explainer: Refresh Player."); output.appendLine("Player did not send its ready acknowledgement.");}, 15000);
    panel.webview.html = loaded.html;
    panel.reveal(vscode.ViewColumn.Beside, true);
    events.fire();
  }
  async function show(file, options) {
    // Serialize reloads so an older read cannot overwrite a newer follow-up.
    const previous = opening;
    const operation = (async () => {if (previous) await previous.catch(() => {}); await render(file, options);})();
    opening = operation;
    try {await operation;} finally {if (opening === operation) opening = null;}
  }
  async function build(directory, open = true) {
    if (archived(directory)) throw new Error("Saved history is read-only. Build the current walkthrough instead.");
    await (await runtime).requireAllowed(path.join(directory, "explainer.json"), roots());
    const spec = JSON.parse(await readFile(path.join(directory, "explainer.json"), "utf8"));
    if (spec.diagram !== undefined && typeof spec.diagram !== "string") throw new Error("The diagram must name a .kymo file.");
    const diagram = path.resolve(directory, spec.diagram || "diagram.kymo");
    if (path.extname(diagram) !== ".kymo") throw new Error("The diagram must name a .kymo file.");
    await (await runtime).requireAllowed(diagram, roots());
    if (building.has(directory)) {building.get(directory).again = true; return building.get(directory).promise;}
    const state = {again: false, promise: null};
    state.promise = (async () => {
      let result;
      do {
        state.again = false; setStatus("Building", directory);
        result = await (await builder).build(directory, {offline: config().get("offline", true)});
        for (const warning of result.warnings) output.appendLine(`warn: ${warning}`);
        if (!result.ok) throw new Error(result.errors.join("\n"));
      } while (state.again && !disposed);
      setStatus(result.warnings.length ? "Warnings" : "Ready", result.outPath);
      if (open && !disposed) await show(result.outPath, {autoplay: config().get("autoPlay", true)});
      events.fire(); return result;
    })();
    building.set(directory, state);
    try {return await state.promise;} finally {building.delete(directory);}
  }
  function schedule(file, source) {
    if (!enabled() || disposed || archived(file.fsPath)) return;
    const directory = path.dirname(file.fsPath);
    const previous = pending.get(directory);
    pending.set(directory, {file, source: source || previous?.source}); clearTimeout(timer);
    timer = setTimeout(async () => {
      const updates = [...pending.values()]; pending.clear();
      for (const update of updates) {
        try {
          const directory = path.dirname(update.file.fsPath);
          if (update.source && config().get("autoRebuild", true)) await build(directory, config().get("autoOpen", true));
          else if (!update.source && !building.has(directory)) {
            const file = path.join(directory, "index.html");
            const loaded = await (await runtime).playerHtml(file, allowedRoots());
            await (await history).captureHistory(directory, loaded.html);
            if (config().get("autoOpen", true) && (current?.file !== loaded.file || current.stamp !== loaded.stamp)) await show(file, {autoplay: config().get("autoPlay", true)});
          }
        } catch (error) {setStatus("Error", error.message); output.appendLine(error.message);}
      }
      events.fire();
    }, 450);
  }
  // Remote and excluded folders can miss workspace watcher events. Check output
  // metadata as well, without reopening unchanged walkthroughs at startup.
  const observed = new Map();
  let scanning = false, initialized = false;
  async function scanOutputs() {
    if (scanning || disposed || !enabled()) return;
    scanning = true;
    const initial = !initialized;
    try {
      const files = await vscode.workspace.findFiles("**/explainers/**/index.html", "**/{node_modules,.git,.venv,.history}/**");
      const present = new Set();
      for (const file of files) {
        if (archived(file.fsPath)) continue;
        try {
          const info = await stat(file.fsPath), stamp = `${info.mtimeMs}:${info.size}`;
          present.add(file.fsPath);
          if (!initialized) {
            const loaded = await (await runtime).playerHtml(file.fsPath, roots());
            await (await history).captureHistory(path.dirname(file.fsPath), loaded.html);
          }
          if (initialized && observed.get(file.fsPath) !== stamp) {
            output.appendLine(`Detected walkthrough update: ${file.fsPath}`);
            schedule(file, false);
          }
          observed.set(file.fsPath, stamp);
        } catch (error) {if (error.code !== "ENOENT") output.appendLine(error.message);}
      }
      for (const file of observed.keys()) if (!present.has(file)) observed.delete(file);
      if (!initialized) output.appendLine(`Monitoring ${observed.size} existing walkthrough(s); auto-open: ${config().get("autoOpen", true)}.`);
      initialized = true;
      if (initial) events.fire();
    } catch (error) {output.appendLine(`Walkthrough discovery failed: ${error.message}`);}
    finally {scanning = false;}
  }
  command("motionExplainer.open", async uri => {
    const directory = await select(uri); if (!directory) return;
    try {await stat(path.join(directory, "index.html")); await show(path.join(directory, "index.html"));}
    catch (error) {if (error.code === "ENOENT") await build(directory); else throw error;}
  });
  command("motionExplainer.build", async uri => {const directory = await select(uri); if (directory) await build(directory);});
  command("motionExplainer.sample", async () => {
    const directory = path.join(skill, "examples/order-queue");
    await show(path.join(directory, "index.html"));
  });
  command("motionExplainer.refresh", async () => {if (current) await show(current.file); else await vscode.commands.executeCommand("motionExplainer.open");});
  command("motionExplainer.output", () => output.show(true));
  async function chooseVersion(item) {
    if (item?.directory && item?.id) return item;
    const choices = [];
    for (const group of await historyTree.getChildren()) for (const version of group.versions) choices.push({
      label: group.label, description: new Date(version.createdAt).toLocaleString(), detail: `${group.description} · ${version.summary}`, directory: group.directory, id: version.id,
    });
    return vscode.window.showQuickPick(choices, {placeHolder: "Choose a saved walkthrough version"});
  }
  async function versionFiles(item) {
    await (await runtime).requireAllowed(path.join(item.directory, "explainer.json"), roots());
    const files = await (await history).snapshotFiles(item.directory, item.id);
    await (await runtime).requireAllowed(files.html, roots());
    return files;
  }
  command("motionExplainer.historyOpen", async item => {
    item = await chooseVersion(item); if (!item) return;
    const files = await versionFiles(item), loaded = await (await runtime).playerHtml(files.html, roots());
    if (historyPanels.has(loaded.file)) {historyPanels.get(loaded.file).reveal(vscode.ViewColumn.Beside, true); return;}
    const target = vscode.window.createWebviewPanel("motionExplainer.historyPlayer", `${files.metadata.title} · saved version`, {viewColumn: vscode.ViewColumn.Beside, preserveFocus: true}, {enableScripts: true, retainContextWhenHidden: true, localResourceRoots: []});
    historyPanels.set(loaded.file, target);
    target.onDidDispose(() => historyPanels.delete(loaded.file));
    target.webview.onDidReceiveMessage(async message => {
      if (message?.type === "motion:ready") await target.webview.postMessage({type: "motion:configure", file: loaded.file, autoplay: false});
      else if (message?.type === "motion:open-source") {
        try {
          const location = await (await runtime).sourceLocation(path.dirname(loaded.file), message, roots());
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.file));
          const line = Math.min(location.line - 1, Math.max(0, document.lineCount - 1));
          await vscode.window.showTextDocument(document, {viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(line, 0, line, 0)});
        } catch (error) {await vscode.window.showErrorMessage(`Motion Explainer: ${error.message}`);}
      }
    });
    target.webview.html = loaded.html;
  });
  command("motionExplainer.historySources", async item => {
    item = await chooseVersion(item); if (!item) return;
    const files = await versionFiles(item);
    const choices = [{label: "Narration and flows (explainer.json)", file: files.spec, language: "json"}];
    if (files.diagram) choices.push({label: "Diagram source (diagram.kymo)", file: files.diagram, language: "plaintext"});
    const chosen = await vscode.window.showQuickPick(choices, {placeHolder: "View a copy of the saved source"});
    if (!chosen) return;
    await (await runtime).requireAllowed(chosen.file, roots());
    const document = await vscode.workspace.openTextDocument({content: await readFile(chosen.file, "utf8"), language: chosen.language});
    await vscode.window.showTextDocument(document, {viewColumn: vscode.ViewColumn.One});
  });
  command("motionExplainer.historyDelete", async item => {
    item = await chooseVersion(item); if (!item) return;
    const files = await versionFiles(item);
    const confirmation = await vscode.window.showWarningMessage(`Delete the saved version of “${files.metadata.title}” from ${new Date(files.metadata.createdAt).toLocaleString()}? The current walkthrough stays intact.`, {modal: true}, "Delete version");
    if (confirmation !== "Delete version") return;
    await (await history).deleteSnapshot(item.directory, item.id);
    historyPanels.get(files.html)?.dispose(); events.fire();
  });
  command("motionExplainer.installSkills", async () => {
    const root = roots()[0]; if (!root) throw new Error("Open a workspace folder first.");
    for (const parent of [".agents/skills", ".claude/skills"]) {
      const destination = path.join(root, parent, "motion-explainer");
      try {await stat(destination); throw new Error(`A skill already exists at ${destination}; update it explicitly rather than overwriting local edits.`);} catch (error) {if (error.code !== "ENOENT") throw error;}
    }
    for (const parent of [".agents/skills", ".claude/skills"]) {
      const destination = path.join(root, parent, "motion-explainer"); await mkdir(path.dirname(destination), {recursive: true});
      await cp(skill, destination, {recursive: true, filter: file => !(path.basename(file) === "index.html" && file.includes(path.sep + "examples" + path.sep))});
    }
    await vscode.window.showInformationMessage("Motion Explainer skills installed for Claude Code and Codex. Restart existing agent sessions to discover them.");
  });
  command("motionExplainer.menu", async () => {
    const items = [{label: "Open Walkthrough", id: "open"}, {label: "Replay History", id: "historyOpen"}, {label: "Open Sample", id: "sample"}, {label: "Build and Open", id: "build"}, {label: "Refresh Player", id: "refresh"}, {label: "Install Workspace Skills", id: "installSkills"}, {label: "Show Output", id: "output"}];
    const selected = await vscode.window.showQuickPick(items, {placeHolder: "Motion Explainer"}); if (selected) await vscode.commands.executeCommand("motionExplainer." + selected.id);
  });
  const generated = vscode.workspace.createFileSystemWatcher("**/explainers/**/index.html");
  const sources = vscode.workspace.createFileSystemWatcher("**/explainers/**/{explainer.json,*.kymo}");
  const scanTimer = setInterval(() => void scanOutputs(), 2000);
  void scanOutputs();
  context.subscriptions.push(output, status, events, vscode.window.registerTreeDataProvider("motionExplainer.walkthroughs", tree), vscode.window.registerTreeDataProvider("motionExplainer.history", historyTree), generated, sources,
    generated.onDidCreate(file => schedule(file, false)), generated.onDidChange(file => schedule(file, false)), generated.onDidDelete(() => events.fire()),
    sources.onDidCreate(file => schedule(file, true)), sources.onDidChange(file => schedule(file, true)), sources.onDidDelete(() => events.fire()),
    vscode.window.registerWebviewPanelSerializer("motionExplainer.player", {async deserializeWebviewPanel(target, state) {
      try {if (typeof state?.file !== "string") throw new Error("Open a walkthrough to restore this player."); await show(state.file, {restoredPanel: target, restore: {flow: state.flow, step: state.step}});}
      catch (error) {target.dispose(); setStatus("Error", error.message);}
    }}),
    vscode.workspace.onDidChangeConfiguration(event => {if (event.affectsConfiguration("motionExplainer")) {if (!enabled()) {panel?.dispose(); for (const target of historyPanels.values()) target.dispose();} setStatus(enabled() ? "Ready" : "Disabled"); events.fire();}}),
    {dispose() {disposed = true; clearInterval(scanTimer); clearTimeout(timer); clearTimeout(readyTimer); panel?.dispose(); for (const target of historyPanels.values()) target.dispose();}},
  );
  setStatus(enabled() ? "Ready" : "Disabled");
}
module.exports = {activate};
