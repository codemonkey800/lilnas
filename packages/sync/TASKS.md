# Sync -- Engineering Task Breakdown

> Derived from [PRD.md](./PRD.md). Tasks are organized by implementation phase.
> Each phase must be completed in order (except Phase 7, which is independent).

## Legend

| Symbol | Meaning                                     |
| ------ | ------------------------------------------- |
| `[x]`  | Done                                        |
| `[~]`  | Partial -- some work exists but gaps remain |
| `[ ]`  | To do                                       |

---

## Pre-requisites (Already Complete)

These features are shipped and require no further work unless noted.

### Core Features

- [x] **Email/password registration** -- `src/app/(auth)/register/` (page, form, server action)
- [x] **Email/password login** -- `src/app/(auth)/login/` (page, form, server action)
- [x] **Onboarding wizard (3 steps)** -- `src/app/onboarding/` (About You, Love & Connection, Goals)
- [x] **Auth middleware** -- `src/middleware.ts`, `src/auth.ts`, `src/auth.config.ts`
- [x] **User & profile schema** -- `src/db/schema.ts` (`users`, `accounts`, `sessions`, `verificationTokens`, `profiles`)

### Infrastructure & Scaffolding

- [x] **Project scaffolding** -- `package.json`, `next.config.ts` (standalone output), `tsconfig.json`, `eslint.config.cjs`, `postcss.config.cjs`
- [x] **Database connection setup** -- `src/db/index.ts` (Drizzle + PostgreSQL pool)
- [x] **Drizzle configuration** -- `drizzle.config.ts`
- [x] **Password utilities** -- `src/lib/password.ts` (bcryptjs, 12 salt rounds)
- [x] **NextAuth API route** -- `src/app/api/auth/[...nextauth]/route.ts`
- [x] **Root layout with SessionProvider** -- `src/app/layout.tsx`
- [x] **Health check endpoint** -- `src/app/api/health/route.ts`
- [x] **Design system** -- `src/tailwind.css` (dark purple theme, custom color tokens, background layers, semantic colors, shadows, animations)
- [x] **Design system documentation** -- `DESIGN_SYSTEM.md`
- [x] **SyncIcon component** -- `src/components/sync-icon.tsx` (app logo SVG)
- [x] **Docker/deployment configuration** -- `Dockerfile` (multi-stage build), `deploy.yml`, `deploy.dev.yml`, `.dockerignore`

---

## Phase 1: Partner Connection

> Partners must be linked before any check-in features are useful.
> PRD reference: Section 3 -- Phase 1

### Schema

- [x] **P1-S1**: `partnerships` table with `id`, `inviterId`, `inviteeId`, `status`, `createdAt`, `updatedAt`
  - File: `src/db/schema.ts`
  - Note: Already implemented. Uses `pgEnum` with `pending | accepted | declined | cancelled | dissolved`.

- [x] **P1-S2**: Unique index on active partnership pairs
  - File: `src/db/schema.ts`
  - Note: Implemented as `unique_active_pair` using `LEAST/GREATEST` with status filter.

### Server Actions

- [x] **P1-A1**: `getPartnershipStatus()` -- Query active partnership, incoming invites, outgoing invite
  - File: `src/app/(app)/partner/actions.ts`

- [x] **P1-A2**: `sendPartnerInvite(email)` -- Validates and creates a partnership invite
  - File: `src/app/(app)/partner/actions.ts`
  - Validations: no self-invite, no existing active partnership, no existing pending outgoing invite, target must have account, target must not have active partnership.

- [x] **P1-A3**: `acceptInvite(partnershipId)` -- Accepts a pending invite
  - File: `src/app/(app)/partner/actions.ts`
  - Uses transaction. Checks invite exists, belongs to user, is pending, user has no active partnership.

- [x] **P1-A4**: `declineInvite(partnershipId)` -- Declines a pending invite
  - File: `src/app/(app)/partner/actions.ts`

- [x] **P1-A5**: `cancelInvite(partnershipId)` -- Cancels an outgoing pending invite
  - File: `src/app/(app)/partner/actions.ts`

- [x] **P1-A6**: `dissolvePartnership(partnershipId)` -- Dissolves an active partnership
  - File: `src/app/(app)/partner/actions.ts`
  - Uses transaction. Verifies caller is a member of the partnership, partnership is currently `accepted`. Sets status to `dissolved`.
  - Side effects: `revalidatePath('/')`, `revalidatePath('/partner')`.

### UI Components

- [x] **P1-U1**: `InviteFormView` -- Email input + submit button (shown when no partnership or pending outgoing invite)
  - File: `src/app/(app)/partner/partner-connection.tsx`

- [x] **P1-U2**: `PendingOutgoingView` -- Shows "Invite sent to [email]" with cancel button and polling
  - File: `src/app/(app)/partner/partner-connection.tsx`

- [x] **P1-U3**: `IncomingInviteView` -- Shows inviter info with accept/decline buttons
  - File: `src/app/(app)/partner/partner-connection.tsx`

- [x] **P1-U4**: `PartnerCard` -- Shows partner's display name, pronouns, email, avatar initial, and "Unlink" button
  - File: `src/app/(app)/partner/partner-card.tsx`
  - Dashboard (`src/app/(app)/page.tsx`) fetches partner info via table-alias joins and renders `PartnerCard`.
  - Note: `src/app/(app)/partner/queries.ts` also added with a `getPartnerInfo` helper (currently unused -- page uses inline joins).

- [x] **P1-U5**: `UnlinkConfirmDialog` -- Modal confirming partnership dissolution
  - File: `src/app/(app)/partner/partner-card.tsx` (colocated with `PartnerCard`)
  - Uses native `<dialog>` with `showModal()` for focus trap and scroll lock. Backdrop click to dismiss. Loading/error states.
  - Message: "Your check-in history will be preserved, but you won't be able to create new check-ins together."
  - CSS: `dialog::backdrop` style added to `src/tailwind.css`.

### Pages

- [x] **P1-P1**: `/partner` page -- Server component (auth/onboarding guards now handled by `(app)` layout)
  - File: `src/app/(app)/partner/page.tsx`

### Remaining Phase 1 Work

All Phase 1 tasks are complete.

---

## Phase 2: Check-in Templates

> Templates define the structure of a check-in: a name, description, and ordered list of questions.
> PRD reference: Section 3 -- Phase 2
> Depends on: Phase 1

### Schema

- [x] **P2-S1**: `checkInTemplates` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `partnershipId` (text FK nullable -- null for system templates), `createdById` (text FK nullable), `name` (text NOT NULL), `description` (text nullable), `isSystem` (boolean default false), `createdAt` (timestamp), `updatedAt` (timestamp).

