// Shared types for the Calyban engine. Kept dependency-free so the CLI, the
// Electron app and a future Calyban MCP server can all import them.

export type Agent = 'claude' | 'codex'
export type Scope = 'user' | 'project'
export const agents: readonly Agent[] = ['claude', 'codex']

/** Kinds of capability a catalog item can be. Display grouping only; the recipe decides behaviour. */
export type Kind = 'mcp' | 'skill' | 'plugin' | 'agent' | 'command' | 'pack' | 'repo' | 'tool'

/** An MCP server definition, independent of agent config format. */
export interface McpServer {
  /** stdio transport */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** remote transport (streamable HTTP or SSE) */
  url?: string
  transport?: 'http' | 'sse'
  headers?: Record<string, string>
}

/** A user-supplied value the install needs, such as an API key. `{{NAME}}` placeholders in a recipe are replaced by it. */
export interface InputSpec {
  name: string
  description?: string
  secret?: boolean
  required?: boolean
  default?: string
}

export type Recipe =
  | { type: 'mcp-stdio'; name: string; command: string; args: string[]; env?: Record<string, string>; inputs?: InputSpec[] }
  | { type: 'mcp-remote'; name: string; url: string; transport?: 'http' | 'sse'; headers?: Record<string, string>; inputs?: InputSpec[] }
  /** Copy a directory (or single file) from a GitHub repo at a pinned commit. */
  | { type: 'files'; repo: string; ref: string; path: string; target: 'skills' | 'agents' | 'commands'; name: string }
  | { type: 'plugin'; marketplace: { name: string; repo: string; ref?: string }; plugin: string }
  /** Several items installed together. `instructions` become the profile/project AGENTS.md or CLAUDE.md for presets. */
  | { type: 'pack'; items: string[]; instructions?: string }

export interface CatalogItem {
  id: string
  kind: Kind
  name: string
  description: string
  author: string
  /** Where the capability comes from and who to credit. */
  homepage?: string
  repo?: string
  license?: string
  credits?: string
  icon?: string
  banner?: string
  tags?: string[]
  category?: string
  stars?: number
  version?: string
  /** Last upstream update (ISO date), for "recently updated" sorting. */
  updated?: string
  /** Published by a verified, well-known owner (or hand-picked by Calyban). */
  verified?: boolean
  /** Hand-picked by Calyban. */
  featured?: boolean
  /** Date the item first appeared in the catalog (ISO date), for "new". */
  added?: string
  /** GitHub stars gained over roughly the last week, for "trending". */
  trend?: number
  agents: Agent[]
  /** True when installing runs third-party code (stdio MCPs, plugins with hooks). */
  runsCode?: boolean
  install: Recipe
}

export interface Catalog {
  schemaVersion: 1
  generatedAt?: string
  items: CatalogItem[]
}

/** Something found on disk by a scan. */
export interface InstalledThing {
  kind: 'mcp' | 'skill' | 'plugin' | 'agent' | 'command'
  agent: Agent
  scope: Scope | 'local'
  name: string
  /** Config file or directory it was found in. */
  location: string
  description?: string
  mcp?: McpServer
  /** Matching catalog item id, when one is recognised. */
  catalogId?: string
  /** Installed by Calyban (present in the ledger). */
  managed?: boolean
  updateAvailable?: boolean
}

export interface ScanResult {
  agent: Agent
  detected: boolean
  project?: string
  items: InstalledThing[]
  problems: string[]
}

/** One reversible change Calyban made. Removal undoes these in reverse order. */
export type Change =
  /** `prune`: number of leading path segments that existed before; deeper empty containers are removed too. */
  | { type: 'json-key'; file: string; path: (string | number)[]; prune?: number; createdFile?: boolean }
  | { type: 'toml-table'; file: string; table: string[]; createdFile?: boolean }
  | { type: 'created-path'; path: string }
  | { type: 'native'; agent: Agent; remove: string[]; cwd?: string }

export interface LedgerEntry {
  id: string
  itemId: string
  version?: string
  agent: Agent
  scope: Scope
  project?: string
  installedAt: string
  changes: Change[]
  /** Backups of files before this install modified them. */
  backups: { file: string; backup: string | null }[]
  /** Set when this entry was installed as part of a pack. */
  parent?: string
}

export interface InstallTarget {
  agent: Agent
  scope: Scope
  /** Absolute project directory; required for project scope. */
  project?: string
}
