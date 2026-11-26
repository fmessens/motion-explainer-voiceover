# Writing an explainer people can follow

The reader is a developer who learns by **watching**. They need to come away with two things: a mental model ("what talks to what, and why"), and a starting point for their change ("which file do I open").

## Pick the cast (diagram.kymo)

- Aim for 5–9 nodes, never more than 12. One node is one thing with a name in the codebase: a service, a module, a queue, a table, a third party. Group helpers ("utils", "types") into the node that uses them, or leave them out.
- Name nodes the way the code does (`OrderService`, not "Business logic layer"). Put the tech in the subtitle (`"Go · chi"`).
- Lay the diagram out in reading order: initiator on the left, storage and third parties on the right or bottom. The `layout { a | b | { c , d } }` line should read like the story.
- Draw every edge a flow will use, in both directions where there's a response.

## Establish importance before motion

A reader can't tell from a diagram which boxes matter. Before any packet moves, say so:

- Give **every** node an `importance` (`changed`, `core`, `supporting`, `context`) and a one-line `role` that says why it matters in this story. The overview lists them grouped, most important first.
- List **all** the services on the path, including the plumbing (identity, secrets, load balancers, jobs). A reader who doesn't see where credentials come from can't follow the story. Use `supporting` or `context` to keep them in their place instead of leaving them out.
- When explaining a change (a merge request, a migration), make the first flow a short **"The parts"** tour of `focus` steps: what changes, then the core, then the supporting parts.

## State the rules, not just the path

An animation shows one path; real systems branch. Put the branching in `rules`:

- Top-level `rules` for the whole system: `IF <condition> AND/OR <condition> THEN <what is used> ELSE <the alternative>`. Use the real setting names (`opa.federated = true`) and the real numbers (60 s, 5 min, 21 s).
- Step `rules` for the condition that applies at that hop ("IF cached THEN this step is skipped").
- Cover the failure rule too (what happens when any dependency is down).

## Explain every abbreviation, in footnotes

The reader may be new to the domain or the team. Every abbreviation (STS, KMS, OPA, JWKS, team-internal ones too) goes in `glossary` with its expansion **and what it is here**. Keep `say` readable: never expand inline. Never invent your own abbreviation for a name (write "Governance Control Plane", not "GCP"). The build warns about any abbreviation without a glossary entry.

## Explaining a change: end with before and after

When the explainer is about a change (a merge request, a migration, a decision between options), the reader's last question is "so what is different?". Answer it with `compare` instead of leaving them to rebuild it:

- Columns are the states: `Before`, `After this change`, and a column for each later step that someone else still has to take (another team's change, a rotation). A change rarely lands in one step, and the table should show that.
- Rows are the questions a reader asks: who signs in as what, what proves it, what is stored, who checks it, what fails if it breaks.
- Label the steps that show the old and the new path with `BEFORE:` and `AFTER:` in their `title`, so the two paths are easy to tell apart.

## Pick the flows

- A flow is one scenario from trigger to visible outcome: "Log in", "Checkout", "Webhook arrives", "Cache miss".
- 1–4 flows per explainer. A good second flow is the **failure path** (retry, timeout, invalid input), because that's where bugs live.
- Order flows from most common to least common.

## Write the steps

- One step is one hop, or one decision inside a node. If a sentence needs "and then", it's two steps.
- `say` covers what happens **and why it's designed that way**: "…keyed by `order_id` so events for one order stay in order." Skip anything the animation already shows ("the request goes from A to B").
- Use `packet.label` for the thing in motion (`POST /orders`, `OrderCreated`, `200 OK`). Use `payload` for a trimmed, realistic example of 3–6 fields. Never put real secrets in it; write `"••••"`.
- Use a `focus`-only step (no edge) for work inside one component, such as a DB transaction, validation or a cache check.
- Attach `code` refs from the code you actually read, with the line of the function or handler. A wrong line number is worse than none.

## Finish with `next`

2–4 concrete actions tied to the question the user asked:
- "To add a field to the order, change `orders` in `db/schema.sql`, then `OrderCreated` in `events/order.py`."
- "If you're debugging X, look at Y first."

Avoid generic advice ("write tests", "follow best practices").

## Self-check before building

- Can someone who has never seen the repo explain the main flow after one playthrough?
- Does every node appear in at least one step? If not, remove it.
- Does every step's narration fit in about 8 seconds of reading?
- Does every node have an `importance` and a `role`, and are all the services on the path present?
- Can a reader answer "when is X used instead of Y?" from `rules` alone?
- For a change: does `compare` answer "what is different, and what is still to come?"

- Did the build report no unexplained abbreviations?
