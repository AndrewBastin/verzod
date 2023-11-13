<div align="center">

# verzod

</div>

A simple versioning and migration library based on Zod schemas.

## Concept
*Verzod* allows you to define an 'entity' that can have multiple versions. Each version is defined by a Zod schema. You can then use the library to check if a given data matches the schema of the entity, and if not, migrate it to the latest version and use it.

## Installation
- Install the NPM package
  ```bash
  $ npm install verzod
  ```

## Usage
- Create a versioned *entity* that you want to use
  ```ts
  import { createVersionedEntity, InferredEntity } from "verzod"
  import { z } from "zod"

  const Environment_V1 = z.object({
    name: z.string(),
    v: z.literal(1),
    variables: z.array(
      z.object({
        key: z.string(),
        value: z.string(),
        masked: z.boolean()
      })
    )
  })

  const Environment_V2 = z.object({
    name: z.string(),
    v: z.literal(2),
    variables: z.array(
      z.union([
        z.object({
          name: z.string(),
          value: z.string(),
          masked: z.literal(false)
        }),
        z.object({
          name: z.string(),
          masked: z.literal(true)
        })
      ])
    )
  })

  const Environment = createVersionedEntity({
    latestVersion: 2,
    versionMap: {
      1: defineVersion({
        initial: true,
        schema: Environment_V1
      }),
      2: defineVersion({
        initial: false,
        schema: Environment_V2,
        up(old: z.infer<typeof Environment_V1>) {
          return <z.infer<typeof Environment_V2>>{
            ...old,
            v: 2,
            variables: old.variables.map(v => ({
              ...v,
              masked: false
            }))
          }
        }
      })
    },
    getVersion(data: unknown) {
      return typeof data === "object"
        && data !== null
        && "v" in data 
        && typeof data["v"] === "number" 
          ? data["v"] 
          : null 
    }
  })
  ```

- You can use the various library functionality demoed below.
  ```ts
  import { InferredEntity } from "verzod"
  
  // Get the type of the entity (will resolve to the type of the latest version schema)
  type Environment = InferredEntity<typeof Environment>


  // You can use `is` method to check if the data given matches the schema
  const v2_data = { 
    name: "test", 
    v: 2, 
    variables: [{ key: "hello", masked: true }]
  }

  Environment.is(v2_data) // Returns true

  const v1_data = { name: "test", v: 1, variables: [{ key: "hello", value: "there" }]}
  Environment.is(v1_data) // Returns true (it returns true for old versions)
  
  const invalid_ver_data = { name: "test", v: 3, variables: [] }
  Environment.is(invalid_ver_data) // false (invalid version)

  const invalid_schema_data = { name: "test", v: 2, vars: [] }
  Environment.is(invalid_schema_data) // false (invalid schema)

  // NOTE: There is also `isLatest` to check only for the latest version
  // This also narrows the type to only the latest version unlike `is` which
  // narrows to all given versions
  Environment.isLatest(v2_data) // true

  Environment.isLatest(v1_data) // false
  
  // You can use `safeParse` method to parse (and if needed, migrate) the data
  Environment.safeParse(v2_data) // { type: "ok", value: v2_data }
  Environment.safeParse(v1_data) // { type: "ok", value: { name: "test", v: 2, variables: [{ name: "hello", value: "there", masked: false }]}} <- Migrated old schema

  Environment.safeParse(invalid_ver_data) // { type: "err", error: { type: "INVALID_VER", version: 3 } <- invalid version

  Environment.safeParse(invalid_schema_data) // { type: "err", error: { type: "GIVEN_VER_VALIDATION_FAIL", version: 2, versionDef: <relevant version map entry> } } <- correct version, but invalid data

  ```
### Referring to entities in a Zod schema
You can refer to entities from a Zod schema using the `entityReference` method. This method takes in the entity you want to refer to and gives a custom Zod schema implementation. This schema implementation will validate the data against the entity's schema across the different versions and return the data (after migrations to the latest version if needed) if it is valid. Since, this is applicable to Zod schemas directly, this is also useful if you have a Verzod Versioned Entity, and you want to refer to other entities from it.
  
  ```ts
  import { entityReference } from "verzod"

  const SyncedEnvironment = z.object({
    id: z.string(),
    environment: entityReference(Environment) // from the above example
  })

  const synced_env_data = {
    id: "test",
    environment: {
      name: "test",
      v: 1,
      variables: [{ key: "hello", value: "there" }]
    }
  }

  SyncedEnvironment.safeParse(synced_env_data) // { type: "ok", value: { id: "test", environment: { name: "test", v: 2, variables: [{ name: "hello", value: "there", masked: false }] } } } <- migrated to latest version
  ```


<br />
<br />
<p align="center"><b>made with ❤️ by <a href="https://github.com/AndrewBastin">andrew bastin</a></b></p>