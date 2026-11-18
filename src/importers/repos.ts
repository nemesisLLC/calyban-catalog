import { posix } from 'node:path'
import type { CatalogItem } from '../types.ts'
import { category } from '../categories.ts'
import { avatar, firstParagraph, frontmatter, github, oneLine, pool, raw, repoFromUrl, slug, titleCase } from '../util.ts'

// Imports skills (folders with SKILL.md), subagents and slash commands (markdown files)
// and Claude plugin marketplaces from GitHub repos, pinned to the commit seen now.

export interface RepoSource {
  repo: string; agents?: string; commands?: string
  /** Path prefixes to skip: translations (docs/ja-JP/…) and copies made for other tools (.kiro/, .gemini/…). */
  exclude?: string[]
}

// Never import translated copies of docs, whatever the repo.
const translatedDocs = /^docs\/(i18n\/)?[a-z]{2}(-[A-Za-z]{2,4})?\//
interface Tree { tree: { path: string; type: string; sha: string }[]; truncated: boolean }

const skipFile = /(^|\/)(README|CHANGELOG|CONTRIBUTING|LICENSE|CLAUDE|AGENTS|CODE_OF_CONDUCT|SECURITY|TEMPLATE)[^/]*\.md$/i
const genericDirs = new Set(['agents', 'commands', 'skills', 'src', 'components', 'cli-tool', 'categories', 'plugins', '.claude'])

/** Nearest meaningful folder name above a file, used as its source category label. */
function folderLabel(path: string) {
  const parts = path.split('/').slice(0, -1).reverse()
  const label = parts.find(part => !genericDirs.has(part.toLowerCase()))
  return label ? titleCase(label) : undefined
}

const installName = (value: unknown, fallback: string) => {
  const name = typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : fallback
  return slug(name, 64).replace(/\./g, '-') || fallback
}

