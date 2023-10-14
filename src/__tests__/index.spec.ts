import { describe, expect, it } from "vitest"
import { createVersionedEntity, defineVersion } from "../index.js"
import { z } from "zod"

const v1_schema = z.object({
    name: z.string(),
    v: z.literal(1),
    variables: z.array(
      z.object({
        name: z.string(),
        value: z.string(),
      })
    )
  })

type V1 = z.infer<typeof v1_schema>

const v2_schema = z.object({
  name: z.string(),
  v: z.literal(2),
  variables: z.array(
    z.union([
      z.object({
        name: z.string(),
        masked: z.literal(true)
      }),
      z.object({
        name: z.string(),
        value: z.string(),
        masked: z.literal(false)
      })
    ])
  )
})
type V2 = z.infer<typeof v2_schema>


const test_V1_version = defineVersion({
  initial: true,
  schema: v1_schema
})

const test_V2_version = defineVersion({
  initial: false,
  schema: v2_schema,
  up(old: V1) {
    const x: V2 = {
      ...old,
      v: 2,
      variables: old.variables.map(v => ({
        name: v.name,
        value: v.value,
        masked: false
      }))
    }

    return x
  },
})

function createTestEntity() {
  return createVersionedEntity({ 
    latestVersion: 2,
    versionMap: {
      1: test_V1_version,
      2: test_V2_version
    },
    getVersion(data) {
      if (typeof data !== "object" || data === null) {
        return null
      }

      // @ts-expect-error - TypeScript cannot understand that the above check will ensure that data is an object
      const ver = data["v"]

      if (typeof ver !== "number") {
        return null
      }

      return ver
    }
  })
}

describe("createVersionedEntity", () => {
  it("does not throw when given valid definition", () => {
    expect(() => createTestEntity()).not.toThrow()
  })

  describe("safeParse", () => {
    it("parses entity created on latest version correctly", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 2,
        variables: [
          {
            name: "test",
            value: "test",
            masked: false
          }
        ]
      }

      expect(entity.safeParse(data)).toEqual(
        expect.objectContaining({
          type: "ok",
          value: data, 
        })
      )
    })

    it("migrates entity of old version and parses correctly", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 1,
        variables: [
          {
            name: "test",
            value: "test"
          }
        ]
      }

      expect(entity.safeParse(data)).toEqual(
        expect.objectContaining({
          type: "ok",
          value: {
            name: "test",
            v: 2,
            variables: [
              {
                name: "test",
                value: "test",
                masked: false
              }
            ]
          }
        })
      )
    })

    it("migrates entities of multiple versions and parses correctly", () => {
      const entity = createVersionedEntity({
        latestVersion: 3,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              a: z.literal("b")
            })
          }),
          2: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(2),
              a: z.literal("b")
            }),
            up(old: unknown) { 
              return {
                v: 2,
                a: "b"
              }
            }
          }),
          3: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(3),
              a: z.literal("b")
            }),
            up(old: unknown) { 
              return {
                v: 3,
                a: "b"
              }
            }
          })
        },
        getVersion(data) {
            return (data as any).v
        }
      })

      const data = {
        v: 1,
        a: "b"
      }

      expect(entity.safeParse(data)).toEqual(
        expect.objectContaining({
          type: "ok",
          value: {
            v: 3,
            a: "b"
          }
        })
      )
    })

    it("returns 'VER_CHECK_FAIL' object when getVersion could not determine version", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        variables: [
          {
            name: "test",
            value: "test"
          }
        ]
      }

      expect(entity.safeParse(data)).toEqual(
        expect.objectContaining({
          type: "err",
          error: {
            type: "VER_CHECK_FAIL"
          }
        })
      )
    })

    it("returns 'INVALID_VER' object when the version is not in the version map", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 3,
        variables: [
          {
            name: "test",
            value: "test"
          }
        ]
      }

      expect(entity.safeParse(data)).toEqual(
        expect.objectContaining({
          type: "err",
          error: {
            type: "INVALID_VER"
          }
        })
      )
    })

    it("returns 'GIVEN_VER_VALIDATION_FAIL' object when the version is in the version map but the schema fails", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 2,
        variables: [
          {
            name: "test",
            value: 1
          }
        ]
      }

      expect(entity.safeParse(data)).toEqual(
        expect.objectContaining({
          type: "err",
          error: {
            type: "GIVEN_VER_VALIDATION_FAIL",
            version: 2,
            versionDef: test_V2_version,
            error: expect.anything()
          }
        })
      )
    })

    it("returns 'BUG_NO_INTERMEDIATE_FOUND' object when the intermediate version in a migration step is not found", () => {
      const entity = createVersionedEntity({
        latestVersion: 3,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              a: z.literal("b")
            })
          }),
          3: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(3),
              a: z.literal("b")
            }),
            up(old: unknown) { 
              return old as any
            }
          })
        },
        getVersion(data) {
            return (data as any).v
        },
      })

      expect(entity.safeParse({ v: 1, a: "b" })).toEqual(
        expect.objectContaining({
          type: "err",
          error: {
            type: "BUG_NO_INTERMEDIATE_FOUND",
            missingVer: 2
          }
        })
      )
    })

    it("returns 'BUG_INTERMEDIATE_MARKED_INITIAL' object when the intermediate version in a migration step is marked as initial", () => {
      const entity = createVersionedEntity({
        latestVersion: 3,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              a: z.literal("b")
            })
          }),
          2: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(2),
              a: z.literal("b")
            })
          }),
          3: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(3),
              a: z.literal("b")
            }),
            up(old: unknown) { 
              return {
                v: 3,
                a: "b"
              }
            }
          })
        },
        getVersion(data) {
            return (data as any).v
        },
      })

      expect(entity.safeParse({ v: 1, a: "b" })).toEqual(
        expect.objectContaining({
          type: "err",
          error: {
            type: "BUG_INTERMEDIATE_MARKED_INITIAL",
            ver: 2
          }
        })
      )
    })
  })

  describe("is", () => {
    it("returns true when the data is of the latest version", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 2,
        variables: [
          {
            name: "test",
            value: "test",
            masked: false
          }
        ]
      }

      expect(entity.is(data)).toEqual(true)
    })

    it("returns true when the data is of an old version", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 1,
        variables: [
          {
            name: "test",
            value: "test"
          }
        ]
      }

      expect(entity.is(data)).toEqual(true)
    })

    it("returns false when the data does not match the latest schema version", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 2,
        variables: [
          {
            name: "test",
            value: 1
          }
        ]
      }

      expect(entity.is(data)).toEqual(false)
    })

    it("returns false whent the data does not match the old schema version", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        v: 1,
        variables: [
          {
            name: "test",
            value: 1
          }
        ]
      }

      expect(entity.is(data)).toEqual(false)
    })

    it("returns false when the data doesn't resolve to a version", () => {
      const entity = createTestEntity()

      const data = {
        name: "test",
        variables: [
          {
            name: "test",
            value: 1
          }
        ]
      }

      expect(entity.is(data)).toEqual(false)
    })
  })
})