- [x] **P2-S2**: `templateQuestions` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `templateId` (text FK to `checkInTemplates`, cascade delete), `questionText` (text NOT NULL), `isRequired` (boolean default true), `orderIndex` (integer NOT NULL), `createdAt` (timestamp).
  - Note: `questionType` and `options` columns omitted for now -- all questions are free text. Will add when scale/multiple choice support is needed.

### Seed Data

- [x] **P2-SEED**: Seed 3 system default templates
  - File: `src/db/seed.ts`
  - Script: `pnpm db:seed` (added to `package.json`)
  - Templates to create (all with `isSystem: true`, `partnershipId: null`, `createdById: null`):
    1. **Weekly Check-in** (5 questions): feeling about us, appreciation, on your mind, connection scale 1-10, one thing together this week.
    2. **Monthly Deep Dive** (7 questions): overall state, highlight, unresolved issue, communication satisfaction scale, intimacy satisfaction scale, goal for next month, unasked needs.
    3. **Quick Pulse** (3 questions): one word feeling, anything needed today, connection scale.
  - PRD ref: Section 3 Phase 2, "System Default Templates."
  - Must be idempotent (safe to re-run without duplicating).

### Server Actions

- [x] **P2-A1**: `createTemplate(data)` -- Creates a new custom template with questions
  - File: `src/app/(app)/templates/actions.ts`
  - Input: `{ name: string, description?: string, questions: Array<{ questionText, isRequired? }> }`
  - Validation: User must have an active partnership. Name 1-100 chars. At least 1 question, max 20. Question text 1-500 chars.
  - Sets `partnershipId` to the user's active partnership, `createdById` to the user. Uses transaction.

- [x] **P2-A2**: `updateTemplate(id, data)` -- Updates template name, description, and questions
  - File: `src/app/(app)/templates/actions.ts`
  - Validation: Template must not be a system template. User must be in the owning partnership.
  - Strategy: Replace all questions (delete existing, insert new) in a transaction. Partial updates supported (name only, questions only, or both).

- [x] **P2-A3**: `deleteTemplate(id)` -- Deletes a custom template
  - File: `src/app/(app)/templates/actions.ts`
  - Validation: Not a system template. User must be in the owning partnership. Cascade delete handles questions.

- [x] **P2-A4**: `duplicateTemplate(id)` -- Duplicates a template (system or custom)
  - File: `src/app/(app)/templates/actions.ts`
  - Creates a new template with name + " (Copy)". Copies all questions. Sets `isSystem: false`, `partnershipId` to user's partnership.
  - Does not compound "(Copy)" suffix when duplicating an existing copy.

- [x] **P2-A5**: `getTemplates()` -- Lists available templates for the current partnership
  - File: `src/app/(app)/templates/queries.ts`
  - Returns: System templates + custom templates belonging to the user's partnership. Includes question count via LEFT JOIN + GROUP BY.

- [x] **P2-A6**: `getTemplate(id)` -- Gets a single template with its questions
  - File: `src/app/(app)/templates/queries.ts`
  - Authorization: System templates are readable by all. Custom templates only by partnership members. Returns ordered questions.

### Supporting Code

- [x] **P2-H1**: Template types definition
  - File: `src/app/(app)/templates/types.ts`
  - Types: `ActionResult`, `TemplateListItem`, `TemplateDetail`, `QuestionInput`, `CreateTemplateInput`, `UpdateTemplateInput`.

- [x] **P2-H2**: Template validation helpers
  - File: `src/app/(app)/templates/helpers.ts`
  - Helpers: `getActivePartnership()`, `isPartnershipMember()`, `validateName()`, `validateQuestions()`, `validateTemplateInput()`.
  - Shared across actions and queries. `MAX_QUESTIONS = 20` extracted to `src/app/(app)/templates/constants.ts`.

### Integration Tests

- [x] **P2-T1**: Integration test helpers for templates
  - File: `src/__tests__/integration/helpers.ts`
  - Added: `createTestTemplate()`, `createTestTemplateQuestion()`, `getTemplate()`, `getTemplateQuestions()` factory/assertion helpers.
  - Updated `TABLES_IN_DELETE_ORDER` to include `templateQuestions` and `checkInTemplates`.

- [x] **P2-T2**: Integration tests for template mutations
  - File: `src/__tests__/integration/template-actions.test.ts`
  - Coverage: `createTemplate` (happy path, auth, partnership, name validation, question validation, max questions, ordering, trimming), `updateTemplate` (name/desc, replace questions, system rejection, membership, validation), `deleteTemplate` (cascade, system rejection, membership), `duplicateTemplate` (system, custom, ordering, no compound suffix, membership).

- [x] **P2-T3**: Integration tests for template queries
  - File: `src/__tests__/integration/template-queries.test.ts`
  - Coverage: `getTemplates` (system templates, partnership scoping, cross-partnership isolation, question count), `getTemplate` (system access, partnership member access, cross-partnership rejection, non-existent, auth).

### UI Components

- [x] **P2-U1**: `TemplateList` -- Grid/list of available templates
  - File: `src/app/(app)/templates/template-list.tsx`
  - Shows system badge on default templates. Card for each template with name, description preview, question count.
  - Separates system templates ("Default Templates") and custom templates ("Your Templates") into sections.
  - Empty state with link to create first template.

- [x] **P2-U2**: `TemplateCard` -- Summary card for a template
  - File: `src/app/(app)/templates/template-card.tsx`
  - Shows: name, description preview, question count, actions (view, edit, duplicate, delete).
  - System templates: view and duplicate only (no edit/delete).
  - Includes inline `DeleteConfirmDialog` using the `Dialog` component.

- [x] **P2-U3**: `TemplateForm` -- Create/edit form for templates
  - File: `src/app/(app)/templates/template-form.tsx`
  - Inputs: name (required), description (optional textarea).
  - Contains `QuestionBuilder` for managing questions.
  - Client-side validation: name 1-100 chars, at least 1 non-empty question, question text max 500 chars.
  - Supports both create and edit modes. Redirects to template detail on success.

- [x] **P2-U4**: `QuestionBuilder` -- Sortable list of questions with controls
  - File: `src/app/(app)/templates/question-builder.tsx`
  - Each question row: text input with character counter (500 max), required toggle.
  - Up/down buttons for reordering (simpler alternative to drag-to-reorder).
  - "Add question" button at bottom. Max questions enforced (MAX_QUESTIONS = 20).
  - Note: Question type dropdown (free_text, scale, multiple_choice) and options editor not yet implemented -- all questions default to free text. Will add when scale/multiple choice support is needed.

