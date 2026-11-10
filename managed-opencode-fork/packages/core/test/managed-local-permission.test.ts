import { afterAll, beforeEach, expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Location } from "@opencode/core/location"
import { ManagedCentral } from "@opencode/core/managed-central"
import { Permission } from "@opencode/core/permission"
import { PermissionSaved } from "@opencode/core/permission/saved"
import { Project } from "@opencode/core/project"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

// The central wire protocol has separate TLS integration tests. This suite owns
// what the real local Permission service does after that boundary decides.
const authorize = spyOn(ManagedCentral, "authorize")
beforeEach(() => { authorize.mockClear(); authorize.mockImplementation(() => Effect.succeed({ id: "grant", revision: 1, maxCommandSeconds: 60 })) })
afterAll(() => authorize.mockRestore())
const current = Layer.succeed(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make("/project") })))
const it = testEffect(AppNodeBuilder.build(
  LayerNode.group([Database.node, Bus.node, SessionStore.node, PermissionSaved.node, Agent.node, Permission.node]),
  [Location.node.replace(current)],
))
const sessionID = Session.ID.make("ses_managed_local")
function setup(rules: Permission.Ruleset) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(ProjectTable).values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] }).onConflictDoNothing().run().pipe(Effect.orDie)
    yield* db.insert(SessionTable).values({ id: sessionID, project_id: Project.ID.global, slug: "test", directory: "/project", title: "test", version: "test", agent: Agent.ID.make("test") }).onConflictDoNothing().run().pipe(Effect.orDie)
    const agents = yield* Agent.Service
    yield* agents.transform(editor => editor.update(Agent.ID.make("test"), agent => { agent.permissions = [...rules] }))
    return yield* Permission.Service
  })
}
it.effect("external workspace and ordinary file asks fail explicitly without leaving a local prompt", () => Effect.gen(function* () {
  const permission = yield* setup([])
  for (const action of ["external_directory", "read", "edit"]) {
    const error = yield* permission.assert({ sessionID, action, resources: ["private-file"] }).pipe(Effect.flip)
    expect(error).toBeInstanceOf(Permission.BlockedError)
    expect((error as Permission.BlockedError).reason).toContain(action === "external_directory" ? "outside the selected workspace" : "unsupported local approval")
    expect(yield* permission.list()).toEqual([])
  }
  expect(authorize).toHaveBeenCalledTimes(2)
}))
it.effect("a centrally authorized workspace read succeeds once while a local denial remains effective", () => Effect.gen(function* () {
  const permission = yield* setup([{ action: "read", resource: "src/*", effect: "allow" }, { action: "read", resource: "private/*", effect: "deny" }])
  yield* permission.assert({ sessionID, action: "read", resources: ["src/main.ts"] })
  expect(authorize).toHaveBeenCalledTimes(1)
  const error = yield* permission.assert({ sessionID, action: "read", resources: ["private/key.txt"] }).pipe(Effect.flip)
  expect(error).toBeInstanceOf(Permission.BlockedError)
  expect(yield* permission.list()).toEqual([])
}))
it.effect("a central refusal cannot be overridden by a local allow", () => Effect.gen(function* () {
  authorize.mockImplementation(() => Effect.fail(new ManagedCentral.Unavailable({ reason: "denied" })))
  const permission = yield* setup([{ action: "read", resource: "*", effect: "allow" }])
  const error = yield* permission.assert({ sessionID, action: "read", resources: ["src/main.ts"] }).pipe(Effect.flip)
  expect(error).toBeInstanceOf(Permission.BlockedError)
  expect((error as Permission.BlockedError).reason).toBe("Central policy did not authorize this file action")
  expect(authorize).toHaveBeenCalledTimes(1)
  expect(yield* permission.list()).toEqual([])
}))
it.effect("an explicit external-directory denial explains the workspace boundary without asking", () => Effect.gen(function* () {
  const permission = yield* setup([{ action: "external_directory", resource: "*", effect: "deny" }])
  const error = yield* permission.assert({ sessionID, action: "external_directory", resources: ["/private"] }).pipe(Effect.flip)
  expect(error).toBeInstanceOf(Permission.BlockedError)
  expect((error as Permission.BlockedError).message).toContain("outside the selected workspace")
  expect(yield* permission.list()).toEqual([])
  expect(authorize).not.toHaveBeenCalled()
}))
