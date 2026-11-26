import test from "node:test";
import assert from "node:assert/strict";
import {parseKymo} from "../skills/motion-explainer/scripts/kymo-parse.mjs";
import {tagSvg} from "../skills/motion-explainer/scripts/tag-svg.mjs";

// Geometry from a real local kymostudio render of `layout { d | { a , b , c } }` with d --> b and b --> c:
// the b --> c path starts below B's label, 73 px from B's centre but 71 px from C's.
const kymo = `title: "q"
a box/gear/blue "A" ""
b box/key/blue "B" ""
c box/zap/blue "C" ""
d box/cloud/blue "D" ""
layout { d | { a , b , c } }
d --> b
b --> c
`;
const node = (x, y, label) =>
  `<g transform="translate(${x},${y})" filter="url(#soft)"><rect x="-35" y="-35" width="70" height="70"/></g>` +
  `<text class="label" x="${x}" y="${y + 55}">${label}</text>`;
const svg = `<svg><g class="edges">` +
  `<path d="M259,216 C308,216 308,216 357,216" marker-end="url(#a)"/>` +
  `<path d="M392,289 C392,329 392,285 392,325" marker-end="url(#a)"/>` +
  `</g><g class="nodes">` +
  node(392, 64, "A") + node(392, 216, "B") + node(392, 360, "C") + node(224, 216, "D") +
  `</g></svg>`;

test("an edge between closely stacked nodes is matched to its declared edge", () => {
  const tagged = tagSvg(svg, parseKymo(kymo));
  assert.deepEqual(tagged.edges.map((e) => e.key).sort(), ["b->c", "d->b"]);
  assert.deepEqual(tagged.warnings, []);
});

test("a path near no declared edge is still reported", () => {
  const stray = svg.replace("</g><g class=\"nodes\">", `<path d="M900,900 C950,950 950,950 1000,1000"/></g><g class="nodes">`);
  const tagged = tagSvg(stray, parseKymo(kymo));
  assert.equal(tagged.edges.length, 2);
  assert.match(tagged.warnings.join("\n"), /edge path #3 .* has no matching edge/);
});
