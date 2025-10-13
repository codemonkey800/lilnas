# Claude Command: Commit

Create a git commit from the current changes in the lilnas monorepo.

## Usage

`/commit` - Create a commit with pre-commit checks
`/commit --no-verify` - Create a commit without running pre-commit checks

## Process

When creating a commit:

1. **Analyze staged files** (smart detection):

   - Identify which files were modified
   - Determine file types (code vs. configuration)
   - Identify affected packages
   - Decide which checks are needed

2. **Run pre-commit checks** (unless --no-verify is specified):

   - Only run checks for files that need them:
     - **TypeScript/JavaScript files**: lint, type-check, test, build
     - **Infrastructure files** (k8s/, *.yaml, *.yml): No checks
     - **Documentation** (*.md): No checks
     - **Shell scripts** (*.sh): No checks
     - **Config files**: Minimal or no checks
   - Only test packages that have changes

3. **Prepare the commit**:

   - If no files are staged, automatically stage all changes
   - Analyze the code changes to understand what was modified
   - Determine the appropriate commit type and scope

4. **Create the commit message**:
   - Follow conventional commit format with appropriate emoji
   - Include scope when changes are package-specific
   - Add Claude attribution as specified in CLAUDE.md

## Best Practices

### Commit Format

```
<emoji> <type>(<scope>): <subject>

<body>
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
- `k8s` - Kubernetes manifests and configuration
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

Pre-commit checks are run intelligently based on the files being committed:

### Smart Detection

1. **File Analysis**:
   - Detects which files are staged for commit
   - Identifies file types and locations
   - Determines which checks are necessary
   - Skips checks for non-code files

2. **Check Requirements by File Type**:

   | File Type | Lint | Type Check | Test | Build |
   |-----------|------|------------|------|-------|
   | TypeScript/JavaScript | ✅ | ✅ | ✅* | ✅ |
   | YAML/YML files | ❌ | ❌ | ❌ | ❌ |
   | Markdown (*.md) | ❌ | ❌ | ❌ | ❌ |
   | Shell scripts (*.sh) | ❌ | ❌ | ❌ | ❌ |
   | Kubernetes (k8s/) | ❌ | ❌ | ❌ | ❌ |
   | Docker files | ❌ | ❌ | ❌ | ❌ |
   | JSON (non-package.json) | ❌ | ❌ | ❌ | ❌ |
   | package.json | ❌ | ❌ | ❌ | ✅ |
   
   *Tests only run for packages with changes

3. **Package-Specific Testing**:
   - Tests only run for packages that have modified files
   - Example: Changes to `k8s/` won't trigger any tests
   - Example: Changes to `packages/tdr-bot/` only run tdr-bot tests
   - Currently testable packages: tdr-bot, utils

### Examples

**Infrastructure commit (k8s files only)**:
```bash
# No checks run - direct commit
git add k8s/
/commit  # Creates commit immediately
```

**Single package TypeScript changes**:
```bash
# Only runs checks for the tdr-bot package
git add packages/tdr-bot/src/
/commit  # Runs: lint (tdr-bot), type-check (tdr-bot), test (tdr-bot), build
```

**Mixed commit (k8s + TypeScript)**:
```bash
git add k8s/ packages/apps/
/commit  # Only checks TypeScript files in apps package
```

### Manual Check Commands

If you want to run checks manually:

1. **Lint** (`pnpm run lint:fix`): Fix ESLint issues
2. **Type Check** (`pnpm run type-check`): Validate TypeScript
3. **Tests** (`pnpm test`): Run all tests
4. **Build** (`pnpm run build`): Build all packages

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

- Pre-commit checks are smart - k8s/infra files skip all checks automatically
- Run `pnpm run lint:fix` before committing to auto-fix issues
- Use `pnpm test:watch` during development for instant feedback
- Check `turbo.json` for build dependencies
- Review CLAUDE.md for project-specific guidelines
- Keep commits focused and atomic for easier review
- Use `--no-verify` flag to skip all checks when needed