- [x] **P2-U5**: `TemplateDetail` -- Read-only view of a template's questions
  - File: `src/app/(app)/templates/[id]/template-detail.tsx`
  - Shows all questions in order with numbering. Optional badge for non-required questions.
  - Action bar: Edit (custom only), Duplicate, Delete (custom only).
  - Includes inline `DeleteDetailDialog` that redirects to `/templates` on success.

### Pages

- [x] **P2-P1**: `/templates` -- Template list page
  - File: `src/app/(app)/templates/page.tsx` (replaced stub)
  - Server component. Fetches templates via `getTemplates()` and renders `TemplateList`.
  - "New Template" button linking to `/templates/new`.
  - Shows partnership setup prompt when user has no active partnership.

- [x] **P2-P2**: `/templates/new` -- Create template page
  - File: `src/app/(app)/templates/new/page.tsx`
  - Server component wrapper. Renders `TemplateForm` in create mode.

- [x] **P2-P3**: `/templates/[id]` -- View template detail page
  - File: `src/app/(app)/templates/[id]/page.tsx`
  - Server component. Fetches template + questions via `getTemplate()`. Renders `TemplateDetail`.
  - Dynamic metadata with template name. Returns 404 if template not found.

- [x] **P2-P4**: `/templates/[id]/edit` -- Edit template page
  - File: `src/app/(app)/templates/[id]/edit/page.tsx`
  - Server component. Fetches template + questions. Renders `TemplateForm` in edit mode.
  - Redirects to detail page if system template. Returns 404 if template not found.

### Phase 2 Task Summary

| Task                            | Category | Effort | Dependencies        | Status |
| ------------------------------- | -------- | ------ | ------------------- | ------ |
| P2-S1 checkInTemplates table    | Schema   | Small  | --                  | Done   |
| P2-S2 templateQuestions table   | Schema   | Small  | P2-S1               | Done   |
| P2-SEED system templates        | Data     | Small  | P2-S1, P2-S2        | Done   |
| P2-H1 Template types            | Support  | Small  | --                  | Done   |
| P2-H2 Validation helpers        | Support  | Small  | --                  | Done   |
| P2-A1 createTemplate            | Action   | Medium | P2-S1, P2-S2        | Done   |
| P2-A2 updateTemplate            | Action   | Medium | P2-S1, P2-S2        | Done   |
| P2-A3 deleteTemplate            | Action   | Small  | P2-S1               | Done   |
| P2-A4 duplicateTemplate         | Action   | Small  | P2-S1, P2-S2        | Done   |
| P2-A5 getTemplates              | Action   | Small  | P2-S1               | Done   |
| P2-A6 getTemplate               | Action   | Small  | P2-S1, P2-S2        | Done   |
| P2-T1 Test helpers              | Test     | Small  | P2-S1, P2-S2        | Done   |
| P2-T2 Action integration tests  | Test     | Medium | P2-A1..A4, P2-T1    | Done   |
| P2-T3 Query integration tests   | Test     | Medium | P2-A5, P2-A6, P2-T1 | Done   |
| P2-U1 TemplateList              | UI       | Medium | P2-A5               | Done   |
| P2-U2 TemplateCard              | UI       | Small  | --                  | Done   |
| P2-U3 TemplateForm              | UI       | Large  | P2-U4, P2-A1, P2-A2 | Done   |
| P2-U4 QuestionBuilder           | UI       | Large  | --                  | Done   |
| P2-U5 TemplateDetail            | UI       | Small  | P2-A6               | Done   |
| P2-P1 /templates page           | Page     | Small  | P2-U1               | Done   |
| P2-P2 /templates/new page       | Page     | Small  | P2-U3               | Done   |
| P2-P3 /templates/[id] page      | Page     | Small  | P2-U5               | Done   |
| P2-P4 /templates/[id]/edit page | Page     | Small  | P2-U3               | Done   |

### Remaining Phase 2 Work

All Phase 2 tasks are complete.

---

## Cross-cutting: Dev Seed Data

> Development seed data for local testing with realistic users, partnership, and templates.

- [x] **DEV-SEED-1**: Dev seed script with full test data
  - File: `src/db/seed-dev.ts`
  - Script: `pnpm db:seed:dev` (added to `package.json`)
  - Creates two users (Jeremy, Monica) with password `password`, complete profiles (display names, birthdays, pronouns, love languages, interests, goals), an accepted partnership, and templates (3 system + 1 custom).
  - Idempotent: uses upsert logic (checks for existing records, updates if present).
  - Prints login credentials on completion.

- [x] **DEV-SEED-2**: Updated `db:seed` script to load `.env` file
  - File: `package.json`
  - Changed `db:seed` from `npx tsx src/db/seed.ts` to `npx tsx --env-file=.env src/db/seed.ts`.

- [x] **DEV-SEED-3**: Extracted `MAX_QUESTIONS` to shared constants file
  - File: `src/app/(app)/templates/constants.ts`
  - `MAX_QUESTIONS = 20` moved from `helpers.ts` to `constants.ts` for reuse across `helpers.ts` and `question-builder.tsx`.

---

## Phase 3: Check-in Lifecycle

> The core feature. A check-in is an instance of a template that both partners work through together.
> PRD reference: Section 3 -- Phase 3
> Depends on: Phase 2

### Schema

- [x] **P3-S1**: `checkInStatusEnum` -- Enum for check-in states
  - File: `src/db/schema.ts`
  - Values: `draft`, `scheduled`, `in_progress`, `completed`

- [x] **P3-S2**: `checkIns` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `partnershipId` (text FK NOT NULL), `templateId` (text FK nullable), `title` (text NOT NULL), `status` (checkInStatusEnum), `scheduledFor` (timestamp nullable), `startedAt` (timestamp nullable), `completedAt` (timestamp nullable), `createdById` (text FK NOT NULL), `createdAt` (timestamp), `updatedAt` (timestamp).
  - Indexes: on `partnershipId`, on `status`, on `scheduledFor`.

- [x] **P3-S3**: `questionTypeEnum` -- Skipped (not needed yet)
  - All questions are free text, matching the `templateQuestions` table pattern.
  - Will add when scale/multiple choice support is needed.

- [x] **P3-S4**: `checkInQuestions` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `checkInId` (text FK, cascade delete), `questionText` (text NOT NULL), `isRequired` (boolean default true), `orderIndex` (integer NOT NULL), `createdById` (text FK nullable -- null for template-copied questions).
  - Note: `questionType` and `options` columns omitted -- all questions are free text, consistent with `templateQuestions`. Will add when scale/multiple choice support is needed.
  - Questions are copied from a template at creation time. Can also be added directly by users.

- [x] **P3-S5**: `checkInResponses` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `checkInQuestionId` (text FK, cascade delete), `userId` (text FK NOT NULL), `responseText` (text), `isDraft` (boolean default true), `createdAt` (timestamp), `updatedAt` (timestamp).
  - Unique constraint: `(checkInQuestionId, userId)` -- one response per user per question.

