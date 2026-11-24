// Local immutable snapshots shared by the CLI builder and VS Code companion.
import {createHash, randomUUID} from "node:crypto";
import {readFile, writeFile, mkdir, readdir, rename, rm, lstat} from "node:fs/promises";
import {join, resolve, sep} from "node:path";

const validId = id => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);
export const isHistoryPath = file => resolve(file).split(sep).includes(".history");
function dataFrom(html) {
  const match = /^const DATA = (.+);$/m.exec(html);
  if (!match || !html.includes("motion-explainer player.")) throw Object.assign(new Error("Not a built Motion Explainer player."), {code: "INVALID_PLAYER"});
  const data = JSON.parse(match[1]);
  if (!data.spec?.title || !Array.isArray(data.spec.flows)) throw Object.assign(new Error("Invalid walkthrough data."), {code: "INVALID_PLAYER"});
  return {data, match};
}
async function historyRoot(directory, create = false) {
  if (isHistoryPath(directory)) throw new Error("History snapshots cannot contain another history.");
  const root = join(resolve(directory), ".history");
  if (create) await mkdir(root, {recursive: true});
  const info = await lstat(root);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("History must be a real directory, not a symlink.");
  if (create) await writeFile(join(root, ".gitignore"), "*\n");
  return root;
}
export async function listHistory(directory) {
  let root;
  try {root = await historyRoot(directory);} catch (error) {if (error.code === "ENOENT") return []; throw error;}
  const entries = [];
  for (const item of await readdir(root, {withFileTypes: true})) {
    if (!item.isDirectory() || !validId(item.name)) continue;
    try {
      const metadata = JSON.parse(await readFile(join(root, item.name, "metadata.json"), "utf8"));
      if (metadata.version !== 1 || metadata.id !== item.name || !Number.isFinite(Date.parse(metadata.createdAt))) continue;
      entries.push(metadata);
    } catch (error) {if (!(error instanceof SyntaxError) && error.code !== "ENOENT") throw error;}
  }
  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
export async function snapshotFiles(directory, id) {
  if (!validId(id)) throw new Error("Invalid history version.");
  const root = await historyRoot(directory), folder = join(root, id);
  const info = await lstat(folder);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Invalid history directory.");
  const metadata = JSON.parse(await readFile(join(folder, "metadata.json"), "utf8"));
  if (metadata.version !== 1 || metadata.id !== id) throw new Error("Invalid history metadata.");
  return {folder, metadata, html: join(folder, "index.html"), spec: join(folder, "explainer.json"), diagram: metadata.hasDiagram ? join(folder, "diagram.kymo") : null};
}
export async function deleteSnapshot(directory, id) {
  const {folder} = await snapshotFiles(directory, id);
  const root = await historyRoot(directory), deleted = await deletedVersions(root);
  const temporary = join(root, `.deleted-${randomUUID()}`);
  await writeFile(temporary, JSON.stringify([...new Set([...deleted, id])]) + "\n");
  await rename(temporary, join(root, ".deleted.json"));
  await rm(folder, {recursive: true});
}
async function deletedVersions(root) {
  try {
    const ids = JSON.parse(await readFile(join(root, ".deleted.json"), "utf8"));
    if (!Array.isArray(ids) || !ids.every(validId)) throw new Error("Invalid deleted-history index.");
    return ids;
  } catch (error) {if (error.code === "ENOENT") return []; throw error;}
}
export async function captureHistory(directory, html) {
  if (isHistoryPath(directory)) return null;
  directory = resolve(directory);
  if (html === undefined) {
    try {html = await readFile(join(directory, "index.html"), "utf8");}
    catch (error) {if (error.code === "ENOENT") return null; throw error;}
  }
  const {data, match} = dataFrom(html);
  const normalized = {...data}; delete normalized.builtAt;
  const stable = html.slice(0, match.index) + JSON.stringify(normalized) + html.slice(match.index + match[0].length);
  const id = createHash("sha256").update(stable).digest("hex").slice(0, 32);
  const root = await historyRoot(directory, true);
  if ((await deletedVersions(root)).includes(id)) return null;
  try {return (await snapshotFiles(directory, id)).metadata;} catch (error) {if (error.code !== "ENOENT") throw error;}
  const entries = await listHistory(directory), previous = entries[0];
  let summary = "First saved version";
  if (previous) {
    const old = JSON.parse(await readFile(join(root, previous.id, "explainer.json"), "utf8"));
    const nextSpec = {...data.spec}; delete nextSpec.root; delete old.root;
    const changes = [];
    if (JSON.stringify(old) !== JSON.stringify(nextSpec)) changes.push("Explanation updated");
    if (typeof data.diagramSource === "string") {
      const oldDiagram = previous.hasDiagram ? await readFile(join(root, previous.id, "diagram.kymo"), "utf8") : null;
      if (oldDiagram !== data.diagramSource) changes.push("Diagram updated");
    }
    summary = changes.join(" · ") || "Player updated";
  }
  const createdAt = new Date(Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString();
  const metadata = {version: 1, id, title: data.spec.title, createdAt, summary, hasDiagram: typeof data.diagramSource === "string"};
  const spec = {...data.spec, root: data.root || resolve(directory, data.spec.root || ".")};
  const temporary = join(root, `.pending-${randomUUID()}`);
  await mkdir(temporary);
  try {
    await writeFile(join(temporary, "index.html"), html);
    await writeFile(join(temporary, "explainer.json"), JSON.stringify(spec, null, 2) + "\n");
    if (metadata.hasDiagram) await writeFile(join(temporary, "diagram.kymo"), data.diagramSource);
    const stage = /<section[^>]+id="stage"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
    const svg = stage && /<svg[\s\S]*?<\/svg>/.exec(stage)?.[0];
    if (svg) await writeFile(join(temporary, "diagram.svg"), svg);
    await writeFile(join(temporary, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
    try {await rename(temporary, join(root, id));}
    catch (error) {if (!["EEXIST", "ENOTEMPTY"].includes(error.code)) throw error;}
  } finally {await rm(temporary, {recursive: true, force: true});}
  return (await snapshotFiles(directory, id)).metadata;
}
