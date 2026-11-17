import { parse as parseYaml } from 'yaml'
import type { McpServer, Recipe } from './types.ts'

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
const headers = { 'User-Agent': 'calyban-catalog', Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }

export async function getJson<T>(url: string, init: RequestInit = {}, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) }).catch(error => error as Error)
    if (!(response instanceof Error) && response.ok) return await response.json() as T
    if (attempt >= attempts) throw new Error(`${url}: ${response instanceof Error ? response.message : response.status}`)
    await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
  }
}

export const github = <T>(path: string) => getJson<T>('https://api.github.com' + path, { headers })

export async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!token) throw new Error('GITHUB_TOKEN is required for star counts.')
  const result = await getJson<{ data: T; errors?: { message: string }[] }>('https://api.github.com/graphql',
    { method: 'POST', headers, body: JSON.stringify({ query, variables }) })
  if (!result.data) throw new Error('GraphQL: ' + result.errors?.map(e => e.message).join('; '))
  return result.data
}

export async function raw(repo: string, ref: string, path: string): Promise<string | undefined> {
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${path.split('/').map(encodeURIComponent).join('/')}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch(() => undefined)
    if (response?.ok) return await response.text()
    if (response?.status === 404) return
    await new Promise(resolve => setTimeout(resolve, 500 * attempt))
  }
}

/** Run `task` over `items` with at most `limit` in flight. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]) }
  }))
  return results
}

export const slug = (value: string, max = 60) =>
  value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, max).replace(/[-._]+$/, '')

export const titleCase = (value: string) => value.replace(/^\d+[-_]/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()

export function oneLine(value: unknown, max = 220): string {
  const text = typeof value === 'string' ? value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : ''
  return text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : text
}

export function frontmatter(content: string): Record<string, unknown> {
  const block = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1]
  if (!block) return {}
  try {
    const value = parseYaml(block)
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    // Many community files have loose YAML; fall back to simple `key: value` lines.
    return Object.fromEntries(block.split(/\r?\n/).map(line => /^([A-Za-z_-]+):\s*(.*)$/.exec(line)).filter(Boolean).map(m => [m![1], m![2].replace(/^["']|["']$/g, '')]))
  }
}

/** First paragraph of markdown body, used when there is no description in frontmatter. */
export function firstParagraph(content: string): string {
  const body = content.replace(/^﻿?---[\s\S]*?\n---/, '')
  return body.split(/\r?\n\s*\r?\n/).map(part => part.trim()).find(part => part && !part.startsWith('#') && !part.startsWith('```') && !part.startsWith('<')) ?? ''
}

export const ownerOf = (repo?: string) => repo?.split('/')[0]
export const avatar = (owner?: string) => owner ? `https://github.com/${owner}.png?size=128` : undefined

export function repoFromUrl(url: unknown): string | undefined {
  if (typeof url !== 'string') return
  const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(url)
  return match ? `${match[1]}/${match[2]}` : undefined
}

// ---- identity: the same capability from two sources must collapse to one entry ----

/** Salvaged from the engine: package identity of an MCP launch command. */
export function mcpIdentity(server: McpServer): string | undefined {
  if (server.url) return server.url.replace(/\/+$/, '').toLowerCase()
  const args = server.args ?? []
  const all = (server.command ?? '').toLowerCase() === 'cmd' && args[0]?.toLowerCase() === '/c' ? args.slice(1) : [server.command ?? '', ...args]
  const runner = all[0]?.toLowerCase().replace(/\.(cmd|exe)$/, '').split(/[\\/]/).pop()
  if (!runner || !['npx', 'uvx', 'bunx', 'pnpx', 'pipx', 'docker'].includes(runner)) return
  const pkg = all.slice(1).find(arg => !arg.startsWith('-') && arg !== 'run')
  if (!pkg) return
  return runner === 'uvx' || runner === 'pipx' ? pkg.replace(/[=<>~!].*$/, '').toLowerCase()
    : runner === 'docker' ? pkg.replace(/:[^/]*$/, '').toLowerCase()
    : pkg.replace(/(?<=.)@[^/]*$/, '').toLowerCase()
}

export function identity(recipe: Recipe): string | undefined {
  switch (recipe.type) {
    case 'mcp-stdio': return mcpIdentity({ command: recipe.command, args: recipe.args })
    case 'mcp-remote': return mcpIdentity({ url: recipe.url })
    case 'files': return `${recipe.repo}/${recipe.path}`.toLowerCase()
    case 'plugin': return `${recipe.plugin}@${recipe.marketplace.name}`.toLowerCase()
    case 'pack': return
  }
}
