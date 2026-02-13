/**
 * Entry point: npx tsx src/index.ts --port 9100 [--mock]
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, setupWebSocket } from './app.js'

function parseArgs(argv: string[]): { port: number; host: string; mock: boolean; workspace?: string } {
  let port = parseInt(process.env.AGENT_PORT ?? '9100', 10)
  let host = '127.0.0.1'
  let mock = false
  let workspace: string | undefined

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      port = parseInt(argv[i + 1], 10)
      i++
    } else if (argv[i] === '--host' && argv[i + 1]) {
      host = argv[i + 1]
      i++
    } else if (argv[i] === '--workspace' && argv[i + 1]) {
      workspace = argv[i + 1]
      i++
    } else if (argv[i] === '--mock') {
      mock = true
    }
  }

  return { port, host, mock, workspace }
}

const { port, host, mock, workspace } = parseArgs(process.argv)

const app = createApp({ mock, workspace })
const server = http.createServer(app)
setupWebSocket(server, app)

server.listen(port, host, () => {
  const actualPort = (server.address() as AddressInfo).port

  // Announce port on stdout for parent process discovery
  process.stdout.write(JSON.stringify({ port: actualPort }) + '\n')

  console.log(`Claude adapter shim listening on http://${host}:${actualPort}`)
  console.log(`Mode: ${mock ? 'mock' : 'live'}`)
  console.log(`WebSocket events: ws://${host}:${actualPort}/events`)
})
