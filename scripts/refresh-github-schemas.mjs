import fs from 'node:fs'
import path from 'node:path'

const SCHEMAS_DIR = path.join(import.meta.dirname, '..', 'schemas')

const SOURCES = {
  'github-workflow.json': 'https://json.schemastore.org/github-workflow.json',
  'github-action.json': 'https://json.schemastore.org/github-action.json',
  LICENSE: 'https://raw.githubusercontent.com/SchemaStore/schemastore/master/LICENSE',
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.text()
}

for (const [file, url] of Object.entries(SOURCES)) {
  const body = await download(url)
  if (file.endsWith('.json')) JSON.parse(body)
  fs.writeFileSync(path.join(SCHEMAS_DIR, file), body)
  process.stdout.write(`${file} ← ${url}\n`)
}
