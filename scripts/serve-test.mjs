/**
 * Serve the live DOM test over HTTP, because the page fetches ../lib/client.js
 * and a `file:` origin blocks that.
 *
 *   node scripts/serve-test.mjs [port]
 *
 * Then open the printed URL and read the log at the bottom of the page: the
 * document title becomes "PASS dsh-code-block-quote" when every check passed.
 */

import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, sep } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = normalize(join(HERE, '..'))
const PORT = Number(process.argv[2] ?? 8791)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
}

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(String(request.url ?? '/').split('?')[0])
  const relative = pathname === '/' ? '/test/live.html' : pathname
  const target = normalize(join(ROOT, relative))

  // Refuse anything that escapes the package directory.
  if (!target.startsWith(ROOT + sep) && target !== ROOT) {
    response.writeHead(403)
    response.end('forbidden')
    return
  }

  try {
    const body = await readFile(target)
    const extension = relative.slice(relative.lastIndexOf('.'))
    response.writeHead(200, { 'content-type': TYPES[extension] ?? 'text/plain; charset=utf-8' })
    response.end(body)
  } catch (error) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('not found: ' + relative)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('live DOM test:  http://127.0.0.1:' + PORT + '/test/live.html')
  console.log('visual preview: http://127.0.0.1:' + PORT + '/test/preview.html')
  console.log('ctrl-c to stop')
})