### Server Actions

- [ ] **P3-A1**: `createCheckIn(data)` -- Creates a check-in from a template or from scratch
  - File: `src/app/check-ins/actions.ts` (new)
  - Input: `{ templateId?: string, title?: string, scheduledFor?: Date }`
  - If `templateId` is provided: copy questions from the template into `checkInQuestions`. Title defaults to template name + date.
  - If no template: create a blank check-in with no questions. Title is required.
  - Sets status to `draft` (or `scheduled` if `scheduledFor` is in the future).
  - Authorization: user must have an active partnership. Check-in is created under that partnership.

- [ ] **P3-A2**: `addQuestion(checkInId, data)` -- Adds a custom question to a draft/scheduled check-in
  - File: `src/app/check-ins/actions.ts`
  - Input: `{ questionText, questionType, options?, isRequired? }`
  - Guard: check-in must be in `draft` or `scheduled` state.
  - Sets `orderIndex` to max existing + 1. Sets `createdById` to current user.

- [ ] **P3-A3**: `updateQuestion(questionId, data)` -- Edits a question on a check-in
  - File: `src/app/check-ins/actions.ts`
  - Input: `{ questionText?, questionType?, options?, isRequired? }`
  - Guard: check-in must be in `draft` or `scheduled` state.
  - Preserves existing draft responses (user can re-answer if question changed).

- [ ] **P3-A4**: `removeQuestion(questionId)` -- Removes a question and its draft responses
  - File: `src/app/check-ins/actions.ts`
  - Guard: check-in must be in `draft` or `scheduled` state.
  - Cascade: deletes associated `checkInResponses` for that question.

- [ ] **P3-A5**: `reorderQuestions(checkInId, orderedIds)` -- Updates order_index for all questions
  - File: `src/app/check-ins/actions.ts`
  - Input: `string[]` of question IDs in desired order.
  - Guard: check-in must be in `draft` or `scheduled` state.
  - Updates `orderIndex` for each question in a transaction.

- [ ] **P3-A6**: `saveResponse(questionId, text)` -- Upserts a response (draft or active)
  - File: `src/app/check-ins/actions.ts`
  - Upserts on `(checkInQuestionId, userId)`. Sets `isDraft` based on check-in status.
  - Response text max 5,000 chars.

- [ ] **P3-A7**: `startCheckIn(checkInId)` -- Transitions to `in_progress`
  - File: `src/app/check-ins/actions.ts`
  - Guard: check-in must be in `draft` or `scheduled` state.
  - Side effects: set `startedAt = now()`, set all existing responses `isDraft = false`.
  - Questions become locked (no add/edit/remove/reorder).

- [ ] **P3-A8**: `completeCheckIn(checkInId)` -- Transitions to `completed`
  - File: `src/app/check-ins/actions.ts`
  - Guard: check-in must be in `in_progress` state.
  - Side effects: set `completedAt = now()`. Answers become read-only.

- [ ] **P3-A9**: `reopenCheckIn(checkInId)` -- Transitions back to `in_progress`
  - File: `src/app/check-ins/actions.ts`
  - Guard: check-in must be in `completed` state.
  - Side effects: clear `completedAt`. Answers become editable again.

- [ ] **P3-A10**: `getCheckIn(id)` -- Gets a check-in with questions, responses, and action items
  - File: `src/app/check-ins/actions.ts`
  - Authorization: user must be a member of the check-in's partnership.
  - Privacy: if check-in is `draft` or `scheduled`, only return the current user's responses (not partner's). If `in_progress` or `completed`, return both.

- [ ] **P3-A11**: `getCheckIns(partnershipId)` -- Lists check-ins for a partnership
  - File: `src/app/check-ins/actions.ts`
  - Returns: id, title, status, scheduledFor, completedAt, question count. Ordered by most recent first.

### UI Components

- [ ] **P3-U1**: `CreateCheckInForm` -- Template selector, optional title override, optional schedule picker
  - File: `src/app/check-ins/new/create-check-in-form.tsx` (new)
  - Lists available templates (system + custom). Option for "Blank check-in."
  - Title input (defaults to template name + date).
  - Optional date/time picker for scheduling.

- [ ] **P3-U2**: `CheckInDraftView` -- Question list with answer inputs + question management
  - File: `src/app/check-ins/[id]/check-in-draft-view.tsx` (new)
  - Shows questions in order. Each has an answer input (type-aware: textarea for free_text, number slider for scale, radio/select for multiple_choice).
  - Question management controls: add, edit, remove, reorder buttons.
  - Progress indicator: "You: 3/5 answered. Partner: 2/5 answered." (count only, no content).
  - "Start Check-in" button with confirmation dialog.

- [ ] **P3-U3**: `CheckInQuestionEditor` -- Inline form for adding or editing a question
  - File: `src/app/check-ins/[id]/check-in-question-editor.tsx` (new)
  - Text input, type selector, options builder for multiple_choice, required toggle.
  - Used in both draft view (for check-in questions) and could share logic with `QuestionBuilder` from Phase 2.

- [ ] **P3-U4**: `CheckInActiveView` -- Side-by-side answer display during in_progress state
  - File: `src/app/check-ins/[id]/check-in-active-view.tsx` (new)
  - Questions displayed in order. For each question:
    - Partner A's answer (labeled with display name).
    - Partner B's answer (labeled with display name).
    - Own answer is editable. Partner's is read-only.
  - On mobile (< 768px): answers stack vertically instead of side-by-side.
  - Auto-save: debounced (1 second after typing stops), optimistic UI.
  - Action item controls per question (Phase 4).
  - "Complete Check-in" button.

- [ ] **P3-U5**: `CheckInResultsView` -- Read-only summary of completed check-in
  - File: `src/app/check-ins/[id]/check-in-results-view.tsx` (new)
  - Header: title, template name, completion date.
  - Questions listed with both partners' answers side-by-side.
  - Action items section.
  - "Re-open" button.
  - "Summarize with AI" button (Phase 6 placeholder).

- [ ] **P3-U6**: `CheckInStatusBadge` -- Visual indicator of check-in state
  - File: `src/components/check-in-status-badge.tsx` (new)
  - States: draft, scheduled, in progress, completed.
  - Uses both color and text (not color alone, per accessibility requirements).

- [ ] **P3-U7**: `ResponseInput` -- Type-aware input component for answering questions
  - File: `src/components/response-input.tsx` (new)
  - Renders based on question type:
    - `free_text`: textarea with character counter (max 5,000).
    - `scale`: numbered 1-10 selector (buttons or slider).
    - `multiple_choice`: radio button group from options.
  - Supports auto-save via `onChange` callback with debounce.

