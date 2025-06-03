// Utility types for various (type checked) shenanigans

/**
 * Creates a tuple of length N by recursively building an array.
 * This is used internally to compare numbers at the type level.
 * 
 * @template N - The target length of the tuple (must be a number literal)
 * @template Counter - Internal accumulator array (should not be provided)
 * @returns A tuple type with exactly N elements
 * 
 * @example
 * ```ts
 * type Three = CreateTuple<3>  // [unknown, unknown, unknown]
 * type Zero = CreateTuple<0>   // []
 * ```
 */
type CreateTuple<N extends number, Counter extends unknown[] = []> = 
  Counter['length'] extends N ? Counter : CreateTuple<N, [...Counter, unknown]>

/**
 * Compares two numbers at the type level to determine if A ≤ B.
 * Uses tuple length comparison as TypeScript cannot directly compare number literals.
 * 
 * @template A - The first number to compare
 * @template B - The second number to compare
 * @returns `true` if A ≤ B, `false` otherwise
 * 
 * @example
 * ```ts
 * type Test1 = IsLessOrEqual<3, 5>  // true
 * type Test2 = IsLessOrEqual<5, 3>  // false
 * type Test3 = IsLessOrEqual<4, 4>  // true
 * ```
 */
type IsLessOrEqual<A extends number, B extends number> = 
  CreateTuple<B> extends [...CreateTuple<A>, ...unknown[]] 
    ? true 
    : false

/**
 * Filters a union of numbers to only include values less than or equal to N.
 * 
 * @template T - A union type of numbers to filter
 * @template N - The maximum value (inclusive) to include in the result
 * @returns A union containing only the numbers from T that are ≤ N
 * 
 * @example
 * ```ts
 * type Numbers = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
 * type UpTo4 = VersionsUpTo<Numbers, 4>  // 1 | 2 | 3 | 4
 * type UpTo2 = VersionsUpTo<Numbers, 2>  // 1 | 2
 * type UpTo0 = VersionsUpTo<Numbers, 0>  // never
 * ```
 */
export type VersionsUpTo<T, N extends number> = T extends number
  ? IsLessOrEqual<T, N> extends true
    ? T
    : never
  : never
