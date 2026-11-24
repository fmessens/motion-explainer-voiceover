import {readFile, realpath, stat} from "node:fs/promises";
import {dirname, join, resolve, relative, isAbsolute, sep} from "node:path";

export function inside(file, root) {
  const path = relative(root, file);
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep));
}
export async function requireAllowed(file, roots) {
  const actual = await realpath(file);
  for (const root of roots) if (inside(actual, await realpath(root))) return actual;
  throw new Error("The walkthrough or source file must be inside this workspace.");
}
export async function playerHtml(file, roots) {
  const actual = await requireAllowed(file, roots);
  const html = await readFile(actual, "utf8");
  if (!html.includes("const DATA =") || !html.includes("data-node=") || !html.includes("motion-explainer player."))
    throw new Error("This file is not a built motion-explainer player. Build explainer.json first.");
  return {html, file: actual, stamp: `${(await stat(actual)).mtimeMs}:${html.length}`};
}
export async function sourceLocation(directory, reference, roots) {
  if (typeof reference.file !== "string" || !Number.isInteger(reference.line) || reference.line < 1 || reference.line > 10000000)
    throw new Error("Invalid source reference.");
  const spec = JSON.parse(await readFile(join(directory, "explainer.json"), "utf8"));
  let root;
  if (spec.root) root = resolve(directory, spec.root);
  else {
    for (let current = directory;; current = dirname(current)) {
      try {await stat(join(current, ".git")); root = current; break;} catch {}
      if (dirname(current) === current) break;
    }
    root ??= roots.find(path => inside(directory, path));
  }
  if (!root) throw new Error("Cannot locate the source project for this walkthrough.");
  return {file: await requireAllowed(resolve(root, reference.file), roots), line: reference.line};
}
