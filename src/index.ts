import { z } from "zod"

/**
 * Defines a version of a Verzod entity schema and how to upgrade from the previous version.
 */
export type Version<NewScheme extends z.ZodType, OldScheme> = {
  /**
   * The schema for this version of the entity.
   */
  schema: NewScheme
} & (
  | {
      /**
       * Whether this version is the initial version of the entity.
       */
      initial: true
    }
  | {
      /**
       * Whether this version is the initial version of the entity.
       */
      initial: false

      /**
       * Migrate from the previous version of the schema
       * @param old The data as in the previous version of the schema
       *
       * @returns The data as in the new version of the schema
       */
      up: (old: OldScheme) => z.infer<NewScheme>
    }
)

/**
 * A helper function to define a version of a Verzod entity schema
 * and how to upgrade from the previous version.
 *
 * NOTE: This function is a simple identity function that returns the given parameter.
 * This is only used to help TypeScript infer the type of the given parameter cleanly.
 * @param def The version definition
 */
export const defineVersion = <NewScheme extends z.ZodType, OldScheme>(
  def: Version<NewScheme, OldScheme>
) => def

/**
 * Extracts the final type from a version definition
 */
export type SchemaOf<T extends Version<any, any>> = T extends Version<infer S, any>
  ? z.infer<S>
  : never

/**
 * The definition of a result derived from parsing a Verzod entity.
 */
export type ParseResult<T> =
  | { type: "ok"; value: T }
  | {
      type: "err"
      error:
        | {
            /**
             * The version of the data was not able to be determined by the entity definition.
             * Most probably the data is not a valid entity.
             */
            type: "VER_CHECK_FAIL"
          }
        | {
            /**
             * The version of the data as determined by the entity definition
             * is not a valid version as it is not defined in the entity's version map.
             */
            type: "INVALID_VER"
          }
        | {
            /**
             * The data is of a valid version but does not pass
             * the schema validation for that version.
             */
            type: "GIVEN_VER_VALIDATION_FAIL"

            /**
             * The version of the data as determined by the entity definition.
             */
            version: number

            /**
             * The definition of the version of the data
             * corresponding to the determined version
             */
            versionDef: Version<z.ZodType, unknown>

            /**
             * The `ZodError` returned by the schema validation.
             */
            error: z.ZodError
          }
        | {
            /**
             * Most likely an error in how the version was defined.
             * The data is of a valid version but the entity definition
             * lacks an intermediate version definition.
             *
             * Example: If you have 3 versions with the latest being version 3,
             * and you have defined only version 3 and version 1 in the versionMap,
             * then this error will be thrown when you try to parse a version 1 data,
             * as Verzod will try to migrate from 1 to 2 and then from 2 to 3.
             */
            type: "BUG_NO_INTERMEDIATE_FOUND"

            /**
             * The version that is missing from the entity definition.
             */
            missingVer: number
          }
        | {
            /**
             * Most likely an error in how the version was defined.
             * The data is of a valid version but the entity definition
             * has marked an intermediate version as initial and thus
             * does not have an `up` function to migrate from the previous version.
             */
            type: "BUG_INTERMEDIATE_MARKED_INITIAL"

            /**
             * The version that is marked as initial.
             */
            ver: number
          }
    }

export class VersionedEntity<
  LatestVer extends number,
  M extends Record<LatestVer, Version<any, any>> & Record<number, Version<any, any>>
