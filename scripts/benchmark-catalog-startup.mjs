import { performance } from 'node:perf_hooks'

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

async function timed(name, request) {
  const startedAt = performance.now()
  const response = await fetch(request)
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(`${name} failed with HTTP ${response.status}: ${body?.code ?? body?.message ?? 'unknown error'}`)
  return { name, durationMs: Number((performance.now() - startedAt).toFixed(2)), body }
}

const baseUrl = new URL(argument('--base-url', 'http://127.0.0.1:8798'))
const health = await timed('health', new URL('/api/health', baseUrl))
const facets = await timed('facets', new URL('/api/registry/catalog/facets', baseUrl))
const searchUrl = new URL('/api/registry/catalog/search', baseUrl)
searchUrl.searchParams.set('type', argument('--type', 'cpu'))
searchUrl.searchParams.set('limit', '40')
searchUrl.searchParams.set('offset', '0')
const category = await timed('category', searchUrl)

console.log(JSON.stringify({
  baseUrl: baseUrl.origin,
  timings: [health, facets, category].map(({ name, durationMs }) => ({ name, durationMs })),
  catalog: {
    revision: facets.body.catalogRevision ?? null,
    categories: facets.body.categories?.length ?? 0,
    categoryResults: category.body.items?.length ?? 0,
    categoryTotal: category.body.total ?? 0,
  },
}, null, 2))
