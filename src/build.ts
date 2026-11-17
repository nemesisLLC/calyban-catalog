import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CatalogItem, Kind } from './types.ts'
import { importRegistry } from './importers/mcp-registry.ts'
import { importRepo, type RepoSource } from './importers/repos.ts'
import { avatar, graphql, identity, pool } from './util.ts'
import { category } from './categories.ts'

// Builds the published catalog:
//   dist/index.json        compact cards for every item (what the app downloads and searches)
//   dist/items/<id>.json   full item with its install recipe (fetched only when installing)
// Curated items in items/*.json always win over imported ones.

const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'dist'
const sources = JSON.parse(await readFile('sources.json', 'utf8')) as { mcpRegistry: string; repos: RepoSource[]; minStars?: Record<string, number> }

export interface Card {
  id: string; kind: Kind; name: string; description: string; author: string
  icon?: string; stars?: number; category?: string; tags?: string[]; agents: CatalogItem['agents']
  runsCode?: boolean; updated?: string; repo?: string
  /** Identity used by the app to recognise already-installed things during a scan. */
  match?: string
  /** Name it is installed under (MCP server key, skill folder, file name or plugin id). */
  installAs?: string
}

const log = (message: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${message}`)

async function curated(): Promise<CatalogItem[]> {
  const files = (await readdir('items')).filter(file => file.endsWith('.json'))
  return Promise.all(files.map(async file => JSON.parse(await readFile(join('items', file), 'utf8')) as CatalogItem))
}

async function collect(): Promise<CatalogItem[][]> {
  const groups: CatalogItem[][] = [await curated()]
  log(`curated: ${groups[0].length}`)
  try {
    const registry = await importRegistry(sources.mcpRegistry)
    log(`MCP Registry: ${registry.length}`)
    groups.push(registry)
  } catch (error) { console.error('MCP Registry import failed:', (error as Error).message) }
  const repos = await pool(sources.repos, 3, async source => {
    try {
      const items = await importRepo(source)
      log(`${source.repo}: ${items.length}`)
      return items
    } catch (error) {
      console.error(`${source.repo} import failed:`, (error as Error).message)
      return []
    }
  })
  groups.push(...repos)
  return groups
}

/** Merge groups in priority order, dropping later items with a duplicate id or install identity. */
function merge(groups: CatalogItem[][]): CatalogItem[] {
  const ids = new Set<string>()
  const identities = new Set<string>()
  const merged: CatalogItem[] = []
  for (const item of groups.flat()) {
    const key = identity(item.install)
    if (ids.has(item.id) || (key && identities.has(key))) continue
    ids.add(item.id)
    if (key) identities.add(key)
    merged.push(item)
  }
  return merged
}

/** Stars, owner avatars and licences for every referenced GitHub repo, 50 repos per GraphQL call. */
async function enrich(items: CatalogItem[]) {
  const repos = [...new Set(items.map(item => item.repo).filter((repo): repo is string => !!repo))]
  const info = new Map<string, { stars: number; license?: string; pushedAt?: string; archived: boolean; avatar?: string }>()
  const batches = Array.from({ length: Math.ceil(repos.length / 50) }, (_, i) => repos.slice(i * 50, i * 50 + 50))
  await pool(batches, 4, async batch => {
    const query = 'query {' + batch.map((repo, i) => {
      const [owner, name] = repo.split('/')
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { stargazerCount isArchived pushedAt licenseInfo { spdxId } owner { avatarUrl } }`
    }).join(' ') + '}'
    try {
      const data = await graphql<Record<string, any>>(query)
      batch.forEach((repo, i) => {
        const r = data[`r${i}`]
        if (r) info.set(repo.toLowerCase(), { stars: r.stargazerCount, archived: r.isArchived, pushedAt: r.pushedAt,
          license: r.licenseInfo?.spdxId && r.licenseInfo.spdxId !== 'NOASSERTION' ? r.licenseInfo.spdxId : undefined, avatar: r.owner?.avatarUrl })
      })
    } catch (error) {
      // GraphQL fails the whole batch if any repo is missing; retry one by one.
      if (batch.length > 1) for (const repo of batch) await enrichOne(repo, info)
      else console.warn('  enrich failed:', (error as Error).message.slice(0, 120))
    }
  })
  log(`GitHub metadata for ${info.size}/${repos.length} repos`)
  for (const item of items) {
    const meta = item.repo ? info.get(item.repo.toLowerCase()) : undefined
    if (!meta) continue
    if (meta.archived) archived.add(item.id)
    item.stars = meta.stars
    item.license ??= meta.license
    item.updated ??= meta.pushedAt
    if (!item.icon || item.icon === avatar(item.repo!.split('/')[0])) item.icon = meta.avatar ?? item.icon
  }
  return items
}
const archived = new Set<string>()

