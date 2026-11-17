import type { CatalogItem, InputSpec } from '../types.ts'
import { inferCategory } from '../categories.ts'
import { avatar, getJson, oneLine, ownerOf, repoFromUrl, slug } from '../util.ts'

// Imports every active, latest server from the official MCP Registry and turns it into
// an install recipe. Hosted (remote) servers are preferred because they run no code
// locally; otherwise npm (npx), PyPI (uvx) or OCI (docker) packages are pinned to the
// exact published version.

interface Argument { type: 'positional' | 'named'; name?: string; value?: string; default?: string; isRequired?: boolean; description?: string; valueHint?: string }
interface Variable { name: string; description?: string; isRequired?: boolean; isSecret?: boolean; default?: string }
interface Package {
  registryType: string; identifier: string; version?: string; transport?: { type: string }
  runtimeArguments?: Argument[]; packageArguments?: Argument[]; environmentVariables?: Variable[]
}
interface Remote { type: string; url: string; headers?: Variable[] }
interface Server {
  name: string; title?: string; description?: string; version: string; websiteUrl?: string
  repository?: { url?: string }; icons?: { src: string }[]; packages?: Package[]; remotes?: Remote[]
}
interface Page { servers: { server: Server; _meta?: Record<string, { status?: string; isLatest?: boolean; updatedAt?: string }> }[]; metadata: { nextCursor?: string } }

const inputName = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'VALUE'

function argumentList(list: Argument[] | undefined, inputs: InputSpec[]): string[] | undefined {
  const args: string[] = []
  for (const arg of list ?? []) {
    let value = arg.value ?? arg.default
    if (value === undefined) {
      if (!arg.isRequired) continue
      const name = inputName(arg.name ?? arg.valueHint ?? `ARG_${inputs.length + 1}`)
      inputs.push({ name, description: oneLine(arg.description, 160) || undefined, required: true })
      value = `{{${name}}}`
    }
    if (/\{[^{}]+\}/.test(value.replace(/\{\{[A-Z0-9_]+\}\}/g, ''))) return // templated values we can't fill
    if (arg.type === 'named' && arg.name) args.push(arg.name, value)
    else args.push(value)
  }
  return args
}

function envFor(variables: Variable[] | undefined, inputs: InputSpec[]) {
  const env: Record<string, string> = {}
  for (const variable of variables ?? []) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.name)) continue
    env[variable.name] = `{{${inputName(variable.name)}}}`
    inputs.push({ name: inputName(variable.name), description: oneLine(variable.description, 160) || undefined,
      secret: variable.isSecret || undefined, required: variable.isRequired === true,
      ...(variable.default !== undefined ? { default: variable.default } : {}) })
  }
  return Object.keys(env).length ? env : undefined
}

function recipeFor(server: Server, configName: string): Pick<CatalogItem, 'install' | 'runsCode' | 'version'> | undefined {
  const remote = server.remotes?.find(r => (r.type === 'streamable-http' || r.type === 'sse') && /^https:\/\/[^{}\s]+$/.test(r.url))
  if (remote) {
    const inputs: InputSpec[] = []
    const headers: Record<string, string> = {}
    for (const header of remote.headers ?? []) {
      const name = inputName('HEADER_' + header.name)
      headers[header.name] = `{{${name}}}`
      inputs.push({ name, description: oneLine(header.description, 160) || undefined, secret: header.isSecret || undefined, required: header.isRequired === true })
    }
    return { install: { type: 'mcp-remote', name: configName, url: remote.url, transport: remote.type === 'sse' ? 'sse' : 'http',
      ...(inputs.length ? { headers, inputs } : {}) } }
  }
  for (const pkg of server.packages ?? []) {
    if ((pkg.transport?.type ?? 'stdio') !== 'stdio' || !pkg.identifier) continue
    const version = pkg.version && pkg.version !== 'latest' ? pkg.version : server.version
    const inputs: InputSpec[] = []
    const runtime = argumentList(pkg.runtimeArguments, inputs)
    const packageArgs = argumentList(pkg.packageArguments, inputs)
    if (!runtime || !packageArgs) continue
    const env = envFor(pkg.environmentVariables, inputs)
    let command: string, args: string[]
    if (pkg.registryType === 'npm') { command = 'npx'; args = ['-y', ...runtime, `${pkg.identifier}@${version}`, ...packageArgs] }
    else if (pkg.registryType === 'pypi') { command = 'uvx'; args = [...runtime, `${pkg.identifier}==${version}`, ...packageArgs] }
    else if (pkg.registryType === 'oci') {
      command = 'docker'
      const image = pkg.identifier.includes(':') ? pkg.identifier : `${pkg.identifier}:${version}`
      args = ['run', '-i', '--rm', ...Object.keys(env ?? {}).flatMap(name => ['-e', name]), ...runtime, image, ...packageArgs]
    } else continue
    return { version, runsCode: true, install: { type: 'mcp-stdio', name: configName, command, args, ...(env ? { env } : {}), ...(inputs.length ? { inputs } : {}) } }
  }
}

