/**
 * @fileoverview Advanced TypeScript patterns including conditional types, mapped types, and utility types
 *
 * This module provides sophisticated type patterns for complex scenarios,
 * including conditional types, mapped types, template literal types, and more.
 */

import { MediaItem, MovieItem } from 'src/media/interfaces/media.types'
import { ErrorCategory } from 'src/utils/error-classifier'

import { MediaType } from './enums'

// ============================================================================
// Conditional Types
// ============================================================================

/**
 * Conditional type to extract function return type safely
 */
export type SafeReturnType<T> = T extends (...args: unknown[]) => infer R
  ? R
  : never

/**
 * Conditional type to extract Promise resolved type
 */
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T

/**
 * Conditional type to extract array element type
 */
export type ArrayElement<T> = T extends (infer U)[] ? U : never

/**
 * Conditional type to check if a type is an array
 */
export type IsArray<T> = T extends unknown[] ? true : false

/**
 * Conditional type to check if a type is a function
 */
export type IsFunction<T> = T extends (...args: unknown[]) => unknown
  ? true
  : false

/**
 * Conditional type to check if a type is a Promise
 */
export type IsPromise<T> = T extends Promise<unknown> ? true : false

/**
 * Deep conditional type to make all properties optional recursively
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/**
 * Deep conditional type to make all properties required recursively
 */
export type DeepRequired<T> = {
  [P in keyof T]-?: T[P] extends object ? DeepRequired<T[P]> : T[P]
}

/**
 * Conditional type to extract keys that have specific value types
 */
export type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never
}[keyof T]

/**
 * Conditional type to create a type with only properties of specific type
 */
export type PropertiesOfType<T, U> = Pick<T, KeysOfType<T, U>>

/**
 * Conditional type for nullable properties
 */
export type Nullable<T> = T | null | undefined

/**
 * Conditional type to exclude nullable values
 */
export type NonNullable<T> = T extends null | undefined ? never : T

// ============================================================================
// Mapped Types
// ============================================================================

/**
 * Mapped type to make specific properties optional
 */
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/**
 * Mapped type to make specific properties required
 */
export type Required<T, K extends keyof T> = T & { [P in K]-?: T[P] }

/**
 * Mapped type to make all properties mutable (remove readonly)
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

/**
 * Mapped type to make all properties immutable (add readonly)
 */
export type Immutable<T> = {
  readonly [P in keyof T]: T[P]
}

/**
 * Mapped type to create a proxy object with getters
 */
export type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

/**
 * Mapped type to create a proxy object with setters
 */
export type Setters<T> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void
}

/**
 * Mapped type to prefix all property names
 */
export type Prefixed<T, P extends string> = {
  [K in keyof T as `${P}${Capitalize<string & K>}`]: T[K]
}

/**
 * Mapped type to suffix all property names
 */
export type Suffixed<T, S extends string> = {
  [K in keyof T as `${string & K}${Capitalize<S>}`]: T[K]
}

/**
 * Mapped type to make properties nullable
 */
export type NullableProperties<T> = {
  [P in keyof T]: T[P] | null
}

/**
 * Mapped type to create event handlers from properties
 */
export type EventHandlers<T> = {
  [K in keyof T as `on${Capitalize<string & K>}Change`]: (value: T[K]) => void
}

// ============================================================================
// Template Literal Types
// ============================================================================

/**
 * Template literal type for HTTP methods
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

/**
 * Template literal type for API endpoints
 */
export type ApiEndpoint<T extends string> = `/${T}`

/**
 * Template literal type for versioned API endpoints
 */
export type VersionedEndpoint<
  V extends string,
  E extends string,
> = `/api/v${V}/${E}`

/**
 * Template literal type for media API routes
 */
export type MediaApiRoute =
  | 'search'
  | 'add'
  | 'status'
  | 'queue'
  | 'system'
  | 'rootfolders'
  | 'qualityprofiles'
  | 'tags'

/**
 * Template literal type for environment variables
 */
export type EnvVar<T extends string> = `${Uppercase<T>}_${string}`