async function enrichOne(repo: string, info: Map<string, any>) {
  const [owner, name] = repo.split('/')
  try {
    const data = await graphql<{ r: any }>('query($o:String!,$n:String!){ r: repository(owner:$o,name:$n){ stargazerCount isArchived pushedAt licenseInfo{spdxId} owner{avatarUrl} } }', { o: owner, n: name })
    if (data.r) info.set(repo.toLowerCase(), { stars: data.r.stargazerCount, archived: data.r.isArchived, pushedAt: data.r.pushedAt,
      license: data.r.licenseInfo?.spdxId !== 'NOASSERTION' ? data.r.licenseInfo?.spdxId : undefined, avatar: data.r.owner?.avatarUrl })
  } catch { /* missing or private repo */ }
}

/** Drop pack members that no longer exist upstream (warn, don't fail the whole build). */
function prunePacks(items: CatalogItem[]) {
  const ids = new Set(items.map(item => item.id))
  for (const item of items) if (item.install.type === 'pack') {
    const missing = item.install.items.filter(id => !ids.has(id))
    if (missing.length) console.warn(`  ${item.id}: dropping missing members ${missing.join(', ')}`)
    item.install.items = item.install.items.filter(id => ids.has(id))
  }
  return items.filter(item => item.install.type !== 'pack' || item.install.items.length)
}

function validate(items: CatalogItem[]) {
  for (const item of items) {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(item.id)) throw new Error(`Invalid id: ${item.id}`)
    if (!item.name || !item.description || !item.author || !item.agents?.length || !item.install?.type) throw new Error(`Incomplete item: ${item.id}`)
  }
  const ids = new Set(items.map(item => item.id))
  for (const item of items) if (item.install.type === 'pack')
    for (const member of item.install.items) if (!ids.has(member)) throw new Error(`Pack ${item.id} references missing ${member}`)
}

const card = (item: CatalogItem): Card => ({
  id: item.id, kind: item.kind, name: item.name, description: item.description, author: item.author,
  icon: item.icon, stars: item.stars, category: item.category, tags: item.tags?.slice(0, 5), agents: item.agents,
  runsCode: item.runsCode, updated: item.updated?.slice(0, 10), repo: item.repo, match: identity(item.install),
  installAs: item.install.type === 'plugin' ? `${item.install.plugin}@${item.install.marketplace.name}` : 'name' in item.install ? item.install.name : undefined
})

const groups = await collect()
const curatedIds = new Set(groups[0].map(item => item.id))
// Quality bar: keep curated picks plus semi-popular imports (see minStars in sources.json).
const items = (await enrich(merge(groups))).filter(item => {
  if (curatedIds.has(item.id)) return true
  const min = sources.minStars?.[item.kind] ?? 0
  if (item.kind === 'mcp' && (!item.repo || archived.has(item.id))) return false
  return (item.stars ?? 0) >= min
})
// Every item ends up in one of the fixed categories; packs keep "Packs" so the UI can group presets.
for (const item of items) item.category = item.kind === 'pack' ? 'Packs' : category(item.category, item.name, item.description)
const published = prunePacks(items)
validate(published)
items.length = 0
items.push(...published)
items.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.name.localeCompare(b.name))

const counts: Record<string, number> = {}
for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1
const generatedAt = new Date().toISOString()

await rm(out, { recursive: true, force: true })
await mkdir(join(out, 'items'), { recursive: true })
await writeFile(join(out, 'index.json'), JSON.stringify({ schemaVersion: 1, format: 'index', generatedAt, counts, items: items.map(card) }))
await pool(items, 64, item => writeFile(join(out, 'items', `${item.id}.json`), JSON.stringify(item)))
await writeFile(join(out, 'stats.json'), JSON.stringify({ generatedAt, total: items.length, counts }, null, 2))
await writeFile(join(out, '.nojekyll'), '')
await writeFile(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Calyban catalog</title>
<style>body{font:16px system-ui;max-width:640px;margin:48px auto;padding:0 16px}td{padding:4px 16px 4px 0}</style>
<h1>Calyban catalog</h1><p>${items.length.toLocaleString()} capabilities for Claude Code and Codex. Updated ${generatedAt.slice(0, 16).replace('T', ' ')} UTC.</p>
<table>${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([kind, n]) => `<tr><td>${kind}</td><td>${n.toLocaleString()}</td></tr>`).join('')}</table>
<p>Machine-readable: <a href="index.json">index.json</a> · items/&lt;id&gt;.json · <a href="stats.json">stats.json</a></p>`)
log(`wrote ${items.length} items to ${out}/ ${JSON.stringify(counts)}`)
