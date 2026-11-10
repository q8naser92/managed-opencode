import path from "node:path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { EnterpriseConfig } from "../../src/config/enterprise"
import { ConfigDiscovery } from "../../src/config/discovery"
import { AppNodeBuilder } from "../../src/effect/app-node-builder"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "../../src/location"
import { AbsolutePath } from "../../src/schema"
import { location } from "../fixture/location"
import { withEnv } from "../fixture/env"
import { tmpdir } from "../fixture/tmpdir"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

describe("managed platform discovery", () => {
  it.live("ignores environment, explicit file, inline config and system opt-out", () =>
    Effect.acquireDisposable(Effect.promise(() => tmpdir())).pipe(
      Effect.flatMap((tmp) => {
        const expected = EnterpriseConfig.directory()
        return withEnv({ ProgramData: tmp.path, XDG_CONFIG_HOME: tmp.path, OPENCODE_CONFIG_DIR: tmp.path, OPENCODE_CONFIG_CONTENT: '{"model":"evil/x"}' }, () =>
          Effect.gen(function* () {
            const sources = yield* ConfigDiscovery.discover({
              system: false,
              global: false,
              file: path.join(tmp.path, "evil.json"),
              content: '{"model":"evil/x"}',
            })
            expect(sources.system?.path).toBe(expected)
            expect(sources.explicit).toBeUndefined()
            expect(sources.global).toBeUndefined()
            expect(sources.direct).toEqual([])
            expect(sources.project).toEqual([])
            expect(sources.claude).toEqual([])
            expect(sources.agents).toEqual([])
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                AppNodeBuilder.build(FSUtil.node),
                Global.layerWith({ config: tmp.path, home: tmp.path }),
                Layer.succeed(Location.Service, location({ directory: AbsolutePath.make(tmp.path) })),
              ),
            ),
          ),
        )
      }),
    ),
  )
})
