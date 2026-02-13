import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export async function listenEphemeral(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, resolve))
  return (server.address() as AddressInfo).port
}