> {
  /**
   * @package
   */

  constructor(
    private versionMap: M,
    private latestVersion: LatestVer,
    private getVersion: (data: unknown) => number | null
  ) {}

  /**
   * Returns whether the given data is a valid entity of any version of the entity.
   * @param data The data to check
   * @returns Whether the given data is a valid entity of any version of the entity.
   */
  public is(data: unknown): data is SchemaOf<M[keyof M]> {
    let ver = this.getVersion(data)

    if (ver === null) return false

    const verDef = this.versionMap[ver]

    if (!verDef) return false

    return verDef.schema.safeParse(data).success
  }

  /**
   * Returns whether the given data is a valid entity of the latest version of the entity.
   * @param data The data to check
   * @returns Whether the given data is a valid entity of the latest version of the entity.
   */
  public isLatest(data: unknown): data is SchemaOf<M[LatestVer]> {
    return this.versionMap[this.latestVersion].schema.safeParse(data).success
  }

  /**
   * Similar to Zod's `safeParse` method, but also migrates the data to the latest version.
   * @param data The data to parse
   * @returns The result from parsing data, if successful, older versions are migrated to the latest version
   */
  public safeParse(data: unknown): ParseResult<SchemaOf<M[LatestVer]>> {
    const ver = this.getVersion(data)

    if (ver === null) {
      return { type: "err", error: { type: "VER_CHECK_FAIL" } }
    }

    const verDef = this.versionMap[ver]

    if (!verDef) {
      return { type: "err", error: { type: "INVALID_VER" } }
    }

    const pass = verDef.schema.safeParse(data)

    if (!pass.success) {
      return {
        type: "err",
        error: {
          type: "GIVEN_VER_VALIDATION_FAIL",
          version: ver,
          versionDef: verDef,
          error: pass.error,
        },
      }
    }

    let finalData = pass.data

    for (let up = ver + 1; up <= this.latestVersion; up++) {
      const upDef = this.versionMap[up]

      if (!upDef) {
        return {
          type: "err",
          error: { type: "BUG_NO_INTERMEDIATE_FOUND", missingVer: up },
        }
      }

      if (upDef.initial) {
        return {
          type: "err",
          error: { type: "BUG_INTERMEDIATE_MARKED_INITIAL", ver: up },
        }
      }

      finalData = upDef.up(finalData)
    }

    return { type: "ok", value: finalData }
  }
}

/**
 * Provides the effective type of the given Verzod Entity.
 * This will resolve to the type of the latest version of the entity.
 */
export type InferredEntity<Entity extends VersionedEntity<any, any>> =
  Entity extends VersionedEntity<infer LatestVer, infer VersionMap>
    ? SchemaOf<VersionMap[LatestVer]>
    : never

/**
 * Provides a union type of all the versions of an entity.
 */
export type AllSchemasOfEntity<Entity extends VersionedEntity<any, any>> =
  Entity extends VersionedEntity<any, infer VersionMap>
    ? SchemaOf<VersionMap[keyof VersionMap]>
    : never

/**
 * Creates a Verzod Versioned entity
 * @param def The definition of the entity
 */
export function createVersionedEntity<
  LatestVer extends number,
  VersionMap extends Record<LatestVer, Version<any, any>> &
    Record<number | LatestVer, Version<any, any>>
>(def: {
  versionMap: VersionMap
  latestVersion: LatestVer
  getVersion: (data: unknown) => number | null
}) {
  return new VersionedEntity(def.versionMap, def.latestVersion, def.getVersion)
}

/**
 * Creates a Zod schema that validates an entity reference. The schema will
 * also provide a transform that will migrate the entity to the latest version on successful validation.
 *
 * @param entity The instance of `VersionedEntity` to reference.
 *
 * NOTE: This assumes the schema has a floating (not dependent) version to the entity.
 */
export function entityReference<Entity extends VersionedEntity<any, any>>(entity: Entity) {
  return z
    .custom((data) => {
      return entity.is(data)
    })
    .transform<InferredEntity<Entity>>((data) => {
      const parseResult = entity.safeParse(data)

      if (parseResult.type !== "ok") {
        // This should never happen unless you have a very weird/bad entity definition.
        throw new Error(
          "Invalid entity definition. `entity.is` returned success, safeParse failed."
        )
      }

      return parseResult.value as InferredEntity<Entity>
    })
}
