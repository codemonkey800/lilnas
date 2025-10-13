# Claude Command: Create PR

Create a GitHub pull request from the current branch with intelligent analysis and detailed description.

## Usage

`/create-pr` - Create PR against main branch
`/create-pr --draft` - Create as draft PR

## Process

When creating a pull request:

1. **Verify branch state**:
   - Ensure current branch is not the base branch
   - Verify there are commits to create a PR from
   - Check that the branch is pushed to remote

2. **Analyze commit history**:
   - Get all commits from HEAD to base branch (default: main)
   - Parse commit messages to extract types, scopes, and descriptions
   - Identify patterns in the commits (single feature, multiple fixes, etc.)
   - Detect breaking changes from commit messages

3. **Analyze code changes**:
   - Get diff stats to understand scope of changes
   - Identify affected files and directories
   - Determine which packages in the monorepo are affected
   - Categorize changes (code, config, infrastructure, docs)

4. **Generate PR title**:
   - Use conventional commit format with emoji
   - If all commits share same type/scope: Use that pattern
   - If changes focus on one package: Include that scope
   - Otherwise: Create descriptive title covering main theme
   - Keep title under 72 characters
   - Examples:
     - `⬆️ deps: update node and pnpm versions`
     - `✨ feat(tdr-bot): add AI-powered message analysis`
     - `🐛 fix: resolve authentication issues across services`

5. **Build PR description** with sections:
   - **Summary**: 2-3 concise bullet points of what changed
   - **Affected Packages**: List monorepo packages with changes
   - **Test Plan**: Actionable checklist based on changes
   - **Breaking Changes**: If any detected from commits
   - **Claude Attribution**: Standard footer

6. **Generate test plan intelligently**:
   - TypeScript/JavaScript changes: Include lint, type-check, build, tests
   - Infrastructure changes: Include deployment verification
   - API changes: Include endpoint testing
   - UI changes: Include visual/functional testing
   - Database changes: Include migration testing
   - Package changes: Include dependency resolution testing

7. **Create the PR**:
   - Use `gh pr create --title "..." --body "..."`
   - Include `--base` flag if custom base branch specified
   - Include `--draft` flag if requested
   - Handle any errors from gh CLI

8. **Confirm creation**:
   - Display the PR URL
   - Show PR number and title
   - Provide link to view in browser

## PR Description Format

The generated PR body follows this structure:

```markdown
## Summary

- Concise bullet point describing main change
- Additional context or motivation if needed
- Impact or benefits of the changes

## Affected Packages

- @lilnas/package-name - Description of changes
- @lilnas/another-package - Description of changes

## Test Plan

- [ ] Run `pnpm run lint` and verify no errors
- [ ] Run `pnpm run type-check` and verify no errors
- [ ] Run `pnpm test` for affected packages
- [ ] Test functionality in development environment
- [ ] Verify Docker builds complete successfully
- [ ] Check that services start correctly
- [ ] Verify no breaking changes for dependent packages

## Breaking Changes

⚠️ **Breaking Change**: Description of what breaks and how to migrate

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Best Practices

### PR Title Guidelines

Follow the same commit conventions used in the lilnas monorepo:

**Format**: `<emoji> <type>(<scope>): <subject>`

**Common Types** (see commit.md for full list):

- ✨ `feat`: New feature or functionality
- 🐛 `fix`: Bug fix
- 📝 `docs`: Documentation changes
- ♻️ `refactor`: Code refactoring
- ⚡ `perf`: Performance improvements
- 🧪 `test`: Adding or modifying tests
- 🏗️ `build`: Build system or dependency changes
- 🔧 `chore`: Maintenance tasks
- ⬆️ `deps`: Dependency updates
- 🐳 `docker`: Docker-related changes
- 🔐 `security`: Security improvements

**Scopes** (lilnas packages):

- `apps` - Main Next.js dashboard
- `tdr-bot` - Discord bot with AI
- `download` - Video download service
- `equations` - LaTeX rendering service
- `me-token-tracker` - Crypto tracking bot
- `dashcam` - Dashcam viewer
- `utils` - Shared utilities
- `infra` - Infrastructure/Docker changes
- `*` - Changes affecting multiple packages

### Summary Writing Tips

1. **Be concise but descriptive**: Each bullet should convey meaningful information
2. **Focus on the "why"**: Explain motivation and impact, not just what changed
3. **Use active voice**: "Add feature" not "Feature was added"
4. **Include context**: Help reviewers understand the bigger picture

**Good Examples**:

```markdown
## Summary