/**
 * Template literal type for log levels with context
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type ContextualLog<Context extends string> = `[${Context}] ${LogLevel}`

// ============================================================================
// Advanced Utility Types
// ============================================================================

/**
 * Utility type for function composition
 */
export type Compose<F, G> = F extends (arg: infer A) => infer B
  ? G extends (arg: B) => infer C
    ? (arg: A) => C
    : never
  : never

/**
 * Utility type for curried functions
 */
export type Curry<T> = T extends (...args: infer Args) => infer Return
  ? Args extends [infer First, ...infer Rest]
    ? (arg: First) => Curry<(...args: Rest) => Return>
    : Return
  : never

/**
 * Utility type to create a union of all possible paths in an object
 */
export type Paths<T> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends object
          ? `${K}` | `${K}.${Paths<T[K]>}`
          : `${K}`
        : never
    }[keyof T]
  : never

/**
 * Utility type to get the type of a nested property by path
 */
export type PathValue<
  T,
  P extends Paths<T>,
> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? Rest extends Paths<T[K]>
      ? PathValue<T[K], Rest>
      : never
    : never
  : P extends keyof T
    ? T[P]
    : never

/**
 * Utility type for branded primitives with validation
 */
export type ValidatedBrand<T, Brand extends string, Validator> = T & {
  readonly __brand: Brand
} & { readonly __validator: Validator }

/**
 * Utility type to extract all possible discriminant values
 */
export type DiscriminantValues<T, K extends keyof T> = T extends unknown
  ? T[K]
  : never

/**
 * Utility type to filter union members by discriminant
 */
export type FilterByDiscriminant<T, K extends keyof T, V> = T extends unknown
  ? T[K] extends V
    ? T
    : never
  : never

/**
 * Utility type for result types with error handling
 */
export type Result<T, E = Error> =
  | { success: true; data: T; error?: never }
  | { success: false; data?: never; error: E }

/**
 * Utility type for async result types
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>

/**
 * Utility type for option types (Maybe monad)
 */
export type Option<T> = { type: 'some'; value: T } | { type: 'none' }

// ============================================================================
// Media-Specific Advanced Types
// ============================================================================

/**
 * Advanced conditional type for media item processing
 */
export type MediaItemProcessor<T extends MediaItem> = {
  validate: (item: T) => Result<T, string>
  transform: <U>(item: T, transformer: (item: T) => U) => U
  extract: <K extends keyof T>(item: T, key: K) => T[K]
}

/**
 * Advanced mapped type for media API responses
 */
export type MediaApiResponses = {
  [K in MediaApiRoute as `${K}Response`]: {
    success: boolean
    data: K extends 'search' ? MediaItem[] : unknown
    error?: string
    timestamp: Date
  }
}

/**
 * Conditional type for error handling by category
 */
export type ErrorHandlerForCategory<C extends ErrorCategory> =
  C extends ErrorCategory.MEDIA_API
    ? (error: Error, mediaType: MediaType) => void
    : C extends ErrorCategory.DISCORD_API
      ? (error: Error, guildId?: string) => void
      : (error: Error) => void

/**
 * Advanced mapped type for service configurations
 */
export type ServiceConfigurations<T extends Record<string, unknown>> = {
  [K in keyof T as `${string & K}Config`]: {
    enabled: boolean
    options: T[K]
    validation: (config: T[K]) => boolean
    defaults: Partial<T[K]>
  }
}

/**
 * Conditional type for API client methods based on service type
 */
export type ApiClientMethods<S extends string> = S extends 'sonarr' | 'radarr'
  ? {
      search: (query: string) => Promise<MediaItem[]>
      add: (item: MediaItem) => Promise<boolean>
      getStatus: (id: string | number) => Promise<MediaItem>
      getQueue: () => Promise<unknown[]>
    }
  : S extends 'emby'
    ? {
        search: (query: string) => Promise<unknown[]>
        getLibrary: () => Promise<unknown[]>
        getItem: (id: string) => Promise<unknown>
      }
    : never

