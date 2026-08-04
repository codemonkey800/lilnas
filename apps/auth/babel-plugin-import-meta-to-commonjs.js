// U3: a small, self-contained babel plugin rewriting `import.meta.url` to a
// CommonJS-equivalent expression. @babel/preset-env's own module transform
// (used by jest.config.js to downcompile the Better Auth package family's
// pure-ESM .mjs files) only handles import/export DECLARATIONS — it does
// NOT rewrite `import.meta` (a distinct, ESM-runtime-only construct with no
// direct CJS syntax equivalent). `@thallesp/nestjs-better-auth`'s
// dist/index.mjs uses `createRequire(import.meta.url)`, which throws
// `SyntaxError: Cannot use 'import.meta' outside a module` once
// preset-env's import/export transform has otherwise made the file loadable
// under Jest's CJS-based require().
//
// Copied verbatim from apps/tdr-code/babel-plugin-import-meta-to-commonjs.js
// (also referenced by path string, not inline, in jest.config.js's
// transform config — that file's own header comment documents why: babel-
// jest's cache-key computation needs the transform config to be
// serializable, and a live function reference intermittently fails once
// Jest needs to validate a cache key against an already-cached transform
// result). This file is entirely generic — no tdr-code-specific logic — so
// it is duplicated rather than shared, matching how each app in this
// monorepo owns its own jest.config.js and transform pipeline.
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