### Pages

- [ ] **P3-P1**: `/check-ins` -- Check-in history/list page (basic list, expanded in Phase 5)
  - File: `src/app/check-ins/page.tsx` (new)
  - Server component. Lists check-ins for the user's partnership.
  - "New check-in" button.

- [ ] **P3-P2**: `/check-ins/new` -- Create a new check-in
  - File: `src/app/check-ins/new/page.tsx` (new)
  - Server component. Fetches available templates. Renders `CreateCheckInForm`.

- [ ] **P3-P3**: `/check-ins/[id]` -- Check-in detail page (adaptive view)
  - File: `src/app/check-ins/[id]/page.tsx` (new)
  - Server component. Fetches check-in data. Renders the appropriate view based on status:
    - `draft` or `scheduled` -> `CheckInDraftView`
    - `in_progress` -> `CheckInActiveView`
    - `completed` -> `CheckInResultsView`

### Phase 3 Task Summary

| Task                         | Category | Effort | Dependencies        |
| ---------------------------- | -------- | ------ | ------------------- |
| P3-S1 checkInStatusEnum      | Schema   | Small  | --                  |
| P3-S2 checkIns table         | Schema   | Small  | P3-S1               |
| P3-S3 questionTypeEnum       | Schema   | Small  | --                  |
| P3-S4 checkInQuestions table | Schema   | Small  | P3-S2, P3-S3        |
| P3-S5 checkInResponses table | Schema   | Small  | P3-S4               |
| P3-A1 createCheckIn          | Action   | Medium | P3-S2, P3-S4, P2-S2 |
| P3-A2 addQuestion            | Action   | Small  | P3-S4               |
| P3-A3 updateQuestion         | Action   | Small  | P3-S4               |
| P3-A4 removeQuestion         | Action   | Small  | P3-S4, P3-S5        |
| P3-A5 reorderQuestions       | Action   | Small  | P3-S4               |
| P3-A6 saveResponse           | Action   | Medium | P3-S5               |
| P3-A7 startCheckIn           | Action   | Medium | P3-S2, P3-S5        |
| P3-A8 completeCheckIn        | Action   | Small  | P3-S2               |
| P3-A9 reopenCheckIn          | Action   | Small  | P3-S2               |
| P3-A10 getCheckIn            | Action   | Medium | P3-S2, P3-S4, P3-S5 |
| P3-A11 getCheckIns           | Action   | Small  | P3-S2               |
| P3-U1 CreateCheckInForm      | UI       | Medium | P2-A5, P3-A1        |
| P3-U2 CheckInDraftView       | UI       | Large  | P3-A6, P3-U3, P3-U7 |
| P3-U3 CheckInQuestionEditor  | UI       | Medium | P3-A2, P3-A3        |
| P3-U4 CheckInActiveView      | UI       | Large  | P3-A6, P3-U7        |
| P3-U5 CheckInResultsView     | UI       | Medium | P3-A10              |
| P3-U6 CheckInStatusBadge     | UI       | Small  | --                  |
| P3-U7 ResponseInput          | UI       | Medium | --                  |
| P3-P1 /check-ins page        | Page     | Small  | P3-A11, P3-U6       |
| P3-P2 /check-ins/new page    | Page     | Small  | P3-U1               |
| P3-P3 /check-ins/[id] page   | Page     | Medium | P3-U2, P3-U4, P3-U5 |

---

## Phase 4: Action Items

> During an active check-in, partners can create action items tied to specific questions.
> PRD reference: Section 3 -- Phase 4
> Depends on: Phase 3

### Schema

- [ ] **P4-S1**: `actionItems` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `checkInId` (text FK NOT NULL), `checkInQuestionId` (text FK NOT NULL), `description` (text NOT NULL, max 500 chars), `ownerType` (text: `individual | both`, default `individual`), `ownerId` (text FK nullable -- set when `ownerType` is `individual`, null when `both`), `createdById` (text FK NOT NULL), `status` (text: `open | in_progress | completed`, default `open`), `dueDate` (timestamp nullable), `completedAt` (timestamp nullable), `createdAt` (timestamp), `updatedAt` (timestamp).
  - Indexes: on `checkInId`, on `ownerId`, on `ownerType`, on `status`.
  - Consider: `pgEnum` for action item status and owner type.
  - Application-level constraint: `ownerId` NOT NULL when `ownerType = 'individual'`, NULL when `ownerType = 'both'`.

### Server Actions

- [ ] **P4-A1**: `createActionItem(data)` -- Creates an action item for a question
  - File: `src/app/check-ins/actions.ts`
  - Input: `{ checkInId, checkInQuestionId, description, ownerType, ownerId?, dueDate? }`
  - Guard: check-in must be `in_progress`.
  - Validation: description 1-500 chars. If `ownerType` is `individual`, `ownerId` is required and must be a member of the partnership. If `ownerType` is `both`, `ownerId` must be null/omitted.

- [ ] **P4-A2**: `updateActionItemStatus(id, status)` -- Updates action item status
  - File: `src/app/check-ins/actions.ts`
  - Can be done regardless of check-in state (per PRD: "Status changes can happen at any time").
  - If status is `completed`, set `completedAt = now()`. Otherwise, clear `completedAt`.
  - For shared (`both`) action items, either partner can update the status.

- [ ] **P4-A3**: `updateActionItem(id, data)` -- Edits description, owner type/id, due date
  - File: `src/app/check-ins/actions.ts`
  - Guard: only while check-in is `in_progress`. In `completed` state, only status changes are allowed (P4-A2).
  - Supports changing owner type (e.g., individual -> both or vice versa). Validates ownership constraints.

- [ ] **P4-A4**: `deleteActionItem(id)` -- Removes an action item
  - File: `src/app/check-ins/actions.ts`
  - Guard: only while check-in is `in_progress`.

- [ ] **P4-A5**: `getMyActionItems()` -- Gets open action items assigned to the current user across all check-ins
  - File: `src/app/check-ins/actions.ts`
  - Used for the dashboard widget.
  - Query logic: returns items where (`ownerType = 'individual'` AND `ownerId = currentUserId`) OR (`ownerType = 'both'` AND the action item's check-in belongs to the user's active partnership).
  - Sorted by due date (soonest first), then creation date.

### UI Components

- [ ] **P4-U1**: `ActionItemForm` -- Inline form under a question to add an action item
  - File: `src/components/action-item-form.tsx` (new)
  - Inputs: description, owner selector ("Me" / "Partner name" / "Both of us"), optional due date picker.
  - "Both of us" sets `ownerType: 'both'` and `ownerId: null`.