// ============================================================================
// Type-level Computations
// ============================================================================

/**
 * Type-level addition for small numbers
 */
export type Add<A extends number, B extends number> = [
  never,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
][A extends keyof [never, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  ? B extends keyof [never, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    ? A extends 0
      ? B
      : B extends 0
        ? A
        : [A, B] extends [1, 1]
          ? 2
          : [A, B] extends [1, 2] | [2, 1]
            ? 3
            : [A, B] extends [1, 3] | [3, 1] | [2, 2]
              ? 4
              : [A, B] extends [1, 4] | [4, 1] | [2, 3] | [3, 2]
                ? 5
                : never
    : never
  : never]

/**
 * Type-level string length calculation
 */
export type Length<S extends string> = S extends `${string}${infer Rest}`
  ? Add<1, Length<Rest> extends number ? Length<Rest> : 0>
  : 0

/**
 * Type-level tuple to union conversion
 */
export type TupleToUnion<T extends readonly unknown[]> = T[number]

/**
 * Type-level union to intersection conversion
 */
export type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never

/**
 * Type-level function overload resolution
 */
export type OverloadResolver<T> = T extends {
  (...args: infer A1): infer R1
  (...args: infer A2): infer R2
  (...args: infer A3): infer R3
}
  ? ((...args: A1) => R1) | ((...args: A2) => R2) | ((...args: A3) => R3)
  : T extends {
        (...args: infer A1): infer R1
        (...args: infer A2): infer R2
      }
    ? ((...args: A1) => R1) | ((...args: A2) => R2)
    : T

// ============================================================================
// Higher-Kinded Type Simulation
// ============================================================================

/**
 * Higher-kinded type interface for containers
 */
export interface HKT {
  readonly _URI: unknown
  readonly _A: unknown
}

/**
 * Type-level function application for HKTs
 */
export type Kind<F extends HKT, A> = F extends { readonly _A: unknown }
  ? (F & { readonly _A: A })['_URI']
  : never

/**
 * Functor type class simulation
 */
export interface Functor<F extends HKT> {
  readonly map: <A, B>(fa: Kind<F, A>, f: (a: A) => B) => Kind<F, B>
}

/**
 * Option HKT instance
 */
export interface OptionHKT extends HKT {
  readonly _URI: Option<this['_A']>
}

/**
 * Array HKT instance
 */
export interface ArrayHKT extends HKT {
  readonly _URI: Array<this['_A']>
}

/**
 * Promise HKT instance
 */
export interface PromiseHKT extends HKT {
  readonly _URI: Promise<this['_A']>
}

// ============================================================================
// Type Assertions and Validation
// ============================================================================

/**
 * Compile-time assertion type
 */
export type Assert<T extends true> = T

/**
 * Type equality check
 */
export type Equals<T, U> = T extends U ? (U extends T ? true : false) : false

/**
 * Type compatibility check
 */
export type Compatible<T, U> = T extends U ? true : false

/**
 * Type intersection check
 */
export type HasIntersection<T, U> = T & U extends never ? false : true

/**
 * Exhaustiveness check for discriminated unions
 */
export type ExhaustiveCheck<T, U extends T> = U

/**
 * Compile-time tests for type correctness
 */
export type TypeTests = {
  // Test basic conditional types
  basicConditional: Assert<Equals<SafeReturnType<() => number>, number>>

  // Test mapped types
  mappedOptional: Assert<
    Compatible<
      Optional<{ a: string; b: number }, 'a'>,
      { a?: string; b: number }
    >
  >

  // Test template literals
  templateEndpoint: Assert<Equals<ApiEndpoint<'users'>, '/users'>>

  // Test advanced utilities
  resultSuccess: Assert<
    Compatible<
      Extract<Result<string, Error>, { success: true }>,
      { success: true; data: string }
    >
  >

  // Test media-specific types
  mediaProcessor: Assert<
    Compatible<
      MediaItemProcessor<MovieItem>['validate'],
      (item: MovieItem) => Result<MovieItem, string>
    >
  >
}
