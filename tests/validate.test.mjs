import test from "node:test";
import assert from "node:assert/strict";
import {parseKymo} from "../skills/motion-explainer/scripts/kymo-parse.mjs";
import {validateSpec} from "../skills/motion-explainer/scripts/validate.mjs";

const model = parseKymo(`a box/gear/blue "A" ""\nb box/key/blue "B" ""\na --> b\n`);
const spec = (compare) => ({
  title: "t",
  compare,
  flows: [{id: "f", label: "f", steps: [{edge: "a->b", say: "x"}]}],
  next: ["n"],
});

test("a well-formed compare table passes", () => {
  const {errors} = validateSpec(spec({columns: ["Before", "After"], rows: [["Signs in as", "their app", "our app"]]}), model, "/");
  assert.deepEqual(errors, []);
});

test("a compare row with the wrong number of cells is an error", () => {
  const {errors} = validateSpec(spec({columns: ["Before", "After"], rows: [["Signs in as", "their app"]]}), model, "/");
  assert.match(errors.join("\n"), /compare\.rows\[0\]: must be 3 strings/);
});

test("abbreviations in a compare table need a glossary entry", () => {
  const {warnings} = validateSpec(spec({columns: ["Before", "After"], rows: [["Proof", "a secret", "an STS token"]]}), model, "/");
  assert.match(warnings.join("\n"), /not explained in `glossary`: STS/);
});