- [ ] **P4-U2**: `ActionItemCard` -- Shows a single action item with status toggle
  - File: `src/components/action-item-card.tsx` (new)
  - Shows: description, owner label (partner name for individual, "Both of you" / "Shared" for both), status badge, due date.
  - Shared items display a "Shared" badge or icon to distinguish from individual items.
  - Click/button to cycle status: open -> in_progress -> completed.

- [ ] **P4-U3**: `ActionItemList` -- Aggregated view of action items for a check-in or user
  - File: `src/components/action-item-list.tsx` (new)
  - Used in check-in results view and on the dashboard.
  - Supports filtering by owner type: "All", "Mine", "Partner's", "Shared".

- [ ] **P4-U4**: `DashboardActionItems` -- Widget on main dashboard showing open items for the user
  - File: `src/app/dashboard-action-items.tsx` (new) or inline in page.tsx
  - Shows open/in-progress action items assigned to the current user (individual) + shared items (both).
  - Groups or allows filtering: "Mine" vs. "Shared".
  - Links to the check-in detail page for each item.

### Integration Points

- [ ] **P4-INT1**: Wire action item controls into `CheckInActiveView` (P3-U4)
  - Per-question action item form and list.
  - Add action items during `in_progress` state.
  - Owner selector shows "Me", partner's name, and "Both of us".

- [ ] **P4-INT2**: Wire action item display into `CheckInResultsView` (P3-U5)
  - Show action items per question and in summary section.
  - Status toggle works even in completed check-ins.
  - Shared action items are visually distinguished (e.g., "Shared" badge).

### Phase 4 Task Summary

| Task                          | Category    | Effort | Dependencies        |
| ----------------------------- | ----------- | ------ | ------------------- |
| P4-S1 actionItems table       | Schema      | Small  | P3-S2, P3-S4        |
| P4-A1 createActionItem        | Action      | Medium | P4-S1               |
| P4-A2 updateActionItemStatus  | Action      | Small  | P4-S1               |
| P4-A3 updateActionItem        | Action      | Small  | P4-S1               |
| P4-A4 deleteActionItem        | Action      | Small  | P4-S1               |
| P4-A5 getMyActionItems        | Action      | Medium | P4-S1               |
| P4-U1 ActionItemForm          | UI          | Medium | P4-A1               |
| P4-U2 ActionItemCard          | UI          | Medium | P4-A2               |
| P4-U3 ActionItemList          | UI          | Medium | P4-U2               |
| P4-U4 DashboardActionItems    | UI          | Medium | P4-A5, P4-U3        |
| P4-INT1 Wire into ActiveView  | Integration | Medium | P3-U4, P4-U1, P4-U3 |
| P4-INT2 Wire into ResultsView | Integration | Small  | P3-U5, P4-U3        |

---

## Phase 5: Check-in History and Search

> Partners can browse, search, and filter their complete check-in history.
> PRD reference: Section 3 -- Phase 5
> Depends on: Phase 4

### Server Actions

- [ ] **P5-A1**: `searchCheckIns(query, filters)` -- Full-text search across check-in content
  - File: `src/app/check-ins/actions.ts`
  - Input: `{ query?: string, status?: string, startDate?: Date, endDate?: Date, cursor?: string, limit?: number }`
  - Search uses PostgreSQL `ILIKE` across: `check_ins.title`, `check_in_questions.question_text`, `check_in_responses.response_text`, `action_items.description`.
  - Results grouped by check-in with matching snippet highlights.
  - Scoped to the current user's partnership.
  - Cursor-based pagination (20 items per page).

### UI Components

- [ ] **P5-U1**: `SearchBar` -- Text input with debounced search (300ms)
  - File: `src/app/check-ins/search-bar.tsx` (new)
  - Debounced input. Updates URL search params or calls search action.

- [ ] **P5-U2**: `StatusFilter` -- Dropdown or pill toggle for filtering by status
  - File: `src/app/check-ins/status-filter.tsx` (new)
  - Options: All, Draft, Scheduled, In Progress, Completed.

- [ ] **P5-U3**: `DateRangeFilter` -- Two date inputs for start/end date range
  - File: `src/app/check-ins/date-range-filter.tsx` (new)

- [ ] **P5-U4**: `CheckInHistoryCard` -- Summary card for each check-in in the list
  - File: `src/app/check-ins/check-in-history-card.tsx` (new)
  - Shows: title, date, status badge, question count, action item count.
  - Links to `/check-ins/[id]`.

- [ ] **P5-U5**: Enhance `/check-ins` page with search, filters, and pagination
  - File: `src/app/check-ins/page.tsx` (modify P3-P1)
  - Add `SearchBar`, `StatusFilter`, `DateRangeFilter` above the check-in list.
  - Implement infinite scroll or pagination controls.

### Phase 5 Task Summary

| Task                          | Category | Effort | Dependencies                      |
| ----------------------------- | -------- | ------ | --------------------------------- |
| P5-A1 searchCheckIns          | Action   | Large  | P3-S2, P3-S4, P3-S5, P4-S1        |
| P5-U1 SearchBar               | UI       | Small  | --                                |
| P5-U2 StatusFilter            | UI       | Small  | --                                |
| P5-U3 DateRangeFilter         | UI       | Small  | --                                |
| P5-U4 CheckInHistoryCard      | UI       | Small  | P3-U6                             |
| P5-U5 Enhance /check-ins page | Page     | Medium | P5-A1, P5-U1, P5-U2, P5-U3, P5-U4 |

---

## Phase 6: AI Summarization

> After completing a check-in, either partner can request an AI-generated summary.
> PRD reference: Section 3 -- Phase 6
> Depends on: Phase 5

### Schema

- [ ] **P6-S1**: `aiSummaries` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `checkInId` (text FK, cascade delete), `overview` (text NOT NULL), `themes` (text, JSON array), `alignments` (text, JSON array), `attentionAreas` (text, JSON array), `suggestedFollowUps` (text, JSON array), `generatedAt` (timestamp NOT NULL), `createdAt` (timestamp).

### Dependencies

- [ ] **P6-DEP1**: Add OpenAI SDK dependency
  - File: `package.json`
  - Package: `openai` (latest)
  - Environment variable: `OPENAI_API_KEY` in `.env`

### Server Actions

- [ ] **P6-A1**: `generateSummary(checkInId)` -- Calls OpenAI and stores the summary
  - File: `src/app/check-ins/actions.ts`
  - Guard: check-in must be `completed`.
  - Constructs prompt with: app context, partnership profile data (love languages, goals), all questions + both partners' responses, all action items.
  - Response schema: `{ overview, themes[], alignments[], attentionAreas[], suggestedFollowUps[] }`.
  - Stores result in `aiSummaries` table.
  - If a summary already exists, replaces it (for regeneration).

