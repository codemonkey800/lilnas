# Claude Command: Commit

Create a git commit from the current changes in the lilnas monorepo.

## Usage

`/commit` - Create a commit with pre-commit checks
`/commit --no-verify` - Create a commit without running pre-commit checks

## Process

When creating a commit:

1. **Run pre-commit checks** (unless --no-verify is specified):

   - `pnpm run lint:fix` - Fix any auto-fixable linting issues
   - `pnpm run type-check` - Ensure TypeScript types are correct
   - `pnpm test` - Run tests for packages that have test suites (cli, tdr-bot)
   - `pnpm run build` - Build all packages using Turbo

2. **Prepare the commit**:

   - If no files are staged, automatically stage all changes
   - Analyze the code changes to understand what was modified
   - Determine the appropriate commit type and scope

3. **Create the commit message**:
   - Follow conventional commit format with appropriate emoji
   - Include scope when changes are package-specific
   - Add Claude attribution as specified in CLAUDE.md

## Best Practices

### Commit Format

```
<emoji> <type>(<scope>): <subject>

<body>

🤖 Generated with Claude Code
Co-Authored-By: Claude <noreply@anthropic.com>
```

### Commit Types & Emojis

- ✨ `feat`: New feature or functionality
- 🐛 `fix`: Bug fix
- 📝 `docs`: Documentation changes (including CLAUDE.md updates)
- 🎨 `style`: Code style/formatting (prettier, eslint fixes)
- ♻️ `refactor`: Code refactoring without changing functionality
- ⚡ `perf`: Performance improvements
- 🧪 `test`: Adding or modifying tests
- 🏗️ `build`: Build system or dependency changes
- 🔧 `chore`: Maintenance tasks (config files, CI/CD)
- ⬆️ `deps`: Dependency updates
- 🚀 `deploy`: Deployment configuration changes
- 🐳 `docker`: Docker-related changes
- 🔐 `security`: Security improvements or fixes
- 🏷️ `types`: TypeScript type definitions
- 🌐 `i18n`: Internationalization
- ♿ `a11y`: Accessibility improvements
- 🚸 `ux`: User experience improvements
- 💄 `ui`: UI/styling updates
- 🗃️ `db`: Database changes
- 🔊 `logs`: Logging additions/changes
- 🔇 `logs-remove`: Removing logs
- 👷 `ci`: CI/CD changes
- 🔨 `scripts`: Script changes
- 🌱 `seed`: Seed data
- 🚩 `flags`: Feature flags
- 🏁 `release`: Release commits
- 🚑 `hotfix`: Critical hotfixes
- 💚 `fix-ci`: Fix CI build
- 🎉 `init`: Initial commit
- ✏️ `typo`: Fix typos
- 🔥 `remove`: Remove code/files
- 🚚 `move`: Move/rename files
- 📦 `package`: Package.json changes
- 👽 `external-api`: External API updates
- 📄 `license`: License changes
- 💡 `comments`: Source code comments
- 🍻 `drunk`: Code written while drunk (use sparingly!)
- 💩 `bad-code`: Code that needs improvement
- ⏪ `revert`: Revert previous changes
- 🔀 `merge`: Merge branches
- 📱 `responsive`: Responsive design
- 🍎 `apple`: Apple-specific (macOS, iOS)
- 🐧 `linux`: Linux-specific
- 🏁 `windows`: Windows-specific
- 🤖 `android`: Android-specific
- 🍏 `ios`: iOS-specific
- 🔖 `version`: Version tags
- ⚗️ `experiment`: Experimental changes
- 🔍 `seo`: SEO improvements
- ☸️ `kubernetes`: Kubernetes changes
- 🌈 `easter-egg`: Add easter egg

### Scope Examples (lilnas packages)

Common scopes in the lilnas monorepo:

