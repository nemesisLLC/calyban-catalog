# Calyban catalog

The public capability catalog for [Calyban](https://github.com/nemesisLLC/Calyban): MCP servers, skills, subagents, slash commands, plugins and preset packs for Claude Code and Codex.

**Live catalog:** https://nemesisllc.github.io/calyban-catalog/ is rebuilt every 6 hours.

## How it works

Every 6 hours a GitHub Action does the following:
1. Imports items from the official MCP Registry and the GitHub repos listed in [sources.json](sources.json).
2. Adds GitHub stars, owner avatars and licences.
3. Merges in the hand-picked items from [items/](items/). Curated items always win.
4. Applies a quality bar: MCPs need a GitHub repo with at least 50 stars, and the other sources are already popular repos.
5. Publishes to GitHub Pages:
   - `index.json`: compact cards for every item, about 460 KB gzipped. The app downloads this once and checks it with ETag.
   - `items/<id>.json`: the full item with its install recipe, fetched only when someone installs it.
   - `stats.json`: counts per kind.

The catalog stores **metadata only**. Skills, subagents and commands are downloaded by the app from the original GitHub repo, at the exact commit recorded here, when a user installs them. Credit, author and licence always point to the original project.

Maintained by nemesisLLC. Changes to this catalog are made only by the maintainer.
