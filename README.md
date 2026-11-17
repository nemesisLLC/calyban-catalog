# Calyban catalog

The public capability catalog for [Calyban](https://github.com/nemesisLLC/Calyban): MCP servers, skills, subagents, slash commands, plugins and preset packs for Claude Code and Codex.

[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=fff)](https://discord.gg/pHDNtgYvWn) [![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-calyban-FFDD00?logo=buymeacoffee&logoColor=000)](https://buymeacoffee.com/calyban)

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

## Community

Questions, ideas or a capability you want added? Join the [Calyban Discord](https://discord.gg/pHDNtgYvWn).

## Support Calyban

Calyban and this catalog are free. If Calyban saves you time, you can [buy me a coffee](https://buymeacoffee.com/calyban).

## License

You can use this catalog, and the code that builds it, in your own project **only if your product visibly credits it**: show "Catalog powered by Calyban" with a link to [calyban.com](https://calyban.com), and say so at the top of your README. All other rights are reserved. Each listed project keeps its own license. Full terms are in [LICENSE](LICENSE).