- `cli` - CLI tool changes
- `apps` - Main Next.js dashboard
- `tdr-bot` - Discord bot with AI
- `download` - Video download service
- `equations` - LaTeX rendering service
- `me-token-tracker` - Crypto tracking bot
- `dashcam` - Dashcam viewer
- `utils` - Shared utilities
- `eslint` - ESLint configuration
- `prettier` - Prettier configuration
- `infra` - Infrastructure/Docker changes
- `*` - Changes affecting multiple packages

### Commit Message Guidelines

1. **Subject line**:

   - Use present tense, imperative mood ("add feature" not "added feature")
   - Keep under 72 characters
   - Don't end with a period
   - Be specific and meaningful

2. **Body** (when needed):

   - Explain the "why" behind the change
   - Reference issues or PRs if applicable
   - Include breaking changes with "BREAKING CHANGE:" prefix

3. **Examples**:

   ```
   ✨ feat(tdr-bot): add AI-powered message analysis

   Implement LangChain integration for advanced message processing
   using OpenAI GPT models. Includes rate limiting and error handling.

   🤖 Generated with Claude Code
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```

   ```
   🐛 fix(equations): prevent LaTeX command injection

   Add comprehensive input validation using Zod schemas to block
   dangerous LaTeX commands. Implements secure command execution
   with Docker sandbox isolation.

   🤖 Generated with Claude Code
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```

## Commit Splitting

Consider splitting commits when:

1. **Different concerns**: Changes address unrelated issues
2. **Different types**: Mix of features, fixes, and refactoring
3. **Different scopes**: Changes span multiple packages
4. **Large changes**: Commit would be too large to review effectively
5. **Logical grouping**: Changes can be grouped into coherent units

### Splitting Strategy

1. Group related changes together
2. Ensure each commit can stand alone (doesn't break the build)
3. Order commits logically (dependencies first)
4. Each commit should have a clear, single purpose

### Example Split

Instead of one large commit:

```
✨ feat: add authentication and update UI and fix tests
```

Split into:

```
🏗️ build(deps): add authentication dependencies
✨ feat(apps): implement OAuth authentication flow
💄 ui(apps): update login page design
🧪 test(apps): add authentication integration tests
```

## Pre-commit Checks

The following checks run automatically (unless --no-verify):

1. **Lint** (`pnpm run lint:fix`):

   - Automatically fixes ESLint issues
   - Ensures code follows project standards
   - Checks all packages in the monorepo

2. **Type Check** (`pnpm run type-check`):

   - Validates TypeScript types
   - Catches type errors before commit
   - Uses Turbo for efficient checking

3. **Tests** (`pnpm test`):

   - Runs Jest tests for packages with test suites
   - Currently active for: cli, tdr-bot
   - Ensures changes don't break existing functionality

4. **Build** (`pnpm run build`):
   - Builds all packages in dependency order
   - Uses Turbo cache for speed
   - Validates that everything compiles correctly

## Special Considerations

### Monorepo Structure

- Changes often affect multiple packages
- Use appropriate scope or `*` for cross-package changes
- Consider how changes impact dependent packages

### Docker & Infrastructure

- Infrastructure changes should be clearly marked
- Consider impact on development vs production environments
- Update relevant docker-compose files together

### Security-Sensitive Changes

- LaTeX equations service has strict security requirements
- Always validate input and sanitize output
- Document security implications in commit messages

### AI/LLM Integration

- Changes to tdr-bot AI features should be well-tested
- Consider rate limiting and API costs
- Document any new AI capabilities or tools

## Error Handling

If pre-commit checks fail:

1. The specific failing check will be identified
2. You'll see the error output
3. Fix the issues and try again
4. Use --no-verify only when absolutely necessary

## Tips

- Run `pnpm run lint:fix` before committing to auto-fix issues
- Use `pnpm test:watch` during development for instant feedback
- Check `turbo.json` for build dependencies
- Review CLAUDE.md for project-specific guidelines
- Keep commits focused and atomic for easier review
