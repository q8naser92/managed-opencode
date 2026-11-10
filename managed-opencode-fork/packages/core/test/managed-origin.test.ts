import { expect, test } from "bun:test"
import { ManagedTransport } from "../src/managed-transport.js"

test("managed enrollment canonicalizes standard HTTPS ports and preserves custom ports", () => {
  for (const [input, expected] of [
    ["https://MANAGER.example:443/", "https://manager.example"],
    ["https://manager.example:9443", "https://manager.example:9443"],
    ["https://192.168.1.118:7443/", "https://192.168.1.118:7443"],
  ]) {
    expect(ManagedTransport.parseSettings(JSON.stringify({ serverOrigin: input })).serverOrigin).toBe(expected)
  }
  for (const input of [
    "http://manager.example",
    "https://user:password@manager.example",
    "https://manager.example/api",
    "https://manager.example?server=other",
    "https://manager.example#fragment",
    "https://manager.example:65536",
  ]) {
    expect(() => ManagedTransport.parseSettings(JSON.stringify({ serverOrigin: input }))).toThrow()
  }
})
