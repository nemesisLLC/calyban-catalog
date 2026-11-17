// A small fixed set of categories so the app can offer a clean genre filter.
// The first rule whose keywords match the item's text wins.

const rules: [string, RegExp][] = [
  ['Security', /\b(security|vulnerab|pentest|secrets?|auth(entication|orization)?|oauth|compliance|threat|cve|sast)\b/i],
  ['Testing & QA', /\b(test(s|ing)?|qa|playwright|cypress|jest|vitest|e2e|coverage|tdd)\b/i],
  ['Browser & Web', /\b(browser|scrap(e|ing)|crawl|web ?search|search engine|puppeteer|selenium|chrome)\b/i],
  ['Databases & Data', /\b(database|sql|postgres|mysql|sqlite|mongo|redis|supabase|bigquery|snowflake|data ?(engineer|pipeline|warehouse)|dbt|etl|analytics)\b/i],
  ['Cloud & DevOps', /\b(cloud|aws|azure|gcp|kubernetes|k8s|docker|terraform|devops|ci\/?cd|deploy|infrastructure|serverless|cloudflare|vercel|monitor(ing)?|observability|sentry|logs?)\b/i],
  ['AI & ML', /\b(llm|machine learning|ml|model(s)?|prompt|rag|embedding|vector|openai|anthropic|claude|gpt|agentic|ai)\b/i],
  ['Design & Frontend', /\b(design|ui|ux|frontend|css|tailwind|react|figma|component|accessib)/i],
  ['Documents & Office', /\b(pdf|docx?|excel|xlsx|pptx|powerpoint|spreadsheet|markdown|notion|confluence|google (docs|drive|sheets))\b/i],
  ['Media & Creative', /\b(image|video|audio|music|speech|voice|3d|animation|art|photo|creative)\b/i],
  ['Productivity & Business', /\b(slack|email|calendar|crm|sales|marketing|finance|invoice|payment|stripe|jira|linear|asana|project management|seo|ecommerce|shopify)\b/i],
  ['Git & Code Review', /\b(git|github|gitlab|pull request|pr review|code review|commit|refactor|lint)\b/i],
  ['Languages & Frameworks', /\b(python|typescript|javascript|rust|golang|go|java|kotlin|swift|ruby|php|c\+\+|c#|\.net|django|rails|next\.?js|node)\b/i],
  ['Documentation & Research', /\b(docs?|documentation|research|knowledge|wiki|search)\b/i]
]

export function inferCategory(...texts: (string | undefined)[]): string {
  const text = texts.filter(Boolean).join(' ')
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? 'Developer tools'
}

const known = new Set(rules.map(([name]) => name).concat('Developer tools'))
/** Map a source-supplied category (e.g. a folder name) to ours when it clearly matches, else infer. */
export const categories = [...known]

const aliases: Record<string, string> = {
  design: 'Design & Frontend', frontend: 'Design & Frontend', documents: 'Documents & Office', testing: 'Testing & QA',
  web: 'Browser & Web', 'browser automation': 'Browser & Web', documentation: 'Documentation & Research', research: 'Documentation & Research',
  git: 'Git & Code Review', 'code quality': 'Git & Code Review', productivity: 'Productivity & Business', 'project management': 'Productivity & Business',
  monitoring: 'Cloud & DevOps', devops: 'Cloud & DevOps', memory: 'AI & ML', reasoning: 'AI & ML', meta: 'AI & ML', security: 'Security',
  database: 'Databases & Data', data: 'Databases & Data', media: 'Media & Creative'
}

export function category(sourceLabel: string | undefined, ...texts: (string | undefined)[]) {
  const alias = sourceLabel && aliases[sourceLabel.toLowerCase()]
  if (alias) return alias
  if (sourceLabel && known.has(sourceLabel)) return sourceLabel
  return inferCategory(sourceLabel, ...texts)
}