- [ ] **P6-A2**: `getSummary(checkInId)` -- Retrieves a previously generated summary
  - File: `src/app/check-ins/actions.ts`
  - Returns null if no summary exists.

### UI Components

- [ ] **P6-U1**: `SummarizeButton` -- Triggers AI summary generation
  - File: `src/components/summarize-button.tsx` (new)
  - Shows loading spinner during generation.
  - "Regenerate" variant if summary already exists.

- [ ] **P6-U2**: `AISummaryCard` -- Displays the structured summary
  - File: `src/components/ai-summary-card.tsx` (new)
  - Sections: overview paragraph, key themes, areas of alignment, areas for attention, suggested follow-ups.

- [ ] **P6-U3**: `AIDisclaimerDialog` -- First-time consent dialog
  - File: `src/components/ai-disclaimer-dialog.tsx` (new)
  - Explains that data will be processed by AI (OpenAI).
  - Shown before the first summary generation. Consent can be stored in localStorage or user preferences.

### Integration Points

- [ ] **P6-INT1**: Wire summary components into `CheckInResultsView` (P3-U5)
  - Add `SummarizeButton` and `AISummaryCard` to the results page.
  - Show disclaimer on first use.

### Phase 6 Task Summary

| Task                          | Category    | Effort | Dependencies                 |
| ----------------------------- | ----------- | ------ | ---------------------------- |
| P6-S1 aiSummaries table       | Schema      | Small  | P3-S2                        |
| P6-DEP1 OpenAI dependency     | Config      | Small  | --                           |
| P6-A1 generateSummary         | Action      | Large  | P6-S1, P6-DEP1, P3-S5, P4-S1 |
| P6-A2 getSummary              | Action      | Small  | P6-S1                        |
| P6-U1 SummarizeButton         | UI          | Small  | P6-A1                        |
| P6-U2 AISummaryCard           | UI          | Medium | P6-A2                        |
| P6-U3 AIDisclaimerDialog      | UI          | Small  | --                           |
| P6-INT1 Wire into ResultsView | Integration | Small  | P3-U5, P6-U1, P6-U2, P6-U3   |

---

## Phase 7: Profile Editing (Independent)

> Users can edit any information they provided during onboarding.
> PRD reference: Section 3 -- Phase 7
> No dependencies -- can be built at any time.

### Refactoring

- [x] **P7-R1**: Extract onboarding step components into shared profile components
  - Source: `src/app/onboarding/onboarding-wizard.tsx` (previously contained `StepAboutYou`, `StepLoveConnection`, `StepGoals` inline)
  - Target: `src/components/profile/` directory
    - `src/components/profile/constants.ts` -- shared constants (`PRONOUNS_OPTIONS`, `LOVE_LANGUAGES`, `INTEREST_OPTIONS`, `GOAL_OPTIONS`)
    - `src/components/profile/about-you-fields.tsx`
    - `src/components/profile/love-connection-fields.tsx`
    - `src/components/profile/goals-fields.tsx`
  - The extracted components accept form state as props so they can be used in both the onboarding wizard and the profile edit page.
  - `onboarding-wizard.tsx` updated to import from the new shared components. Step headers kept wizard-specific via a local `StepHeader` helper.

### Server Actions

- [x] **P7-A1**: `updateProfile(data)` -- Updates the user's profile
  - File: `src/app/(app)/settings/actions.ts`
  - Reuses validation logic from onboarding `saveProfile` (`src/app/onboarding/actions.ts`).
  - Input: `{ displayName, birthday?, pronouns?, loveLang?, interests?, goals? }`
  - Updates the existing profile row. Does not change `onboardingCompleted`.
  - Revalidates `/settings/profile` and `/` after update.

### UI Components

- [x] **P7-U1**: `ProfileEditForm` -- Single-page form with all profile fields
  - File: `src/app/(app)/settings/profile/profile-edit-form.tsx`
  - All sections on one page (no wizard steps). Three sections: About You, Love & Connection, Goals.
  - Uses the shared profile field components from P7-R1.
  - Pre-populated with current profile data (parses JSON interests/goals, resolves custom pronouns).
  - Save button at the bottom. Success message on save (auto-clears after 3s). Validation errors inline.

### Pages

- [x] **P7-P1**: `/settings/profile` -- Profile edit page
  - File: `src/app/(app)/settings/profile/page.tsx`
  - Server component. Auth guard (defensive, layout handles primary guard). Fetches current profile. Renders `ProfileEditForm`.

### Phase 7 Task Summary

| Task                             | Category | Effort | Dependencies |
| -------------------------------- | -------- | ------ | ------------ |
| P7-R1 Extract profile components | Refactor | Medium | --           |
| P7-A1 updateProfile              | Action   | Small  | --           |
| P7-U1 ProfileEditForm            | UI       | Medium | P7-R1, P7-A1 |
| P7-P1 /settings/profile page     | Page     | Small  | P7-U1        |

---

## Cross-cutting: Navigation and Dashboard

> The PRD specifies a persistent navigation bar and a redesigned dashboard.
> These tasks span multiple phases and should be tackled alongside or after Phase 1 completion.

### Navigation

- [x] **NAV-1**: Persistent navigation bar
  - File: `src/components/nav-bar.tsx`
  - Desktop: fixed top bar with logo, centered nav links, user avatar + sign out.
  - Mobile: fixed top bar (logo + avatar + sign out) + bottom tab bar.
  - Items: Home (`/`), Check-ins (`/check-ins`), Templates (`/templates`), Settings (`/settings/profile`).
  - Partner page accessible from dashboard, not a nav item.
  - Active route highlighted via `isActive()` helper using `usePathname()`.

- [x] **NAV-2**: Wire navigation into app layout
  - File: `src/app/(app)/layout.tsx` (new route-group layout)
  - `(app)` route group renders `NavBar` for authenticated users who have completed onboarding.
  - Auth pages (`/login`, `/register`) live in `(auth)` group and do not render NavBar.
  - `/onboarding` lives outside both groups and does not render NavBar.

### Route Group Restructuring

- [x] **ROUTE-1**: Introduce `(app)` route group for authenticated app pages
  - Files moved: `src/app/page.tsx` -> `src/app/(app)/page.tsx`, `src/app/partner/` -> `src/app/(app)/partner/`
  - New layout: `src/app/(app)/layout.tsx` -- server component that checks auth session + onboarding completion, redirects to `/login` or `/onboarding` as needed, renders `NavBar`, wraps children in centered `<main>` container.
  - Eliminates per-page auth/onboarding guard boilerplate.

- [x] **ROUTE-2**: Introduce `(auth)` route group for login/register pages
  - Files moved: `src/app/login/` -> `src/app/(auth)/login/`, `src/app/register/` -> `src/app/(auth)/register/`
  - Auth pages do not render the NavBar or app layout.

