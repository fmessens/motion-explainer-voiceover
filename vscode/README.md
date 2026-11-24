# Motion Explainer for VS Code

A fork of [Motion Explainer](https://github.com/bilaltahseen/motion-explainer),
created by **Bilal Tahseen** and the upstream contributors. The original skill,
player, examples and documentation are their work. This fork adds VS Code
integration, voiceover and canvas navigation; the original MIT license and
copyright notice are preserved. Full credits are included in `AUTHORS.md` in
the source repository and installed extension package.

Install the VSIX, reload VS Code, and run **Motion Explainer: Open Sample**.
Voiceover is included; no separate voiceover extension is required. In a source
checkout, see [the installation guide](../INSTALL.md) for download, build and
WSL/SSH setup instructions.
The activity bar lists walkthroughs; the status bar provides Open, Build,
Refresh, and diagnostics. The player is a native webview, including its flow
tabs, moving packets, payloads, themes, keyboard controls, and node details.
No MCP server, localhost service, or iframe is needed.

File events open newly built walkthroughs automatically. A metadata check every
two seconds also detects updates when remote workspace watchers miss an event.
Existing files stay silent at startup. Output logs discovery and detected updates.

When playback is stopped or paused, drag or scroll the canvas to pan. Use the
zoom buttons or Ctrl+scroll to zoom, and Fit to reset. With the diagram focused,
arrow keys pan, +/− zoom and 0 fits. Playback resumes camera tracking; focused
nodes, their labels and the active edge are framed for the current canvas size.
On narrow screens the canvas stays visible while the explanation scrolls.
Restoring a saved tab does not start narration until Play.

For your code, install the bundled skill with **Install Workspace Skills**,
or run the repository's project installer. Ask your coding agent to use
motion-explainer. It writes `explainers/<slug>/diagram.kymo` and
`explainer.json`, then runs the build script. The extension opens the generated
`index.html` automatically. Saving JSON or Kymo source triggers a debounced
rebuild. Follow-up builds refresh the same player. Source references open files
in the current workspace host, including WSL/SSH, with line selections.

The extension defaults to local rendering and preserves cached SVGs. New local
renders use the upstream `npx kymostudio` CLI, so npm is needed for uncached
layouts; use built-in glyphs. Rendering online requires explicitly disabling
`motionExplainer.offline`, which sends diagram labels to Kymo. Code is not sent
by the builder. Cached sample viewing requires no npm or network.

Settings: `motionExplainer.enabled`, `autoOpen`, `autoRebuild`, `autoPlay`, and
`offline`. Rendering failures leave the previous player intact and appear in
Output and the status bar. **Refresh Player** reloads a stalled player. Tabs and
step selection restore after a window reload. Only trusted workspaces can run
builders; source links are restricted to workspace files and bundled examples.

Voiceover is enabled by default. Use the checkbox and voice selector in the
player footer; both choices are remembered. Autoplay waits for the current
narration and animation to finish. Pause freezes both, while manual navigation
and flow changes cancel old speech. Changing voice or speed restarts the current
narration. If speech is unavailable, autoplay uses readable text timing.

Speech uses browser/OS voices, including the voices offered by the VS Code
renderer. Available voices vary by platform; voices marked online may use the
system provider's service. This adds no hosted speech API or API-key requirement.
The standalone HTML and native editor share the same voice controls.