function authorOf(name: string) {
  const [namespace] = name.split('/')
  const github = /^io\.github\.(.+)$/.exec(namespace)
  return github ? github[1] : namespace.split('.').reverse().join('.')
}

export async function importRegistry(base: string, verifiedOwners: string[] = []): Promise<CatalogItem[]> {
  const trusted = new Set(verifiedOwners.map(owner => owner.toLowerCase()))
  // Registry namespaces are proven: io.github.<owner> by GitHub login, com.<company> by DNS.
  const verifiedName = (name: string) => {
    const namespace = name.split('/')[0].toLowerCase()
    const github = /^io\.github\.(.+)$/.exec(namespace)?.[1]
    const company = /^com\.([a-z0-9-]+)$/.exec(namespace)?.[1]
    return trusted.has(github ?? company ?? '')
  }
  const items: CatalogItem[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const url = `${base}?limit=100&version=latest${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const page = await getJson<Page>(url)
    for (const { server, _meta } of page.servers) {
      const official = _meta?.['io.modelcontextprotocol.registry/official']
      if (official?.status && official.status !== 'active') continue
      const last = server.name.split('/').pop() ?? server.name
      const configName = slug(server.title || last, 40).replace(/[._]/g, '-') || 'mcp'
      const recipe = recipeFor(server, configName)
      if (!recipe) continue
      const author = authorOf(server.name)
      // A server under io.github.<owner> may only claim a repo that owner controls; otherwise
      // it could borrow a famous repo's stars. Other namespaces can't be checked this way.
      const claimed = repoFromUrl(server.repository?.url)
      const repo = claimed && (!/^io.github./.test(server.name) || claimed.split('/')[0].toLowerCase() === author.toLowerCase()) ? claimed : undefined
      const description = oneLine(server.description) || `${server.title ?? last} MCP server.`
      items.push({
        id: 'mcp.' + slug(server.name.replace(/\//g, '.'), 120),
        kind: 'mcp', name: server.title || last, description, author,
        homepage: server.websiteUrl ?? (repo ? `https://github.com/${repo}` : undefined), repo,
        icon: server.icons?.find(icon => /^https:/.test(icon.src))?.src ?? avatar(repo ? ownerOf(repo) : /^io\.github\./.test(server.name) ? author : undefined),
        category: inferCategory(server.title, description), tags: ['mcp', recipe.install.type === 'mcp-remote' ? 'hosted' : 'local'],
        agents: recipe.install.type === 'mcp-remote' && recipe.install.transport === 'sse' ? ['claude'] : ['claude', 'codex'], credits: `Listed in the official MCP Registry as ${server.name}.`,
        updated: official?.updatedAt, verified: verifiedName(server.name), ...recipe
      } as CatalogItem)
    }
    cursor = page.metadata.nextCursor
  } while (cursor && ++pages < 500)
  return items
}
