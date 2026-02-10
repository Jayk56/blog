/**
 * Entry point: npx tsx src/index.ts --port 9100 [--mock]
 */

import http from 'node:http'
import { createApp, setupWebSocket } from './app.js'

function parseArgs(argv: string[]): { port: number; host: string; mock: boolean } {
  let port = 9100
  let host = '127.0.0.1'
  let mock = false

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10)
      i++
    } else if (argv[i] === '--host' && argv[i + 1]) {
      host = argv[i + 1]
      i++
    } else if (argv[i] === '--mock') {
      mock = true
    }
  }

  return { port, host, mock }
}

const { port, host, mock } = parseArgs(process.argv)

const app = createApp({ mock })
const server = http.createServer(app)
setupWebSocket(server, app)

server.listen(port, host, () => {
  console.log(`Claude adapter shim listening on http://${host}:${port}`)
  console.log(`Mode: ${mock ? 'mock' : 'live'}`)
  console.log(`WebSocket events: ws://${host}:${port}/events`)
})