- Update Node.js to v22 and pnpm to v9.15 for improved performance and security
- Refresh all package dependencies to their latest compatible versions
- Fix type errors in equations controller and test setup files
```

**Bad Examples**:

```markdown
## Summary

- Updated dependencies
- Fixed stuff
- Changed files
```

### Test Plan Guidelines

Create actionable, specific test items:

**Good Test Items**:

- [ ] Run `pnpm run build` and verify all packages build successfully
- [ ] Test login flow with OAuth provider in development environment
- [ ] Verify LaTeX equation rendering with sample equations
- [ ] Check Discord bot responds correctly to test commands
- [ ] Deploy to staging and verify service health checks pass

**Bad Test Items**:

- [ ] Test it
- [ ] Make sure it works
- [ ] Check everything

### Breaking Changes

Always highlight breaking changes prominently:

```markdown
## Breaking Changes

⚠️ **API Signature Change**: The `createUser` function now requires an email parameter.

**Migration Guide**:

- Before: `createUser(name, age)`
- After: `createUser(name, age, email)`

⚠️ **Environment Variable Renamed**: `API_KEY` is now `OPENAI_API_KEY`

**Action Required**: Update your `.env` files and deployment configurations.
```

## Package Detection

The command automatically detects affected packages by analyzing file paths:

**Detection Rules**:

- Files in `packages/apps/` → `@lilnas/apps`
- Files in `packages/tdr-bot/` → `@lilnas/tdr-bot`
- Files in `packages/download/` → `@lilnas/download`
- Files in `packages/equations/` → `@lilnas/equations`
- Files in `packages/me-token-tracker/` → `@lilnas/me-token-tracker`
- Files in `packages/dashcam/` → `@lilnas/dashcam`
- Files in `packages/utils/` → `@lilnas/utils`
- Files in `infra/` → Infrastructure changes
- Files in root (package.json, etc.) → Monorepo configuration

**Description Generation**:

- Analyze what files changed within each package
- Categorize: new features, bug fixes, refactoring, config changes
- Include meaningful description of impact

## Edge Cases

### No Commits to PR

```bash
$ /create-pr
Error: Current branch has no new commits compared to main.
Create some commits first or switch to a branch with changes.
```

### Already on Base Branch

```bash
$ /create-pr
Error: Cannot create PR from main branch.
Switch to a feature branch first.
```

### Unpushed Branch

```bash
$ /create-pr
Your branch is not pushed to remote. Pushing now...
[proceeds with PR creation]
```

### Draft PR

```bash
$ /create-pr --draft
Creating draft PR against main...
✓ Draft PR created: https://github.com/owner/repo/pull/123
```

## Examples

### Example 1: Dependency Update PR

**Command**: `/create-pr`

**Commits**:

- `54248b1 update node + pnpm`
- `41df6f8 update deps`
- `bfe076a update remaining deps`
- `ced841b move dev deps up`
- `8f7ebd7 update next-env`
- `9b37ebf fix type errors`

**Generated PR**:

**Title**: `⬆️ deps: update node, pnpm and package dependencies`

**Body**:

```markdown
## Summary

- Update Node.js to v22.x and pnpm to v9.15.x for improved performance
- Upgrade all package dependencies to latest compatible versions
- Fix type errors introduced by TypeScript and Next.js updates

