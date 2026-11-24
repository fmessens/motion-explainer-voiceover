# Install Motion Explainer in VS Code

Based on **[Bilal Tahseen's Motion Explainer](https://github.com/bilaltahseen/motion-explainer)**
and its upstream contributors' work. This fork adds VS Code integration,
voiceover and canvas navigation. See [credits](AUTHORS.md) and the original
[MIT license](LICENSE).

Motion Explainer contains both the animated player and voiceover. Install one
extension, then give your coding agent the bundled skill. No MCP server or
background web service is required.

## 1. Install the extension

Use VS Code 1.100 or newer and open a trusted workspace.

From this fork's GitHub **Releases**, download `motion-explainer.vsix`. In
VS Code, open **Extensions**, choose **… → Install from VSIX…**, and select
the download. Alternatively:

```bash
code --install-extension motion-explainer.vsix --force
```

Run **Developer: Reload Window** from the Command Palette after installing or
upgrading. Then run **Motion Explainer: Open Sample** and press **Play**.

For WSL, SSH or a dev container, install into the window where the project is
open. Run the CLI command in that window's integrated terminal; check that the
extension is enabled in the corresponding remote extension host.

If no release has been published yet, build from source below. A successful
GitHub **Actions → check** run also provides a `motion-explainer-vsix` artifact;
download and unzip it to get the VSIX.

## 2. Enable voiceover

Voiceover is on by default. In the player footer, leave **Voiceover** checked,
choose a narration voice, and press **Play**. The voice choice and on/off
preference are remembered. Pause stops both narration and animation.

This uses voices available through VS Code's browser/OS speech engine. It does
not require VS Code Speech, Codex Audio, an API key or a paid speech account.
Those extensions are separate products and do not supply voices to this player.
Voice availability depends on the desktop OS and VS Code renderer; voices marked
**online** may use the system speech provider's network service. Where speech
is unavailable, the player displays narration and advances at reading pace.

The narration stays visible as text in the explanation panel. While paused,
drag or scroll the diagram to pan, use **+ / −** to zoom, and **Fit** to reset.
With the canvas focused, arrow keys pan and **0** fits the whole diagram.

## 3. Connect your coding agent

Run **Motion Explainer: Install Workspace Skills**. This creates
`.claude/skills/motion-explainer/` and `.agents/skills/motion-explainer/` in the
workspace. It refuses to overwrite an existing skill; update an existing copy
explicitly from the checkout's installer if appropriate. Restart an existing
coding-agent session so it discovers the skill.

For automatic use, add this to the workspace's `AGENTS.md`, and to `CLAUDE.md`
when using Claude Code:

```text
Use the motion-explainer skill for substantive explanations of code and
technical flows. Read the actual source, write or update
explainers/<slug>/diagram.kymo and explainer.json, then run the skill's
scripts/build.mjs with --offline. Use built-in glyphs. Build without --open:
the VS Code extension opens the generated player. Rebuild for follow-up
questions so the visible explanation changes. Skip animations for brief facts
and routine edits. Keep source links grounded in files you actually read.
```

Try: **“Use motion-explainer to walk me through this project's request path.”**
The extension opens a new or changed walkthrough automatically. Editing the
JSON or diagram also rebuilds it. With terminal agents, keep the project open
in the same VS Code workspace so the extension can detect generated files.

Claude Code and Codex can use the installed skill. Other agents, including
Copilot, need to discover or explicitly read its `SKILL.md`; the extension
itself does not connect to a model or intercept agent replies.

## Build from source

Download or clone this fork and open its root directory. Requirements:
Node.js 18 or newer with npm, and Python 3. There are no project npm
dependencies to install. Build and install:

```bash
python3 scripts/package-vscode.py
code --install-extension vscode/output/motion-explainer.vsix --force
```

On Windows, use `py -3` instead of `python3` if that is your Python launcher.
Then reload the VS Code window and open the sample.

For a skill-only installation from the checkout:

```bash
node skills/motion-explainer/scripts/install.mjs --project /path/to/your/project
```

## Rendering and privacy

The extension and these instructions use local rendering. An uncached layout
may need npm to download Kymo initially; use its built-in glyphs. Cached
walkthroughs need no rendering service. The standalone build script otherwise
defaults to Kymo's public renderer, so keep `--offline` when building directly.
Disabling `motionExplainer.offline` explicitly allows diagram text to be sent
to that renderer. Your coding agent's model connection has its own data policy.

Packaged demos omit the build machine's absolute source path. The VS Code
player resolves their source references within the installed extension instead.

Generated walkthroughs can contain source excerpts, paths and architecture.
Review them before sharing. Local test screenshots in `trial-results/` and
build packages in `vscode/output/` are excluded from Git; publish only the
reviewed VSIX as the release asset.

## Troubleshooting

- **Commands missing:** reload the window, check the extension is enabled in the
  current local/remote host, and check workspace trust.
- **No automatic tab:** check `motionExplainer.enabled` and
  `motionExplainer.autoOpen`. Run **Motion Explainer: Show Output** for discovery
  messages. **Open Walkthrough** selects an already-built explanation.
- **No narration:** press Play, check Voiceover and the voice selector, then
  check the desktop audio output. If no voices are exposed by the renderer,
  try the standalone generated HTML in a desktop browser.
- **Unexpected playback:** updated builds may autoplay. Set
  `motionExplainer.autoPlay` to `false` to require Play. Restoring a saved tab
  does not start narration.
