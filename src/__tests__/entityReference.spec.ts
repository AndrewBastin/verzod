import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createVersionedEntity,
  defineVersion,
  entityReference,
} from "../index.js";

const v1_schema = z.object({
  name: z.string(),
  v: z.literal(1),
  variables: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
    })
  ),
});

type V1 = z.infer<typeof v1_schema>;

const v2_schema = z.object({
  name: z.string(),
  v: z.literal(2),
  variables: z.array(
    z.union([
      z.object({
        name: z.string(),
        masked: z.literal(true),
      }),
      z.object({
        name: z.string(),
        value: z.string(),
        masked: z.literal(false),
      }),
    ])
  ),
});

type V2 = z.infer<typeof v2_schema>;

const test_V1_version = defineVersion({
  initial: true,
  schema: v1_schema,
});

const test_V2_version = defineVersion({
  initial: false,
  schema: v2_schema,
  up(old: V1) {
    const x: V2 = {
      ...old,
      v: 2,
      variables: old.variables.map((v) => ({
        name: v.name,
        value: v.value,
        masked: false,
      })),
    };

    return x;
  },
});

const testEntity = createVersionedEntity({
  latestVersion: 2,
  versionMap: {
    1: test_V1_version,
    2: test_V2_version,
  },
  getVersion(data) {
    if (typeof data !== "object" || data === null) {
      return null;
    }

    // @ts-expect-error - TypeScript cannot understand that the above check will ensure that data is an object
    const ver = data["v"];

    if (typeof ver !== "number") {
      return null;
    }

    return ver;
  },
});

const connectedSchema = z.object({
  v: z.literal(1),
  testEntity: entityReference(testEntity),
});

describe("entityReference", () => {
  it("should validate the entity as valid if valid latest schema", () => {
    const result = connectedSchema.safeParse({
      v: 1,
      testEntity: {
        v: 2,
        name: "test",
        variables: [
          {
            name: "test",
            value: "test",
            masked: false,
          },
        ],
      },
    });

    expect(result.success).toEqual(true);
  });

  it("should not change the entity if validated as valid with latest schema", () => {
    const result = connectedSchema.safeParse({
      v: 1,
      testEntity: {
        v: 2,
        name: "test",
        variables: [
          {
            name: "test",
            value: "test",
            masked: false,
          },
        ],
      },
    });

    expect(result.success).toEqual(true);

    if (!result.success) throw new Error("this should not be called");

    expect(result.data.testEntity).toEqual({
      v: 2,
      name: "test",
      variables: [
        {
          name: "test",
          value: "test",
          masked: false,
        },
      ],
    });
  });

  it("should validate the entity as valid if valid old schema", () => {
    const result = connectedSchema.safeParse({
      v: 1,
      testEntity: {
        v: 1,
        name: "test",
        variables: [
          {
            name: "test",
            value: "test",
          },
        ],
      },
    });

    expect(result.success).toEqual(true);
  });

  it("should transform the entity to the latest version if valid old schema", () => {
    const result = connectedSchema.safeParse({
      v: 1,
      testEntity: {
        v: 1,
        name: "test",
        variables: [
          {
            name: "test",
            value: "test",
          },
        ],
      },
    });

    expect(result.success).toEqual(true);

    if (!result.success) throw new Error("this should not be called");

    expect(result.data.testEntity).toEqual({
      v: 2,
      name: "test",
      variables: [
        {
          name: "test",
          value: "test",
          masked: false,
        },
      ],
    });
  });
});

const migrate_child_v1 = z.object({ v: z.literal(1), a: z.number() });
const migrate_child_v2 = z.object({ v: z.literal(2), b: z.number() });
const migrateChildVersioned = createVersionedEntity({
  latestVersion: 2,
  getVersion(data) {
    if (typeof data !== "object" || data === null) {
      return null;
    }
    // @ts-expect-error
    return data["v"];
  },
  versionMap: {
    1: defineVersion({
      initial: true,
      schema: migrate_child_v1,
    }),
    2: defineVersion({
      initial: false,
      schema: migrate_child_v2,
      up(
        old: z.infer<typeof migrate_child_v1>
      ): z.infer<typeof migrate_child_v2> {
        return { v: 2, b: old.a };
      },
    }),
  },
});
const migrateChildSchema = entityReference(migrateChildVersioned);

const migrate_parent_v1 = z.object({
  v: z.literal(1),
  c: z.number(),
  child: migrateChildSchema,
});
const migrate_parent_v2 = z.object({
  v: z.literal(2),
  d: z.number(),
  child: migrateChildSchema,
});

const migrateParentVersioned = createVersionedEntity({
  latestVersion: 2,
  getVersion(data) {
    if (typeof data !== "object" || data === null) {
      return null;
    }
    // @ts-expect-error
    return data["v"];
  },
  versionMap: {
    1: defineVersion({
      initial: true,
      schema: migrate_parent_v1,
    }),
    2: defineVersion({
      initial: false,
      schema: migrate_parent_v2,
      up(
        old: z.infer<typeof migrate_parent_v1>
      ): z.infer<typeof migrate_parent_v2> {
        return { v: 2, d: old.c, child: old.child };
      },
    }),
  },
});
const migrateParentSchema = entityReference(migrateParentVersioned);

describe("nested entityReference", () => {
  it("nest migrations should migrate to latest version", () => {
    const result = migrateParentSchema.safeParse({
      v: 1,
      c: 4,
      child: {
        v: 1,
        a: 8,
      },
    });
    console.log(result);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ v: 2, d: 4, child: { v: 2, b: 8 } });
    }
  });
});
