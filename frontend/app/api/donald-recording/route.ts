import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const runtime = 'nodejs'

export async function GET() {
  const recording = await readFile(join(process.cwd(), 'lib', 'donald', 'events.recorded.jsonl'), 'utf8')
  return new Response(recording, {
    headers: {
      'cache-control': 'public, max-age=3600',
      'content-type': 'application/x-ndjson; charset=utf-8',
    },
  })
}