export async function importRepo(source: RepoSource): Promise<CatalogItem[]> {
  const { repo } = source
  const owner = repo.split('/')[0]
  const commit = (await github<{ sha: string }>(`/repos/${repo}/commits/HEAD`)).sha
  const tree = await github<Tree>(`/repos/${repo}/git/trees/${commit}?recursive=1`)
  if (tree.truncated) console.warn(`  ${repo}: tree truncated; some files may be missing`)
  const excluded = (path: string) => translatedDocs.test(path) || (source.exclude ?? []).some(prefix => path.startsWith(prefix))
  const paths = tree.tree.filter(entry => entry.type === 'blob' && !excluded(entry.path)).map(entry => entry.path)
  const items: CatalogItem[] = []
  // Ids are assigned after everything is collected, in path order, so the same file gets
  // the same id on every build no matter which download finishes first.
  const uniqueId = (base: string, path: string) => `${base}\u0000${path}`
  // Version = git hash of exactly this file or folder, so "update available" only shows when it really changed.
  const hashes = new Map(tree.tree.map(entry => [entry.path, entry.sha.slice(0, 12)]))
  const common = { author: owner, repo, icon: avatar(owner), homepage: `https://github.com/${repo}` }

  // Skills: every folder with a SKILL.md, except folders nested inside another skill.
  const skillDirs = paths.filter(path => /(^|\/)SKILL\.md$/.test(path)).map(path => posix.dirname(path))
    .filter((dir, _, all) => dir !== '.' && !all.some(other => other !== dir && other !== '.' && dir.startsWith(other + '/')))
  await pool(skillDirs, 16, async dir => {
    const content = await raw(repo, commit, `${dir}/SKILL.md`)
    if (!content) return
    const meta = frontmatter(content)
    const name = installName(meta.name, posix.basename(dir))
    const description = oneLine(meta.description) || oneLine(firstParagraph(content))
    if (!description) return
    items.push({
      id: uniqueId(slug(`skill.${owner}.${name}`, 120), dir), kind: 'skill', name: titleCase(name), description, ...common,
      license: typeof meta.license === 'string' ? meta.license.slice(0, 60) : undefined,
      category: category(folderLabel(dir), name, description), tags: ['skill'], agents: ['claude', 'codex'], version: hashes.get(dir) ?? commit,
      install: { type: 'files', repo, ref: commit, path: dir, target: 'skills', name }
    })
  })

  // Subagents and slash commands: single markdown files.
  const patterns = [
    ['agent', new RegExp(source.agents ?? '(^|/)agents/[^/]+\\.md$')],
    ['command', new RegExp(source.commands ?? '(^|/)commands/[^/]+\\.md$')]
  ] as const
  for (const [kind, pattern] of patterns) {
    const files = paths.filter(path => pattern.test(path) && !skipFile.test(path) && !/(^|\/)SKILL\.md$/.test(path))
    await pool(files, 16, async path => {
      const content = await raw(repo, commit, path)
      if (!content) return
      const meta = frontmatter(content)
      const name = installName(meta.name, posix.basename(path, '.md'))
      const description = oneLine(meta.description) || oneLine(firstParagraph(content))
      // Subagents only work with a description in their frontmatter.
      if (!description || (kind === 'agent' && !meta.description)) return
      items.push({
        id: uniqueId(slug(`${kind}.${owner}.${name}`, 120), path), kind, name: titleCase(name), description, ...common,
        category: category(folderLabel(path), name, description), tags: [kind === 'agent' ? 'subagent' : 'slash command'],
        agents: kind === 'agent' ? ['claude'] : ['claude', 'codex'], version: hashes.get(path) ?? commit,
        install: { type: 'files', repo, ref: commit, path, target: kind === 'agent' ? 'agents' : 'commands', name }
      })
    })
  }

  // Plugin marketplaces (.claude-plugin/marketplace.json anywhere in the repo).
  for (const path of paths.filter(path => /(^|\/)\.claude-plugin\/marketplace\.json$/.test(path))) {
    const text = await raw(repo, commit, path)
    let market: { name?: string; plugins?: Record<string, any>[] }
    try { market = JSON.parse(text ?? '') } catch { continue }
    if (!market.name || !Array.isArray(market.plugins)) continue
    // Claude registers GitHub marketplaces by repo, so only a root-level marketplace.json is installable.
    if (posix.dirname(posix.dirname(path)) !== '.') continue
    for (const plugin of market.plugins) {
      if (typeof plugin.name !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(plugin.name)) continue
      const description = oneLine(plugin.description)
      if (!description) continue
      const source = plugin.source
      const pluginRepo = typeof source === 'object' && source?.source === 'github' && typeof source.repo === 'string' ? source.repo
        : typeof source === 'object' && typeof source?.url === 'string' ? repoFromUrl(source.url) : undefined
      const author = typeof plugin.author === 'object' && plugin.author?.name ? String(plugin.author.name) : typeof plugin.author === 'string' ? plugin.author : owner
      items.push({
        id: uniqueId(slug(`plugin.${market.name}.${plugin.name}`, 120), path), kind: 'plugin', name: titleCase(plugin.name), description,
        author, repo: pluginRepo ?? repo, homepage: typeof plugin.homepage === 'string' ? plugin.homepage : `https://github.com/${pluginRepo ?? repo}`,
        icon: avatar((pluginRepo ?? repo).split('/')[0]),
        license: typeof plugin.license === 'string' ? plugin.license : undefined,
        category: category(typeof plugin.category === 'string' ? titleCase(plugin.category) : undefined, plugin.name, description, (plugin.keywords ?? []).join?.(' ')),
        tags: ['plugin', ...(Array.isArray(plugin.keywords) ? plugin.keywords.filter((k: unknown) => typeof k === 'string').slice(0, 4) : [])],
        agents: ['claude'], runsCode: true, version: typeof plugin.version === 'string' ? plugin.version : undefined,
        install: { type: 'plugin', marketplace: { name: market.name, repo }, plugin: plugin.name }
      })
    }
  }
  // One copy per name and kind: repos often keep the same skill in several folders. Keep the shortest path.
  const byName = new Map<string, CatalogItem>()
  for (const item of items) {
    const key = `${item.kind}:${item.name.toLowerCase()}`
    const path = item.install.type === 'files' ? item.install.path : ''
    const kept = byName.get(key)
    const keptPath = kept?.install.type === 'files' ? kept.install.path : ''
    if (!kept || (path && path.length < keptPath.length) || (path.length === keptPath.length && path < keptPath)) byName.set(key, item)
  }
  items.splice(0, items.length, ...byName.values())
  const ids = new Set<string>()
  items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const item of items) {
    const [base, path] = item.id.split('\u0000')
    let id = base
    if (ids.has(id)) id = slug(`${base}.${posix.dirname(path).split('/').pop()}`, 120)
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
    ids.add(id)
    item.id = id
  }
  return items
}
