import { expect, test } from "bun:test"
import { managedRoute } from "../src/managed-routes"

test("managed desktop API admits its reviewed session routes and closes execution/configuration shortcuts", () => {
  for (const [method, path] of [["GET", "/api/session"], ["POST", "/api/session"], ["POST", "/api/session/s_123/prompt"], ["POST", "/api/session/s_123/interrupt"], ["GET", "/api/session/s_123/message"], ["POST", "/api/shell"], ["GET", "/api/shell/sh_123/output"]])
    expect(managedRoute(method!, path!)).toBe(true)
  for (const path of ["/api/pty", "/api/persistent-pty", "/api/config", "/api/mcp", "/api/credential", "/api/plugin", "/api/experimental/browser", "/api/session/import", "/api/session/s_123/command", "/api/schedule", "/api/server/pairing", "/api/session/s_123/transfer"])
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(managedRoute(method, path)).toBe(false)
  expect(managedRoute("POST", "/api/%73hell")).toBe(false)
})