- [x] **ROUTE-3**: Extract sign-out server action
  - File: `src/lib/sign-out-action.ts`
  - Calls `signOut({ redirectTo: '/login' })`. Used by NavBar sign-out button.
  - Replaces inline sign-out form that was previously in the dashboard page.

- [x] **ROUTE-4**: Placeholder route stubs for future feature pages
  - `src/app/(app)/check-ins/page.tsx` -- "Coming soon" stub for check-in history page (P3-P1).
  - `src/app/(app)/templates/page.tsx` -- "Coming soon" stub for template list page (P2-P1).
  - `src/app/(app)/settings/profile/page.tsx` -- "Coming soon" stub for profile settings page (P7-P1).
  - These stubs make nav links functional immediately; actual feature content will replace them.

### Dashboard Redesign

- [ ] **DASH-1**: Unpartnered dashboard state
  - File: `src/app/(app)/page.tsx` (modify)
  - Welcome message with user's display name.
  - Invite partner form or pending invite status (inline or link to `/partner`).
  - Note: Currently redirects unpartnered users to `/partner` instead of showing inline content.

- [ ] **DASH-2**: Partnered dashboard state
  - File: `src/app/(app)/page.tsx` (modify)
  - Welcome message with partner's display name.
  - Sections: upcoming check-ins, my action items, recent check-ins (last 3), quick actions ("New check-in" button, "View history" link).
  - Depends on Phases 3 and 4 for data.
  - Note: Currently shows "Dashboard" heading + PartnerCard only.

---

## Cross-cutting: Non-functional Requirements

> PRD reference: Section 8

### Auto-save

- [ ] **NF-1**: Implement debounced auto-save for response editing (1s debounce, optimistic UI)
  - Applies to: `ResponseInput` component (P3-U7), `CheckInDraftView` (P3-U2), `CheckInActiveView` (P3-U4).
  - Pattern: `useCallback` + `setTimeout` with cleanup. Optimistic state update. Server action `saveResponse` fires in background.

### Pagination

- [ ] **NF-2**: Cursor-based pagination for check-in history (20 items per page)
  - Applies to: `searchCheckIns` action (P5-A1), `/check-ins` page (P5-U5).
  - Use `createdAt` + `id` as cursor for stable ordering.

### Accessibility

- [ ] **NF-3**: Keyboard navigation for all interactive elements
  - All buttons, inputs, toggles, and drag handles must be keyboard-accessible.
  - Tab order follows visual order.

- [ ] **NF-4**: Focus management for dialogs
  - Focus trapped inside modals when open. Restored to trigger element on close.
  - Applies to: `DisconnectConfirmDialog` (P1-U5), `AIDisclaimerDialog` (P6-U3), confirmation dialogs for starting/completing check-ins.

- [ ] **NF-5**: Screen reader announcements for state transitions
  - Use `aria-live` regions or toast announcements for: "Check-in started", "Check-in completed", "Action item completed", etc.

### Mobile Responsiveness

- [ ] **NF-6**: Side-by-side to stacked layout transition at 768px breakpoint
  - Applies to: `CheckInActiveView` (P3-U4), `CheckInResultsView` (P3-U5).
  - Touch targets >= 44x44px for all interactive elements.

### Data Validation

- [ ] **NF-7**: Zod schemas for all server action inputs
  - Template name: 1-100 chars.
  - Question text: 1-500 chars.
  - Multiple choice options: >= 2 items, each 1-200 chars.
  - Response text: max 5,000 chars.
  - Action item description: max 500 chars.
  - Action item `ownerType`: must be `individual` or `both`. When `individual`, `ownerId` required and must reference a partnership member. When `both`, `ownerId` must be null.
  - Email format for partner invites.
  - Add `zod` dependency if not present.

### Error Handling

- [ ] **NF-8**: Consistent error/success return pattern for all server actions
  - Pattern: `{ success: boolean, error?: string }` (already used in partner actions).
  - Network error toast with retry option.

---

## Database Migration Checklist

All new tables (in dependency order):

1. `check_in_templates` (Phase 2)
2. `template_questions` (Phase 2)
3. `check_ins` (Phase 3)
4. `check_in_questions` (Phase 3)
5. `check_in_responses` (Phase 3)
6. `action_items` (Phase 4)
7. `ai_summaries` (Phase 6)

Generate migration after adding tables to `src/db/schema.ts`:

```bash
cd packages/sync
npx drizzle-kit generate
npx drizzle-kit migrate
```

---

## Suggested Implementation Order

For each phase, work in this order: **Schema -> Seed -> Actions -> Components -> Pages -> Integration**.

| Order | Tasks                                                                 | Phase             |
| ----- | --------------------------------------------------------------------- | ----------------- |
| ~~1~~ | ~~P1-A6, P1-U4, P1-U5 (finish Phase 1 gaps)~~                         | ~~1~~             |
| ~~2~~ | ~~NAV-1, NAV-2, ROUTE-1 through ROUTE-4 (navigation + route groups)~~ | ~~Cross-cutting~~ |
| ~~3~~ | ~~P7-R1, P7-A1, P7-U1, P7-P1 (profile editing, independent)~~         | ~~7~~             |
| ~~4~~ | ~~P2-S1, P2-S2, P2-SEED (template schema + seed)~~                    | ~~2~~             |
| ~~5~~ | ~~P2-A1 through P2-A6 (template actions + queries)~~                  | ~~2~~             |
| ~~6~~ | ~~P2-U1 through P2-U5, P2-P1 through P2-P4 (template UI + pages)~~    | ~~2~~             |
| 7     | P3-S1 through P3-S5 (check-in schema)                                 | 3                 |
| 8     | P3-A1 through P3-A11 (check-in actions)                               | 3                 |
| 9     | P3-U6, P3-U7 (shared components)                                      | 3                 |
| 10    | P3-U1 through P3-U5, P3-P1 through P3-P3 (check-in UI + pages)        | 3                 |
| 11    | P4-S1, P4-A1 through P4-A5 (action items schema + actions)            | 4                 |
| 12    | P4-U1 through P4-U4, P4-INT1, P4-INT2 (action items UI + integration) | 4                 |
| 13    | DASH-1, DASH-2 (dashboard redesign)                                   | Cross-cutting     |
| 14    | P5-A1, P5-U1 through P5-U5 (history + search)                         | 5                 |
| 15    | P6-S1, P6-DEP1, P6-A1, P6-A2 (AI schema + actions)                    | 6                 |
| 16    | P6-U1 through P6-U3, P6-INT1 (AI UI + integration)                    | 6                 |
| 17    | NF-1 through NF-8 (non-functional polish)                             | Cross-cutting     |
