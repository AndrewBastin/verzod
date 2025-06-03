import { describe, expect, it } from "vitest"
import { createVersionedEntity, defineVersion, entityRefUptoVersion } from "../index.js"
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

  describe("isUpToVersion", () => {
    it("returns true for data at exact version", () => {
      const entity = createTestEntity()
      
      const v1Data = {
        name: "test",
        v: 1,
        variables: [{
          name: "var1",
          value: "value1"
        }]
      }
      
      const v2Data = {
        name: "test",
        v: 2,
        variables: [{
          name: "var1",
          value: "value1",
          masked: false
        }]
      }
      
      expect(entity.isUpToVersion(v1Data, 1)).toBe(true)
      expect(entity.isUpToVersion(v2Data, 2)).toBe(true)
    })

    it("returns true for lower version data when checking higher bound", () => {
      const entity = createTestEntity()
      
      const v1Data = {
        name: "test",
        v: 1,
        variables: [{
          name: "var1",
          value: "value1"
        }]
      }
      
      // v1 data is valid up to version 2
      expect(entity.isUpToVersion(v1Data, 2)).toBe(true)
    })

    it("returns false when data version is higher than bound", () => {
      const entity = createTestEntity()
      
      const v2Data = {
        name: "test",
        v: 2,
        variables: [{
          name: "var1",
          value: "value1",
          masked: false
        }]
      }
      
      // v2 data is NOT valid up to version 1
      expect(entity.isUpToVersion(v2Data, 1)).toBe(false)
    })

    it("returns false for invalid data", () => {
      const entity = createTestEntity()
      
      const invalidData = {
        name: "test",
        v: 1,
        variables: "not an array" // Invalid: should be array
      }
      
      expect(entity.isUpToVersion(invalidData, 1)).toBe(false)
      expect(entity.isUpToVersion(invalidData, 2)).toBe(false)
    })

    it("returns false when version cannot be determined", () => {
      const entity = createTestEntity()
      
      const noVersionData = {
        name: "test",
        variables: []
      }
      
      expect(entity.isUpToVersion(noVersionData, 1)).toBe(false)
      expect(entity.isUpToVersion(noVersionData, 2)).toBe(false)
    })
  })

  describe("safeParseUpToVersion", () => {
    it("successfully parses and migrates v1 to v2", () => {
      const entity = createTestEntity()
      
      const v1Data = {
        name: "test",
        v: 1,
        variables: [{
          name: "var1",
          value: "value1"
        }]
      }
      
      const result = entity.safeParseUpToVersion(v1Data, 2)
      
      expect(result).toEqual({
        type: "ok",
        value: {
          name: "test",
          v: 2,
          variables: [{
            name: "var1",
            value: "value1",
            masked: false
          }]
        }
      })
    })

    it("returns data unchanged when already at target version", () => {
      const entity = createTestEntity()
      
      const v2Data = {
        name: "test",
        v: 2,
        variables: [{
          name: "var1",
          value: "value1",
          masked: false
        }]
      }
      
      const result = entity.safeParseUpToVersion(v2Data, 2)
      
      expect(result).toEqual({
        type: "ok",
        value: v2Data
      })
    })

    it("returns INVALID_VER error when data version is higher than requested", () => {
      const entity = createTestEntity()
      
      const v2Data = {
        name: "test",
        v: 2,
        variables: [{
          name: "var1",
          value: "value1",
          masked: false
        }]
      }
      
      const result = entity.safeParseUpToVersion(v2Data, 1)
      
      expect(result).toEqual({
        type: "err",
        error: { type: "INVALID_VER" }
      })
    })

    it("returns VER_CHECK_FAIL when version cannot be determined", () => {
      const entity = createTestEntity()
      
      const noVersionData = {
        name: "test",
        variables: []
      }
      
      const result = entity.safeParseUpToVersion(noVersionData, 2)
      
      expect(result).toEqual({
        type: "err",
        error: { type: "VER_CHECK_FAIL" }
      })
    })

    it("returns GIVEN_VER_VALIDATION_FAIL for invalid data", () => {
      const entity = createTestEntity()
      
      const invalidData = {
        name: "test",
        v: 1,
        variables: "not an array"
      }
      
      const result = entity.safeParseUpToVersion(invalidData, 1)
      
      expect(result).toEqual({
        type: "err",
        error: {
          type: "GIVEN_VER_VALIDATION_FAIL",
          version: 1,
          versionDef: test_V1_version,
          error: expect.anything()
        }
      })
    })

    it("handles multi-step migrations correctly", () => {
      // Create entity with 3 versions
      const entity = createVersionedEntity({
        latestVersion: 3,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              value: z.number()
            })
          }),
          2: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(2),
              value: z.number(),
              doubled: z.boolean()
            }),
            up(old: { v: 1, value: number }) {
              return {
                v: 2,
                value: old.value * 2,
                doubled: true
              }
            }
          }),
          3: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(3),
              value: z.number(),
              doubled: z.boolean(),
              tripled: z.boolean()
            }),
            up(old: { v: 2, value: number, doubled: boolean }) {
              return {
                v: 3,
                value: old.value * 1.5, // 3x original
                doubled: old.doubled,
                tripled: true
              }
            }
          })
        },
        getVersion(data) {
          return (data as any)?.v ?? null
        }
      })

      const v1Data = { v: 1, value: 10 }
      
      // Migrate v1 to v3
      const result = entity.safeParseUpToVersion(v1Data, 3)
      
      expect(result).toEqual({
        type: "ok",
        value: {
          v: 3,
          value: 30, // 10 * 2 * 1.5
          doubled: true,
          tripled: true
        }
      })
    })
  })

  describe("entityRefUptoVersion", () => {
    it("creates valid Zod schema that accepts appropriate versions", () => {
      const entity = createTestEntity()
      const schema = entityRefUptoVersion(entity, 2)
      
      const v1Data = {
        name: "test",
        v: 1,
        variables: [{ name: "var1", value: "value1" }]
      }
      
      const v2Data = {
        name: "test",
        v: 2,
        variables: [{ name: "var1", value: "value1", masked: false }]
      }
      
      // Both v1 and v2 should be valid
      expect(schema.safeParse(v1Data).success).toBe(true)
      expect(schema.safeParse(v2Data).success).toBe(true)
    })

    it("rejects data with version higher than bound", () => {
      const entity = createTestEntity()
      const schema = entityRefUptoVersion(entity, 1)
      
      const v2Data = {
        name: "test",
        v: 2,
        variables: [{ name: "var1", value: "value1", masked: false }]
      }
      
      expect(schema.safeParse(v2Data).success).toBe(false)
    })

    it("properly transforms data through migrations", () => {
      const entity = createTestEntity()
      const schema = entityRefUptoVersion(entity, 2)
      
      const v1Data = {
        name: "test",
        v: 1,
        variables: [{ name: "var1", value: "value1" }]
      }
      
      const result = schema.parse(v1Data)
      
      // Should be migrated to v2
      expect(result).toEqual({
        name: "test",
        v: 2,
        variables: [{ name: "var1", value: "value1", masked: false }]
      })
    })

    it("integrates with Zod object schemas", () => {
      const entity = createTestEntity()
      
      const containerSchema = z.object({
        id: z.string(),
        data: entityRefUptoVersion(entity, 2),
        metadata: z.record(z.string())
      })
      
      const input = {
        id: "123",
        data: {
          name: "test",
          v: 1,
          variables: [{ name: "var1", value: "value1" }]
        },
        metadata: { key: "value" }
      }
      
      const result = containerSchema.parse(input)
      
      expect(result.data.v).toBe(2) // Should be migrated
      expect(result.id).toBe("123")
    })
  })

  describe("recursive entity definitions", () => {
    it("handles recursive entities with version-bounded references", () => {
      // Define a tree-like structure with recursive references
      type TreeV1 = {
        v: 1
        name: string
        children: TreeV1[]
      }
      
      type TreeV2 = {
        v: 2
        name: string
        depth: number
        children: TreeV2[]
      }
      
      type TreeV3 = {
        v: 3
        name: string
        depth: number
        path: string
        children: TreeV3[]
      }

      // Create the entity with proper version bounds
      const TreeEntity = createVersionedEntity({
        latestVersion: 3,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              name: z.string(),
              children: z.array(z.lazy(() => entityRefUptoVersion(TreeEntity, 1)))
            })
          }),
          2: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(2),
              name: z.string(),
              depth: z.number(),
              children: z.array(z.lazy(() => entityRefUptoVersion(TreeEntity, 2)))
            }),
            up(old: TreeV1): TreeV2 {
              // The up function is responsible for migrating children
              const migratedChildren = old.children.map(child => {
                const result = TreeEntity.safeParseUpToVersion(child, 2)
                if (result.type !== "ok") throw new Error("Failed to migrate child")
                return result.value
              })
              return {
                v: 2,
                name: old.name,
                depth: 0,
                children: migratedChildren
              }
            }
          }),
          3: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(3),
              name: z.string(),
              depth: z.number(),
              path: z.string(),
              children: z.array(z.lazy(() => entityRefUptoVersion(TreeEntity, 3)))
            }),
            up(old: TreeV2): TreeV3 {
              // The up function is responsible for migrating children
              const migratedChildren = old.children.map(child => {
                const result = TreeEntity.safeParseUpToVersion(child, 3)
                if (result.type !== "ok") throw new Error("Failed to migrate child")
                return result.value
              })
              return {
                v: 3,
                name: old.name,
                depth: old.depth,
                path: `/${old.name}`,
                children: migratedChildren
              }
            }
          })
        },
        getVersion(data) {
          return (data as any)?.v ?? null
        }
      })

      // Test data with nested structure
      const v1Tree: TreeV1 = {
        v: 1,
        name: "root",
        children: [
          {
            v: 1,
            name: "child1",
            children: []
          },
          {
            v: 1,
            name: "child2",
            children: [
              {
                v: 1,
                name: "grandchild",
                children: []
              }
            ]
          }
        ]
      }

      // Parse to v2
      const v2Result = TreeEntity.safeParseUpToVersion(v1Tree, 2)
      expect(v2Result.type).toBe("ok")
      if (v2Result.type === "ok") {
        expect(v2Result.value.v).toBe(2)
        expect(v2Result.value.children[0].v).toBe(2)
        expect(v2Result.value.children[1].v).toBe(2)
        expect(v2Result.value.children[1].children[0].v).toBe(2)
      }

      // Parse to v3
      const v3Result = TreeEntity.safeParse(v1Tree)
      expect(v3Result.type).toBe("ok")
      if (v3Result.type === "ok") {
        expect(v3Result.value.v).toBe(3)
        expect(v3Result.value.path).toBe("/root")
        // Children are not automatically migrated to v3 because the schema uses entityRefUptoVersion
        // which bounds them to their respective versions
        expect(v3Result.value.children[0].v).toBe(3)
        expect(v3Result.value.children[0].path).toBe("/child1")
        expect(v3Result.value.children[1].children[0].v).toBe(3)
        expect(v3Result.value.children[1].children[0].path).toBe("/grandchild")
      }
    })

    it("demonstrates top-down migration behavior", () => {
      // This test demonstrates that migration happens top-down:
      // 1. Parent's up() function is called with unmigrated children
      // 2. After migration, the schema's entityRefUptoVersion transforms children
      
      let rootChildVersions: number[] = []
      let wasRootCaptured = false

      const TreeEntity = createVersionedEntity({
        latestVersion: 2,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              name: z.string(),
              children: z.array(z.lazy(() => entityRefUptoVersion(TreeEntity, 1)))
            })
          }),
          2: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(2),
              name: z.string(),
              children: z.array(z.lazy(() => entityRefUptoVersion(TreeEntity, 2)))
            }),
            up(old: any) {
              // Capture what versions the migration function sees for the root node only
              if (old.name === "root" && !wasRootCaptured) {
                rootChildVersions = old.children?.map((c: any) => c.v) || []
                wasRootCaptured = true
              }
              return {
                v: 2,
                name: old.name + "_v2",
                children: old.children || []
              }
            }
          })
        },
        getVersion(data) {
          return (data as any)?.v ?? null
        }
      })

      const v1Tree = {
        v: 1,
        name: "root",
        children: [
          { v: 1, name: "child1", children: [] },
          { v: 1, name: "child2", children: [] }
        ]
      }

      const result = TreeEntity.safeParse(v1Tree)
      expect(result.type).toBe("ok")
      
      if (result.type === "ok") {
        // The root's migration function saw v1 children
        expect(rootChildVersions).toEqual([1, 1])
        
        // Final result: parent is migrated but children are not (up didn't migrate them)
        expect(result.value.v).toBe(2)
        expect(result.value.name).toBe("root_v2")
        expect(result.value.children[0].v).toBe(1)
        expect(result.value.children[0].name).toBe("child1")
        expect(result.value.children[1].v).toBe(1)
        expect(result.value.children[1].name).toBe("child2")
      }
    })
  })

  describe("migration order without z.lazy", () => {
    it("tests if z.lazy affects migration order", () => {
      // Create separate entities to avoid circular reference
      let childMigrationVersion: number | null = null
      
      const ChildEntity = createVersionedEntity({
        latestVersion: 2,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              name: z.string()
            })
          }),
          2: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(2),
              name: z.string()
            }),
            up(old: any) {
              return {
                v: 2,
                name: old.name + "_child_v2"
              }
            }
          })
        },
        getVersion(data) {
          return (data as any)?.v ?? null
        }
      })

      const ParentEntity = createVersionedEntity({
        latestVersion: 2,
        versionMap: {
          1: defineVersion({
            initial: true,
            schema: z.object({
              v: z.literal(1),
              name: z.string(),
              // No z.lazy needed since ChildEntity is already defined
              child: entityRefUptoVersion(ChildEntity, 1)
            })
          }),
          2: defineVersion({
            initial: false,
            schema: z.object({
              v: z.literal(2),
              name: z.string(),
              child: entityRefUptoVersion(ChildEntity, 2)
            }),
            up(old: any) {
              // Capture child version when parent migrates
              childMigrationVersion = old.child?.v ?? null
              return {
                v: 2,
                name: old.name + "_parent_v2",
                child: old.child
              }
            }
          })
        },
        getVersion(data) {
          return (data as any)?.v ?? null
        }
      })

      const v1Data = {
        v: 1,
        name: "parent",
        child: {
          v: 1,
          name: "child"
        }
      }

      const result = ParentEntity.safeParse(v1Data)
      expect(result.type).toBe("ok")
      
      if (result.type === "ok") {
        // Parent still sees v1 child during migration (even without z.lazy)
        expect(childMigrationVersion).toBe(1)
        
        // Final result: parent is migrated but child is not (up didn't migrate it)
        expect(result.value.v).toBe(2)
        expect(result.value.name).toBe("parent_parent_v2")
        expect(result.value.child.v).toBe(1)
        expect(result.value.child.name).toBe("child")
      }
    })
  })
})
