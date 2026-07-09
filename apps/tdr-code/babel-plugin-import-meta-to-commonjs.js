// Phase D (U2): a small, self-contained babel plugin rewriting `import.meta
// .url` to a CommonJS-equivalent expression. @babel/preset-env's own module
// transform (used by jest.config.js to downcompile the Better Auth package
// family's pure-ESM .mjs files) only handles import/export DECLARATIONS —
// it does NOT rewrite `import.meta` (a distinct, ESM-runtime-only construct
// with no direct CJS syntax equivalent) — confirmed empirically: preset-env
// alone left `import.meta.url` untouched, causing
// `@thallesp/nestjs-better-auth`'s dist/index.mjs (which uses
// `createRequire(import.meta.url)`) to throw `SyntaxError: Cannot use
// 'import.meta' outside a module` even after the import/export transform
// worked.
//
// This lives in its OWN file (referenced by path string in jest.config.js's
// transform config), not as an inline function value, because babel-jest's
// cache-key computation needs the transform config to be serializable — a
// live function reference in a `plugins` array works when Jest's cache is
// freshly cleared (no existing entry to validate a cache key against) but
// throws `.plugins[0] must be a string, object, function` intermittently
// once Jest needs to compute a cache key to check against an ALREADY
// cached transform result (confirmed reproducible: passed running this
// spec file in isolation right after a cache clear, failed running the
// full suite immediately after). Referencing a plugin by file path (a
// string) is the standard, serialization-safe way babel/babel-jest expect
// custom plugins to be wired into a transform config.
//
// Uses @babel/core's own bundled AST builders (no new dependency beyond
// what jest.config.js's transform already requires). Verified this
// produces genuinely executable output at runtime (not just syntactically
// valid), matching import.meta.url's real semantics.
module.exports = function importMetaUrlToCommonJs({ types: t }) {
  return {
    visitor: {
      MemberExpression(path) {
        const { object, property } = path.node
        if (
          t.isMetaProperty(object) &&
          object.meta.name === 'import' &&
          object.property.name === 'meta' &&
          t.isIdentifier(property) &&
          property.name === 'url'
        ) {
          // import.meta.url -> require('url').pathToFileURL(__filename).href
          path.replaceWith(
            t.memberExpression(
              t.callExpression(
                t.memberExpression(
                  t.callExpression(t.identifier('require'), [
                    t.stringLiteral('url'),
                  ]),
                  t.identifier('pathToFileURL'),
                ),
                [t.identifier('__filename')],
              ),
              t.identifier('href'),
            ),
          )
        }
      },
    },
  }
}
