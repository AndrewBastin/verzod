import { z } from "zod"
import type { VersionsUpTo } from "./types.ts"

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
       * 
       * Note: This function is not expected to be fallible (throw errors) because
       * the data has already been validated against the previous version's schema
       * before this function is called. The getVersion function helps ensure the
       * correct version is identified and validated before migration.
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
   * Type guard that checks if data is valid for any version up to and including the specified version.
   * 
   * @param data The data to check
   * @param upToVersion The maximum version to check against (inclusive)
   * @returns true if the data is valid for any version from 1 to upToVersion,
   *          false if the data's version is higher than upToVersion or invalid
   * 
   * @example
   * ```ts
   * const entity = createVersionedEntity({ ... })
   * 
   * if (entity.isUpToVersion(data, 2)) {
   *   // data is guaranteed to be v1 or v2 (but not v3 or higher)
   * }
   * 
   * // Returns false for v3 data when checking up to v2
   * entity.isUpToVersion(v3Data, 2) // false
   * ```
   * 
   * Note: This is particularly useful for recursive entity definitions where you want to ensure
   * nested entities are at a specific version or lower.
   */
  public isUpToVersion<Ver extends (keyof M) & number>(
    data: unknown, upToVersion: Ver
  ): data is SchemaOf<M[VersionsUpTo<keyof M, Ver>]> {
    let ver = this.getVersion(data)

    if (ver === null) return false

    // If the version is above the upToVersion given, we consider it not matching and return false
    if (ver > upToVersion) return false

    const verDef = this.versionMap[ver]

    if (!verDef) return false

    return verDef.schema.safeParse(data).success
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

  /**
   * Parses data and migrates it up to a specific version (not beyond).
   * 
   * @param data The data to parse and potentially migrate
   * @param version The target version to migrate to (will not migrate beyond this)
   * @returns A ParseResult containing either the migrated data or an error.
   *          Returns { type: "err", error: { type: "INVALID_VER" } } if data version is higher than requested.
   * 
   * @example
   * ```ts
   * // If you have v1 data and versions up to v4 exist:
   * const result = entity.safeParseUpToVersion(v1Data, 2)
   * // result will contain v2 data (not v3 or v4)
   * 
   * // Trying to parse v3 data up to v2 returns an error
   * const result = entity.safeParseUpToVersion(v3Data, 2)
   * // result: { type: "err", error: { type: "INVALID_VER" } }
   * ```
   * 
   * Note: This is particularly useful for recursive entity definitions to prevent migration
   * functions from receiving future versions they weren't designed to handle.
   */
  public safeParseUpToVersion<
    Ver extends keyof M & number
  >(data: unknown, version: Ver): ParseResult<SchemaOf<M[Ver]>> {
    const ver = this.getVersion(data)

    if (ver === null) {
      return { type: "err", error: { type: "VER_CHECK_FAIL" } }
    }

    // Validate if the version is not greater than the requested version
    if (ver > version) {
      return { type: "err", error: { type: "INVALID_VER" } }
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

    for (let up = ver + 1; up <= version; up++) {
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
 * Infers the TypeScript type of an entity at a specific version.
 * This is useful when you need to work with a specific version of an entity
 * rather than always using the latest version.
 * 
 * @template Entity The VersionedEntity to infer from
 * @template Version The specific version number to infer
 * 
 * @example
 * ```ts
 * const UserEntity = createVersionedEntity({ ... })
 * 
 * // Get the type of User at version 2 specifically
 * type UserV2 = InferredEntityUpToVersion<typeof UserEntity, 2>
 * ```
 */
export type InferredEntityUpToVersion<
  Entity extends VersionedEntity<any, any>,
  Version extends KnownEntityVersion<Entity>
> =
  Entity extends VersionedEntity<any, infer VersionMap>
    ? SchemaOf<VersionMap[Version]>
    : never

/**
 * Provides a union type of all the versions of an entity.
 */
export type AllSchemasOfEntity<Entity extends VersionedEntity<any, any>> =
  Entity extends VersionedEntity<any, infer VersionMap>
    ? SchemaOf<VersionMap[keyof VersionMap]>
    : never

/**
 * Extracts all valid version numbers from a VersionedEntity.
 * This type helper provides a union of all version numbers that exist
 * in the entity's version map.
 * 
 * @template Entity The VersionedEntity to extract versions from
 * 
 * @example
 * ```ts
 * const UserEntity = createVersionedEntity({
 *   latestVersion: 3,
 *   versionMap: { 1: v1Def, 2: v2Def, 3: v3Def }
 * })
 * 
 * type UserVersions = KnownEntityVersion<typeof UserEntity> // 1 | 2 | 3
 * ```
 */
export type KnownEntityVersion<Entity extends VersionedEntity<any, any>> =
  Entity extends VersionedEntity<any, infer VersionMap>
    ? keyof VersionMap
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

/**
 * Creates a Zod schema that validates and parses a versioned entity up to a specific version.
 * Unlike `entityReference()` which always migrates to the latest version,
 * this function ensures entities are migrated only up to the specified version.
 * 
 * @param entity The VersionedEntity to create a reference for
 * @param upToVersion The maximum version to migrate to
 * @returns A Zod schema that validates and migrates up to the specified version
 * 
 * @example
 * ```ts
 * // Validate data is at most version 2
 * const schema = z.object({
 *   user: entityRefUptoVersion(UserEntity, 2),
 *   metadata: z.record(z.string())
 * })
 * ```
 * 
 * Note: This is particularly useful for recursive entity definitions where entities reference
 * themselves, as it prevents migration functions from receiving future versions they weren't
 * designed to handle.
 */
export function entityRefUptoVersion<
  Entity extends VersionedEntity<any, any>,
  Version extends KnownEntityVersion<Entity>,
>(entity: Entity, upToVersion: Version) {
  return z
    .custom((data) => {
      return entity.isUpToVersion(data, upToVersion)
    })
    .transform<InferredEntityUpToVersion<Entity, Version>>((data) => {
      const parseResult = entity.safeParseUpToVersion(data, upToVersion)

      if (parseResult.type !== "ok") {
        // This should never happen unless you have a very weird/bad entity definition.
        throw new Error(
          "Invalid entity definition. `entity.isUpToVersion` returned success, safeParse failed."
        )
      }
      
      return parseResult.value
    })
}
