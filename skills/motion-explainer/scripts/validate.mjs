// explainer.json checks. Errors block the build; warnings are printed and also
// shown in the player's lint banner so a sloppy explainer is visibly sloppy.

import { existsSync } from "node:fs";
import { join } from "node:path";

const PLACEHOLDER_RE = /\b(TODO|TBD|FIXME|lorem ipsum)\b|<(your|insert|describe|add|some)\b[^>]*>|\.\.\.$/i;
const MAX_NODES = 14;
const MAX_STEPS = 12;
const IMPORTANCE = ["changed", "core", "supporting", "context"];
// Upper-case words that are not abbreviations a reader needs expanded, or the rule operators.
const COMMON_ABBR = new Set(["IF", "THEN", "ELSE", "AND", "OR", "NOT", "UNLESS", "OK", "ID", "URL", "API", "HTTP", "HTTPS", "JSON", "POST", "GET", "PUT", "DELETE", "PATCH", "UI", "CLI", "AFTER", "BEFORE", "NOTE", "WHEN", "WHY", "WHAT", "NEW",
  "HTML", "CSS", "SQL", "SELECT", "INSERT", "UPDATE", "SET", "DEL"]);  // commands and everyday web terms
// Longer upper-case words are emphasis (BLOCKING), not abbreviations; the regex stops at 6 characters.

/**
 * @param {object} spec    parsed explainer.json
 * @param {ReturnType<import('./kymo-parse.mjs').parseKymo>} model
 * @param {string} root    project root that `code[].file` paths are relative to
 */