## Affected Packages

- @lilnas/apps - Updated Next.js and type definitions
- @lilnas/tdr-bot - Updated dependencies and test setup
- @lilnas/download - Updated Next.js and dependencies
- @lilnas/dashcam - Updated Vite and React dependencies
- @lilnas/equations - Updated NestJS dependencies
- Monorepo - Updated Node.js, pnpm, and shared tooling

## Test Plan

- [ ] Run `pnpm install` and verify dependency resolution
- [ ] Run `pnpm run build` and verify all packages build successfully
- [ ] Run `pnpm run type-check` and verify no type errors
- [ ] Run `pnpm test` for packages with test suites
- [ ] Test each service in development mode
- [ ] Verify Docker builds complete successfully
- [ ] Check CI/CD pipeline passes all checks

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Example 2: New Feature PR

**Command**: `/create-pr`

**Commits**:

- `abc1234 ✨ feat(tdr-bot): add message analysis`
- `def5678 🧪 test(tdr-bot): add analysis tests`
- `ghi9012 📝 docs(tdr-bot): update API docs`

**Generated PR**:

**Title**: `✨ feat(tdr-bot): add AI-powered message analysis`

**Body**:

```markdown
## Summary

- Implement LangChain integration for intelligent message analysis
- Add comprehensive test coverage for analysis features
- Update API documentation with new endpoints

## Affected Packages

- @lilnas/tdr-bot - New message analysis features with LangChain

## Test Plan

- [ ] Run `pnpm test` in tdr-bot package and verify all tests pass
- [ ] Test message analysis with sample Discord messages
- [ ] Verify AI responses are appropriate and helpful
- [ ] Check rate limiting works correctly
- [ ] Monitor OpenAI API usage and costs
- [ ] Test error handling for API failures
- [ ] Deploy to development and test with real Discord server

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

### Example 3: Bug Fix PR

**Command**: `/create-pr`

**Commits**:

- `123abcd 🐛 fix(equations): prevent command injection`
- `456efgh 🔐 security(equations): add input validation`
- `789ijkl 🧪 test(equations): add security tests`

**Generated PR**:

**Title**: `🔐 security(equations): prevent LaTeX command injection`

**Body**:

```markdown
## Summary

- Fix critical security vulnerability allowing LaTeX command injection
- Add comprehensive input validation using Zod schemas
- Implement security tests to prevent regression

## Affected Packages

- @lilnas/equations - Security fixes for LaTeX processing

## Test Plan

- [ ] Run security tests and verify all pass
- [ ] Test with malicious LaTeX inputs (should be rejected)
- [ ] Test with valid LaTeX inputs (should work correctly)
- [ ] Verify Docker sandbox isolation is maintained
- [ ] Check rate limiting still functions
- [ ] Review SECURITY.md documentation is up to date
- [ ] Deploy to staging and run penetration tests

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Tips

- Run `/commit` first to ensure all changes are committed before creating PR
- Review the generated PR title and description before accepting
- The command respects conventional commit formats from your commits
- Draft PRs are useful for work-in-progress that needs early feedback
- Always include a meaningful test plan - reviewers appreciate it
- For large PRs, consider splitting into smaller, focused PRs
- Reference related issues using `Fixes #123` or `Closes #123` syntax
- Breaking changes should always be clearly documented and justified

## Integration with Development Workflow

This command works seamlessly with other lilnas development practices:

1. **Commit workflow**: Use `/commit` to create well-formatted commits
2. **PR creation**: Use `/create-pr` to create detailed pull requests
3. **Code review**: Reviewers get comprehensive context from PR description
4. **Testing**: Test plan provides clear checklist for QA
5. **Documentation**: Changes are well-documented for future reference

## Related Commands

- `/commit` - Create well-formatted commits with pre-commit checks
- See [CLAUDE.md](../../CLAUDE.md) for full development workflow
- See [commit.md](./commit.md) for commit convention details