export function validateSpec(spec, model, root) {
  const errors = [];
  const warnings = [];
  const nodeIds = new Set(model.nodes.map((n) => n.id));
  const edgeKeys = new Set(model.edges.map((e) => `${e.src}->${e.dst}`));
  const placeholder = (where, text) => {
    if (typeof text === "string" && PLACEHOLDER_RE.test(text)) warnings.push(`${where}: looks like a placeholder: "${text}"`);
  };

  if (!spec.title) errors.push("missing `title`");
  placeholder("title", spec.title);
  placeholder("summary", spec.summary);
  if (model.nodes.length > MAX_NODES) {
    warnings.push(`${model.nodes.length} nodes — more than ${MAX_NODES} gets hard to follow; split into two explainers or group with regions`);
  }
  if (!Array.isArray(spec.flows) || spec.flows.length === 0) errors.push("`flows` must be a non-empty array");

  const flowIds = new Set();
  (spec.flows || []).forEach((flow, fi) => {
    const fw = `flows[${fi}]${flow.id ? ` (${flow.id})` : ""}`;
    if (!flow.id || !/^[a-z0-9-]+$/.test(flow.id)) errors.push(`${fw}: \`id\` must be kebab-case`);
    if (flowIds.has(flow.id)) errors.push(`${fw}: duplicate flow id`);
    flowIds.add(flow.id);
    if (!flow.label) errors.push(`${fw}: missing \`label\``);
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) return errors.push(`${fw}: \`steps\` must be a non-empty array`);
    if (flow.steps.length > MAX_STEPS) warnings.push(`${fw}: ${flow.steps.length} steps — consider splitting into two flows`);

    flow.steps.forEach((step, si) => {
      const sw = `${fw}.steps[${si}]`;
      if (!step.say) errors.push(`${sw}: missing \`say\` (the narration)`);
      placeholder(`${sw}.say`, step.say);
      if (!step.edge && !step.focus?.length) errors.push(`${sw}: needs an \`edge\` ("a->b") or a \`focus\` list`);

      if (step.edge) {
        const m = /^([A-Za-z_][\w-]*)->([A-Za-z_][\w-]*)$/.exec(step.edge);
        if (!m) errors.push(`${sw}: edge "${step.edge}" must look like "src->dst"`);
        else {
          for (const id of [m[1], m[2]]) if (!nodeIds.has(id)) errors.push(`${sw}: edge "${step.edge}" — unknown node "${id}"`);
          const reverse = `${m[2]}->${m[1]}`;
          if (!edgeKeys.has(step.edge) && !edgeKeys.has(reverse)) {
            warnings.push(`${sw}: no "${m[1]} --> ${m[2]}" edge in the diagram — the packet will fly in a straight line; add the edge to diagram.kymo`);
          }
        }
      }
      for (const id of step.focus || []) if (!nodeIds.has(id)) errors.push(`${sw}: focus — unknown node "${id}"`);
      if (step.packet && typeof step.packet !== "object") errors.push(`${sw}: \`packet\` must be an object { label, payload? }`);

      for (const ref of step.code || []) {
        if (!ref.file) { errors.push(`${sw}: code ref needs \`file\``); continue; }
        if (!existsSync(join(root, ref.file))) warnings.push(`${sw}: code ref ${ref.file} not found under ${root}`);
        if (ref.line != null && !(Number.isInteger(ref.line) && ref.line > 0)) errors.push(`${sw}: code ref line must be a positive integer`);
      }
    });
  });

  for (const [id, info] of Object.entries(spec.nodes || {})) {
    if (!nodeIds.has(id)) errors.push(`nodes.${id}: not a node in diagram.kymo`);
    for (const ref of info.code || []) {
      if (ref.file && !existsSync(join(root, ref.file))) warnings.push(`nodes.${id}: code ref ${ref.file} not found under ${root}`);
    }
  }
  // Rules: plain strings, or { if, then, else? }, at the top level, per flow, per step or per node.
  const checkRules = (where, rules) => {
    if (rules == null) return;
    if (!Array.isArray(rules)) return errors.push(`${where}: \`rules\` must be an array`);
    rules.forEach((r, i) => {
      if (typeof r === "string") return;
      if (!r || typeof r.if !== "string" || typeof r.then !== "string") errors.push(`${where}.rules[${i}]: needs \`if\` and \`then\` strings (or be a plain string)`);
    });
  };
  checkRules("spec", spec.rules);
  // Compare: { title?, columns: [header…], rows: [[row name, cell per column]…] }, top level or per flow.
  const checkCompare = (where, c) => {
    if (c == null) return;
    const strings = (a) => Array.isArray(a) && a.length > 0 && a.every((s) => typeof s === "string");
    if (typeof c !== "object" || !strings(c.columns)) return errors.push(`${where}.compare: needs \`columns\`, a non-empty array of strings`);
    if (!Array.isArray(c.rows) || !c.rows.length) return errors.push(`${where}.compare: needs \`rows\`, a non-empty array`);
    c.rows.forEach((r, i) => {
      if (!strings(r) || r.length !== c.columns.length + 1) errors.push(`${where}.compare.rows[${i}]: must be ${c.columns.length + 1} strings, the row's name and one cell per column`);
    });
  };
  checkCompare("spec", spec.compare);
  (spec.flows || []).forEach((f, fi) => checkCompare(`flows[${fi}]`, f.compare));
  (spec.flows || []).forEach((f, fi) => { checkRules(`flows[${fi}]`, f.rules); (f.steps || []).forEach((s, si) => checkRules(`flows[${fi}].steps[${si}]`, s.rules)); });
  for (const [id, info] of Object.entries(spec.nodes || {})) {
    checkRules(`nodes.${id}`, info.rules);
    if (info.importance != null && !IMPORTANCE.includes(info.importance)) errors.push(`nodes.${id}.importance must be one of ${IMPORTANCE.join(", ")}`);
  }
  if (spec.glossary != null && (typeof spec.glossary !== "object" || Array.isArray(spec.glossary))) errors.push("`glossary` must be an object { ABBR: \"expansion and what it is here\" }");

  // Every abbreviation a reader sees should be expanded in `glossary` (shown as footnotes, not in the narration).
  const texts = [spec.title, spec.summary];
  (spec.flows || []).forEach((f) => { texts.push(f.label, f.description); (f.rules || []).forEach((r) => texts.push(JSON.stringify(r))); (f.steps || []).forEach((s) => texts.push(s.say, s.title, s.packet?.label, JSON.stringify(s.rules || []))); });
  for (const info of Object.values(spec.nodes || {})) texts.push(info.desc, info.role, info.subtitle, JSON.stringify(info.rules || []));
  (spec.rules || []).forEach((r) => texts.push(JSON.stringify(r)));
  for (const c of [spec.compare, ...(spec.flows || []).map((f) => f.compare)]) if (c) texts.push(JSON.stringify(c));
  for (const n of model.nodes) texts.push(n.label, n.subtitle);
  const defined = new Set(Object.keys(spec.glossary || {}));
  const missing = new Set();
  for (const t of texts) {
    if (typeof t !== "string") continue;
    const plain = t.replace(/`[^`]*`/g, " ");   // code spans are identifiers, not prose
    for (const m of plain.matchAll(/\b[A-Z][A-Z0-9]{1,5}s?\b/g)) {
      const w = m[0].replace(/s$/, "");
      if (!COMMON_ABBR.has(w) && !defined.has(w) && !/^\d/.test(w)) missing.add(w);
    }
  }
  if (missing.size) warnings.push(`abbreviations not explained in \`glossary\`: ${[...missing].sort().join(", ")}`);

  if (!Array.isArray(spec.next) || spec.next.length === 0) {
    warnings.push("no `next` actions — tell the reader what to change and where");
  } else spec.next.forEach((n, i) => placeholder(`next[${i}]`, typeof n === "string" ? n : n.text));

  return { errors, warnings };
}
