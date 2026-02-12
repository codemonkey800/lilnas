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

## Completed Phases (Summarized)

The following phases are fully implemented and require no further work.

### Pre-requisites

Auth (registration, login, middleware), onboarding wizard, user/profile schema, project scaffolding, database setup (Drizzle + PostgreSQL), NextAuth, design system (dark purple theme), Docker/deployment config. All in `src/app/(auth)/`, `src/middleware.ts`, `src/auth.ts`, `src/db/schema.ts`, `src/tailwind.css`, etc.

### Phase 1: Partner Connection

Partnership lifecycle with `partnerships` table (pgEnum: pending/accepted/declined/cancelled/dissolved), unique active pair index. Server actions in `src/app/(app)/partner/actions.ts`: invite, accept, decline, cancel, dissolve. Queries in `src/app/(app)/partner/queries.ts`: getPartnershipStatus, getPartnerInfo. Types in `src/app/(app)/partner/types.ts`. UI: invite form (`invite-form-view.tsx`), pending outgoing view (`pending-outgoing-view.tsx`), incoming invite view (`incoming-invite-view.tsx`), partner card with unlink dialog. Page: `/partner`. Component tests in `src/app/(app)/partner/__tests__/`.

### Phase 2: Check-in Templates

Template system with `checkInTemplates` and `templateQuestions` tables (all questions free text). 3 seeded system templates (Weekly, Monthly Deep Dive, Quick Pulse). CRUD actions + duplicate in `src/app/(app)/templates/actions.ts` and `queries.ts`. Types in `types.ts`, validation helpers in `helpers.ts`, `MAX_QUESTIONS = 20` in `constants.ts`. Full UI: template list, card, form with question builder, detail view. Pages: `/templates`, `/templates/new`, `/templates/[id]`, `/templates/[id]/edit`. Integration tests in `src/__tests__/integration/template-actions.test.ts` and `template-queries.test.ts`.

### Phase 7: Profile Editing (Independent)

Extracted shared profile field components from onboarding wizard to `src/components/profile/` (constants, about-you, love-connection, goals fields). `updateProfile` action in `src/app/(app)/settings/actions.ts`. Single-page `ProfileEditForm` at `/settings/profile`.

### Cross-cutting: Dev Seed Data

Seed script (`src/db/seed.ts`, `pnpm db:seed`) creates two test users (Jeremy, Monica), profiles, partnership, system templates, and user-created templates. Idempotent with upsert logic. Loads `.env` automatically.

### Cross-cutting: Navigation & Route Groups

Persistent nav bar (`src/components/nav-bar.tsx`) with desktop top bar and mobile bottom tabs. `(app)` route group layout (`src/app/(app)/layout.tsx`) handles auth/onboarding guards. `(auth)` route group for login/register. Sign-out action in `src/lib/sign-out-action.ts`. Route stubs created for all nav targets.

---

## Phase 3: Check-in Lifecycle (Complete)

> The core feature. A check-in is an instance of a template that both partners work through together.
> PRD reference: Section 3 -- Phase 3
> Depends on: Phase 2

### Schema (Complete)

- [x] **P3-S1**: `checkInStatusEnum` -- values: `draft`, `in_progress`, `completed`
- [x] **P3-S2**: `checkIns` table -- `id`, `partnershipId`, `templateId`, `title`, `status`, `startedAt`, `completedAt`, `createdById`, timestamps. Indexes on partnershipId, status.
- [x] **P3-S3**: `questionTypeEnum` -- Skipped (all free text for now)
- [x] **P3-S4**: `checkInQuestions` table -- copied from template at creation, immutable. Cascade delete from checkIn.
- [x] **P3-S5**: `checkInResponses` table -- unique on `(checkInQuestionId, userId)`, `isDraft` flag.

All schema in `src/db/schema.ts`.

### Server Actions (Complete)

- [x] **P3-A1**: `createCheckIn(data)` -- from template (required), copies questions, sets draft
- ~~P3-A2 through P3-A5~~ -- Dropped (questions locked from template)
- [x] **P3-A6**: `saveResponse(questionId, text)` -- upsert, isDraft by status, max 5k chars
- [x] **P3-A7**: `startCheckIn` -- creates pending start request (partner confirmation required, see PC-A1)
- [x] **P3-A8**: `completeCheckIn` -- creates pending complete request (partner confirmation required, see PC-A2)
- [x] **P3-A9**: `reopenCheckIn` -- creates pending reopen request (partner confirmation required, see PC-A3)
- [x] **P3-A10**: `getCheckIn(id)` -- with questions/responses, privacy filtering by status
- [x] **P3-A11**: `getCheckIns()` -- list for partnership, ordered by most recent

Check-in lifecycle actions in `src/app/(app)/check-ins/check-in.actions.ts`, action item actions in `src/app/(app)/check-ins/action-item.actions.ts`, queries in `src/app/(app)/check-ins/queries.ts`.

### Supporting Code (Complete)

- [x] **P3-H1**: Shared partnership helpers in `src/lib/partnership.ts`
- [x] **P3-H2**: Check-in types in `src/app/(app)/check-ins/types.ts`
- [x] **P3-H3**: Check-in helpers in `src/app/(app)/check-ins/helpers.ts`

### Integration Tests (Complete)

- [x] **P3-T1**: Test helpers in `src/__tests__/integration/helpers.ts`
- [x] **P3-T2**: Action tests in `src/__tests__/integration/check-in-actions.test.ts`
- [x] **P3-T3**: Query tests in `src/__tests__/integration/check-in-queries.test.ts`
- [x] **P3-T4**: Helper unit tests in `src/app/(app)/check-ins/__tests__/helpers.test.ts`

### UI Components

- [x] **P3-U1**: `CreateCheckInForm` -- Template selector (required), optional title override
  - File: `src/app/(app)/check-ins/new/create-check-in-form.tsx`
  - Lists available templates (system + custom). A template must be selected.
  - Title input (defaults to template name + date).

- [x] **P3-U2**: `CheckInDraftView` -- Question list with answer inputs (questions are read-only)
  - File: `src/app/(app)/check-ins/[id]/check-in-draft-view.tsx`
  - Shows questions in order. Each has a textarea answer input.
  - Questions are read-only (copied from template, no editing controls).
  - Progress indicator: "You: X/Y answered" (count only, no content; partner count hidden in draft for privacy).
  - "Start Check-in" button with confirmation dialog.

- ~~**P3-U3**: `CheckInQuestionEditor`~~ -- Dropped. Questions are locked from template.

- [x] **P3-U4**: `CheckInActiveView` -- Side-by-side answer display during in_progress state
  - File: `src/app/(app)/check-ins/[id]/check-in-active-view.tsx`
  - Questions displayed in order. For each question:
    - Partner A's answer (labeled with display name).
    - Partner B's answer (labeled with display name).
    - Own answer is editable. Partner's is read-only.
  - On mobile (< 768px): answers stack vertically instead of side-by-side.
  - Auto-save: debounced (1 second after typing stops), optimistic UI.
  - Action item controls per question (Phase 4).
  - "Complete Check-in" button.

- [x] **P3-U5**: `CheckInResultsView` -- Read-only summary of completed check-in
  - File: `src/app/(app)/check-ins/[id]/check-in-results-view.tsx`
  - Header: title, template name, completion date.
  - Questions listed with both partners' answers side-by-side.
  - Action items section (placeholder for Phase 4).
  - "Re-open" button with confirmation dialog.
  - "Summarize with AI" button (Phase 6 placeholder, disabled).

- [x] **P3-U6**: `CheckInStatusBadge` -- Visual indicator of check-in state
  - File: `src/components/check-in-status-badge.tsx`
  - States: draft, in progress, completed.
  - Uses both color and text (not color alone, per accessibility requirements).
  - Tests: `src/components/__tests__/check-in-status-badge.test.tsx`

- [x] **P3-U7**: `ResponseInput` -- Textarea input component for answering questions
  - File: `src/components/response-input.tsx`
  - Textarea with character counter (max 5,000).
  - Supports auto-save via `onAutoSave` callback with 1s debounce.
  - Tests: `src/components/__tests__/response-input.test.tsx`

### Pages

- [x] **P3-P1**: `/check-ins` -- Check-in history/list page (basic list, expanded in Phase 5)
  - File: `src/app/(app)/check-ins/page.tsx`
  - Server component. Lists check-ins for the user's partnership with status badges, question counts, and dates.
  - "New check-in" button. Empty state and unpartnered state handled.

- [x] **P3-P2**: `/check-ins/new` -- Create a new check-in
  - File: `src/app/(app)/check-ins/new/page.tsx`
  - Server component. Fetches available templates. Renders `CreateCheckInForm`.

- [x] **P3-P3**: `/check-ins/[id]` -- Check-in detail page (adaptive view)
  - File: `src/app/(app)/check-ins/[id]/page.tsx`
  - Server component. Fetches check-in data. Renders the appropriate view based on status:
    - `draft` -> `CheckInDraftView`
    - `in_progress` -> `CheckInActiveView`
    - `completed` -> `CheckInResultsView`

### Supporting Code

- [x] **P3-H1**: Shared partnership helpers extracted to `src/lib/partnership.ts`
  - `getActivePartnership(userId)` and `isPartnershipMember(partnershipId, userId)`.
  - Previously in `src/app/(app)/templates/helpers.ts`; now re-exported from there for backward compatibility.

- [x] **P3-H2**: Check-in types definition
  - File: `src/app/(app)/check-ins/types.ts`
  - Types: `ActionResult`, `CreateCheckInInput`, `CheckInListItem`, `CheckInQuestion`, `CheckInResponse`, `CheckInDetail`.

- [x] **P3-H3**: Check-in helpers
  - File: `src/app/(app)/check-ins/helpers.ts`
  - Helpers: `getCheckInForUser()`, `guardDraft()`, `guardCanRespond()`, `guardInProgress()`, `guardCompleted()`, `validateTitle()`, `validateResponseText()`, `formatCheckInDate()`.

### Integration Tests

- [x] **P3-T1**: Integration test helpers for check-ins
  - File: `src/__tests__/integration/helpers.ts`
  - Added: `createTestCheckIn()`, `createTestCheckInQuestion()`, `createTestCheckInResponse()`, `getCheckIn()`, `getCheckInQuestions()`, `getCheckInResponses()` factory/assertion helpers.
  - Updated `TABLES_IN_DELETE_ORDER` to include `checkInResponses`, `checkInQuestions`, and `checkIns`.

- [x] **P3-T2**: Integration tests for check-in actions
  - File: `src/__tests__/integration/check-in-actions.test.ts`
  - Coverage: `createCheckIn` (happy path, custom title, default title, draft status, auth, partnership, template not found, empty template, title validation), `saveResponse` (new response, upsert, isDraft by status, auth, question not found, membership, completed guard, response length), `startCheckIn` (draft->in_progress, marks drafts visible, auth, membership, already started, already completed), `completeCheckIn` (in_progress->completed, auth, membership, draft guard, completed guard), `reopenCheckIn` (completed->in_progress, clears completedAt, auth, membership, draft guard, in_progress guard).

- [x] **P3-T3**: Integration tests for check-in queries
  - File: `src/__tests__/integration/check-in-queries.test.ts`
  - Coverage: `getCheckIn` (member access with questions/responses, draft privacy filtering, in_progress shows both, displayName included, non-member rejection, auth), `getCheckIns` (ordering by most recent, questionCount, empty partnership, auth, no partnership).

- [x] **P3-T4**: Unit tests for check-in helpers
  - File: `src/app/(app)/check-ins/__tests__/helpers.test.ts`
  - Coverage: `guardDraft` (accepts draft, rejects in_progress/completed), `guardCanRespond` (accepts draft/in_progress, rejects completed), `guardInProgress` (accepts in_progress, rejects others), `guardCompleted` (accepts completed, rejects others), `validateTitle` (valid, boundary 200 chars, empty, whitespace, over limit, trimming), `validateResponseText` (empty, boundary 5000 chars, over limit), `formatCheckInDate` (completed prefix, fallback to createdAt, null when no dates).

### Phase 3 Remaining Tasks

| Task                       | Category | Effort | Dependencies        | Status |
| -------------------------- | -------- | ------ | ------------------- | ------ |
| P3-U1 CreateCheckInForm    | UI       | Medium | P2-A5, P3-A1        | Done   |
| P3-U2 CheckInDraftView     | UI       | Medium | P3-A6, P3-U7        | Done   |
| P3-U4 CheckInActiveView    | UI       | Large  | P3-A6, P3-U7        | Done   |
| P3-U5 CheckInResultsView   | UI       | Medium | P3-A10              | Done   |
| P3-U6 CheckInStatusBadge   | UI       | Small  | --                  | Done   |
| P3-U7 ResponseInput        | UI       | Small  | --                  | Done   |
| P3-P1 /check-ins page      | Page     | Small  | P3-A11, P3-U6       | Done   |
| P3-P2 /check-ins/new page  | Page     | Small  | P3-U1               | Done   |
| P3-P3 /check-ins/[id] page | Page     | Medium | P3-U2, P3-U4, P3-U5 | Done   |

---

## Phase 4: Action Items (Complete)

> During an active check-in, partners can create action items tied to specific questions.
> PRD reference: Section 3 -- Phase 4
> Depends on: Phase 3

### Schema (Complete)

- [x] **P4-S1**: `actionItems` table
  - File: `src/db/schema.ts`
  - Columns: `id` (text PK, UUID), `checkInId` (text FK NOT NULL), `checkInQuestionId` (text FK NOT NULL), `description` (text NOT NULL, max 500 chars), `ownerType` (`actionItemOwnerTypeEnum`: `individual | both`, default `individual`), `ownerId` (text FK nullable -- set when `ownerType` is `individual`, null when `both`), `createdById` (text FK NOT NULL), `status` (`actionItemStatusEnum`: `open | in_progress | completed`, default `open`), `dueDate` (timestamp nullable), `completedAt` (timestamp nullable), `createdAt` (timestamp), `updatedAt` (timestamp).
  - Indexes: on `checkInId`, on `ownerId`, on `status`.
  - Uses `pgEnum` for both `actionItemOwnerTypeEnum` and `actionItemStatusEnum`.
  - Application-level constraint: `ownerId` NOT NULL when `ownerType = 'individual'`, NULL when `ownerType = 'both'`.

### Server Actions

- [x] **P4-A1**: `createActionItem(data)` -- Creates an action item for a question
  - File: `src/app/(app)/check-ins/action-item.actions.ts`
  - Input: `{ checkInId, checkInQuestionId, description, ownerType, ownerId? }`
  - Guard: check-in must be `in_progress`.
  - Validation: description 1-500 chars via `validateActionItemDescription`. If `ownerType` is `individual`, `ownerId` is required and must be a member of the partnership. If `ownerType` is `both`, `ownerId` must be null/omitted.

- [x] **P4-A2**: `updateActionItemStatus(id, status)` -- Updates action item status
  - File: `src/app/(app)/check-ins/action-item.actions.ts`
  - Can be done regardless of check-in state (per PRD: "Status changes can happen at any time").
  - If status is `completed`, set `completedAt = now()`. Otherwise, clear `completedAt`.
  - For shared (`both`) action items, either partner can update the status.

- ~~**P4-A3**: `updateActionItem(id, data)`~~ -- Dropped. Users delete and recreate action items instead of editing.

- [x] **P4-A4**: `deleteActionItem(id)` -- Removes an action item
  - File: `src/app/(app)/check-ins/action-item.actions.ts`
  - Guard: only while check-in is `in_progress`.

- [x] **P4-A5**: `getMyActionItems()` -- Gets open action items assigned to the current user across all check-ins
  - File: `src/app/(app)/check-ins/queries.ts`
  - Used for the dashboard widget.
  - Query logic: returns items where (`ownerType = 'individual'` AND `ownerId = currentUserId`) OR (`ownerType = 'both'` AND the action item's check-in belongs to the user's active partnership).
  - Sorted by due date (soonest first, nulls last), then creation date.
  - Returns `DashboardActionItem` type (extends `ActionItem` with `checkInTitle`).

### UI Components

- [x] **P4-U1**: `ActionItemForm` -- Inline form under a question to add an action item
  - File: `src/components/action-item-form.tsx`
  - Inputs: description, owner selector ("Me" / "Partner name" / "Both of us").
  - "Both of us" sets `ownerType: 'both'` and `ownerId: null`.
  - Collapsible: shows "Add action item" button that expands to form. Cancel resets and collapses.

- [x] **P4-U2**: `ActionItemCard` -- Shows a single action item with status toggle
  - File: `src/components/action-item-card.tsx`
  - Shows: description, owner label (partner name for individual, "Both" for shared), status circle indicator.
  - Click status circle to cycle: open -> in_progress -> completed. Optimistic UI with revert on failure.
  - Delete button visible only when check-in is `in_progress`.
  - ~~Inline editing~~ -- Dropped. Users delete and recreate action items instead of editing.

- [x] **P4-U3**: `ActionItemList` -- Aggregated view of action items for a check-in
  - File: `src/components/action-item-list.tsx`
  - Used in check-in active view and results view.
  - Optional `showEmpty` prop for "No action items yet" message.

- [x] **P4-U4**: `DashboardActionItems` -- Widget on main dashboard showing open items for the user
  - Server component: `src/app/(app)/dashboard-action-items.tsx`
  - Client component: `src/components/dashboard-action-item-card.tsx`
  - Shows open/in-progress action items assigned to the current user (individual) + shared items (both).
  - Each item shows description, check-in title, owner badge, and status toggle.
  - Links to the check-in detail page for each item.
  - Unit tests: `src/components/__tests__/dashboard-action-item-card.test.tsx`

- [x] **P4-U5**: `DashboardActionItemsList` -- Filterable action items list with owner and status filters (PRD A7)
  - File: `src/components/dashboard-action-items-list.tsx`
  - Client component that receives all partnership action items and userId from the server component.
  - Owner filter pill bar: All, Mine, Partner's, Shared. Default: All.
  - Status filter pill bar: Open (shows open + in_progress), Completed. Default: Open.
  - Filter-aware empty state messages (e.g., "No open shared action items").
  - Expanded `getMyActionItems` query to return all partnership items (all owners, all statuses) for client-side filtering.
  - Filter types: `DashboardActionItemOwnerFilter`, `DashboardActionItemStatusFilter` in `types.ts`.
  - Unit tests: `src/components/__tests__/dashboard-action-items-list.test.tsx` (17 tests).

### Integration Points

- [x] **P4-INT1**: Wire action item controls into `CheckInActiveView` (P3-U4)
  - Per-question `ActionItemForm` and `ActionItemList` rendered below answers.
  - Add action items during `in_progress` state.
  - Owner selector shows "Me", partner's name, and "Both of us".
  - `page.tsx` fetches action items via `getActionItemsForCheckIn` and passes to views.

- [x] **P4-INT2**: Wire action item display into `CheckInResultsView` (P3-U5)
  - Show action items per question using `ActionItemList`.
  - Status toggle works even in completed check-ins (via `ActionItemCard` optimistic cycle).
  - `page.tsx` conditionally fetches action items for `in_progress` and `completed` states.

### Supporting Code

- [x] **P4-H1**: Action item types definition
  - File: `src/app/(app)/check-ins/types.ts`
  - Types: `ActionItemOwnerType`, `ActionItemStatus`, `ActionItem`, `CreateActionItemInput`, `CheckInStatus`.

- [x] **P4-H2**: Action item validation helper
  - File: `src/app/(app)/check-ins/helpers.ts`
  - `validateActionItemDescription()` -- validates 1-500 chars.

- [x] **P4-H3**: `getActionItemsForCheckIn(checkInId)` query
  - File: `src/app/(app)/check-ins/queries.ts`
  - Fetches all action items for a check-in with owner display names resolved.
  - Returns items ordered by creation date (oldest first).

### Integration Tests

- [x] **P4-T1**: Integration test helpers for action items
  - File: `src/__tests__/integration/helpers.ts`
  - Added: `createTestActionItem()`, `getActionItem()` factory/assertion helpers.
  - Added `actionItems` to `TABLES_IN_DELETE_ORDER`.
  - `createTestCheckIn()` now auto-creates a template if none is provided.

- [x] **P4-T2**: Integration tests for action item actions
  - File: `src/__tests__/integration/action-item-actions.test.ts`
  - Coverage: `createActionItem` (auth, draft guard, completed guard, empty description, long description, question not in check-in, individual owner requires ownerId, owner must be member, both rejects ownerId, success individual, success both, trims whitespace), `updateActionItemStatus` (auth, not found, non-member, completed sets completedAt, in_progress clears completedAt, works on completed check-in), `deleteActionItem` (auth, not found, completed guard, non-member, success removes row).

- [x] **P4-T3**: Unit tests for `ActionItemForm` component
  - File: `src/components/__tests__/action-item-form.test.tsx`

- [x] **P4-T4**: Unit tests for `ActionItemCard` component
  - File: `src/components/__tests__/action-item-card.test.tsx`

- [x] **P4-T5**: Integration tests for `getActionItemsForCheckIn` query
  - File: `src/__tests__/integration/check-in-queries.test.ts`
  - Coverage: resolves owner display names, returns null ownerDisplayName for "both" items, unauthenticated returns empty, empty check-in returns empty, scoped to specific check-in.

### Phase 4 Task Summary

| Task                           | Category    | Effort | Dependencies        | Status  |
| ------------------------------ | ----------- | ------ | ------------------- | ------- |
| P4-S1 actionItems table        | Schema      | Small  | P3-S2, P3-S4        | Done    |
| P4-A1 createActionItem         | Action      | Medium | P4-S1               | Done    |
| P4-A2 updateActionItemStatus   | Action      | Small  | P4-S1               | Done    |
| ~~P4-A3 updateActionItem~~     | Action      | --     | --                  | Dropped |
| P4-A4 deleteActionItem         | Action      | Small  | P4-S1               | Done    |
| P4-A5 getMyActionItems         | Action      | Medium | P4-S1               | Done    |
| P4-U1 ActionItemForm           | UI          | Medium | P4-A1               | Done    |
| P4-U2 ActionItemCard           | UI          | Medium | P4-A2               | Done    |
| P4-U3 ActionItemList           | UI          | Medium | P4-U2               | Done    |
| P4-U4 DashboardActionItems     | UI          | Medium | P4-A5, P4-U3        | Done    |
| P4-U5 DashboardActionItemsList | UI          | Medium | P4-U4, P4-A5        | Done    |
| P4-INT1 Wire into ActiveView   | Integration | Medium | P3-U4, P4-U1, P4-U3 | Done    |
| P4-INT2 Wire into ResultsView  | Integration | Small  | P3-U5, P4-U3        | Done    |
| P4-T1 Test helpers             | Test        | Small  | P4-S1               | Done    |
| P4-T2 Action integration tests | Test        | Medium | P4-A1, P4-A2, P4-A4 | Done    |
| P4-T3 ActionItemForm tests     | Test        | Small  | P4-U1               | Done    |
| P4-T4 ActionItemCard tests     | Test        | Small  | P4-U2               | Done    |
| P4-T5 Query integration tests  | Test        | Small  | P4-H3               | Done    |

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
  - Options: All, Draft, In Progress, Completed.

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

## Cross-cutting: Dashboard Redesign

> Navigation and route groups are complete (see "Completed Phases" above).
> Dashboard redesign depends on Phases 3 and 4 for data.

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

## Cross-cutting: Code Organization Refactoring

- [x] **REFACTOR-1**: Split `check-ins/actions.ts` into domain-specific action files
  - Deleted: `src/app/(app)/check-ins/actions.ts` (monolithic file)
  - Created: `src/app/(app)/check-ins/check-in.actions.ts` -- check-in lifecycle actions (createCheckIn, saveResponse, startCheckIn, completeCheckIn, reopenCheckIn)
  - Created: `src/app/(app)/check-ins/action-item.actions.ts` -- action item CRUD (createActionItem, updateActionItemStatus, deleteActionItem)
  - All UI component imports and test mocks updated to reference the new file paths.

- [x] **REFACTOR-2**: Extract partner view components from `partner-connection.tsx`
  - Created: `src/app/(app)/partner/incoming-invite-view.tsx` -- IncomingInviteView component
  - Created: `src/app/(app)/partner/invite-form-view.tsx` -- InviteFormView component
  - Created: `src/app/(app)/partner/pending-outgoing-view.tsx` -- PendingOutgoingView component
  - `partner-connection.tsx` now imports from the extracted files.

- [x] **REFACTOR-3**: Separate partner types and queries from actions
  - Created: `src/app/(app)/partner/types.ts` -- extracted ActionResult, IncomingInvite, OutgoingInvite, PartnershipStatus types
  - Moved `getPartnershipStatus()` from `actions.ts` to `queries.ts` (query, not a server action)
  - `actions.ts` now only contains mutation server actions (invite, accept, decline, cancel, dissolve)
  - `page.tsx` updated to import `getPartnershipStatus` from `queries.ts`

- [x] **REFACTOR-4**: Partner view component tests
  - Created: `src/app/(app)/partner/__tests__/incoming-invite-view.test.tsx`
  - Created: `src/app/(app)/partner/__tests__/invite-form-view.test.tsx`
  - Created: `src/app/(app)/partner/__tests__/pending-outgoing-view.test.tsx`
  - Created: `src/app/(app)/partner/__tests__/partner-connection.test.tsx`

---

## Cross-cutting: UI Enhancements

- [x] **UI-1**: `FormField` hint prop
  - File: `src/components/ui/form-field.tsx`
  - Added optional `hint` prop for descriptive text below the label.
  - Tests: `src/components/ui/__tests__/form-field.test.tsx` (renders hint, omits when not provided).

- [x] **UI-2**: `CheckInCard` component in check-ins list page
  - File: `src/app/(app)/check-ins/page.tsx`
  - Inline `CheckInCard` component with status badge, question count, and formatted date.
  - Uses `formatCheckInDate` helper for contextual date display (Scheduled/Completed prefix).

---

## Cross-cutting: Partner Confirmation Transitions (Complete)

> All check-in state transitions (start, complete, reopen) require two-person confirmation.
> When one partner initiates a transition, it creates a pending request. The other partner must confirm before the transition executes.
> PRD reference: Section 3 -- Phase 3 (Starting/Completing/Re-opening), Section 7 (State Machine)

### Schema (Complete)

- [x] **PC-S1**: Add `pendingTransition` and `pendingTransitionById` columns to `checkIns` table
  - File: `src/db/schema.ts`
  - `pendingTransition`: nullable text, one of `start`, `complete`, `reopen`. Set when a partner requests a state change; null when no pending request.
  - `pendingTransitionById`: nullable text FK to `users.id`. The user who initiated the pending transition request.

### Types (Complete)

- [x] **PC-T1**: Add `PendingTransition` type and update `CheckInDetail`
  - File: `src/app/(app)/check-ins/types.ts`
  - Added: `PendingTransition = 'start' | 'complete' | 'reopen'`
  - Updated `CheckInDetail` to include `pendingTransition: PendingTransition | null`, `pendingTransitionById: string | null`, `pendingTransitionByName: string | null`, and `partnerDisplayName: string | null`.

### Helpers (Complete)

- [x] **PC-H1**: Update `getCheckInForUser` to return pending transition fields
  - File: `src/app/(app)/check-ins/helpers.ts`
  - Added `pendingTransition` and `pendingTransitionById` to the select and return type.

- [x] **PC-H2**: Add `guardNoPendingTransition` helper
  - File: `src/app/(app)/check-ins/helpers.ts`
  - Returns an error string if there is already a pending transition (prevents double-requests).

### Queries (Complete)

- [x] **PC-Q1**: Update `getCheckIn` to include pending transition data
  - File: `src/app/(app)/check-ins/queries.ts`
  - Added `pendingTransition`, `pendingTransitionById`, and `pendingTransitionByName` to the returned `CheckInDetail`.
  - Resolves the initiator's display name via a left join on profiles.
  - Also added `partnerDisplayName` for use in UI banners.

### Server Actions (Complete)

All in `src/app/(app)/check-ins/check-in.actions.ts`:

- [x] **PC-A1**: Modify `startCheckIn` -- create pending request instead of immediate transition
  - Instead of immediately transitioning, sets `pendingTransition = 'start'` and `pendingTransitionById = userId`.
  - Guard: check-in must be in `draft` state, no existing pending transition.

- [x] **PC-A2**: Modify `completeCheckIn` -- create pending request instead of immediate transition
  - Same pattern: sets `pendingTransition = 'complete'` and `pendingTransitionById = userId`.
  - Guard: check-in must be in `in_progress` state, no existing pending transition.

- [x] **PC-A3**: Modify `reopenCheckIn` -- create pending request instead of immediate transition
  - Same pattern: sets `pendingTransition = 'reopen'` and `pendingTransitionById = userId`.
  - Guard: check-in must be in `completed` state, no existing pending transition.

- [x] **PC-A4**: New `confirmTransition(checkInId)` action
  - Validates the caller is NOT the initiator (i.e., they are the partner).
  - Validates a pending transition exists.
  - Executes the actual state transition based on `pendingTransition` value:
    - `start`: draft -> in_progress, set `startedAt`, mark draft responses visible.
    - `complete`: in_progress -> completed, set `completedAt`.
    - `reopen`: completed -> in_progress, clear `completedAt`.
  - Clears `pendingTransition` and `pendingTransitionById`.

- [x] **PC-A5**: New `cancelTransition(checkInId)` action
  - Validates the caller IS the initiator.
  - Validates a pending transition exists.
  - Clears `pendingTransition` and `pendingTransitionById` without changing status.

### UI Components (Complete)

- [x] **PC-U1**: `PendingTransitionBanner` component
  - File: `src/components/pending-transition-banner.tsx`
  - Two variants based on whether the current user is the initiator:
    - **Initiator view**: Card with `bg-bg-surface` and `border-primary-700`, showing "[icon] Waiting for [partner name] to confirm" with a "Cancel request" ghost button.
    - **Partner view**: Card with `bg-primary-900` border and subtle `shadow-glow`, showing "[partner name] wants to [start/complete/reopen] this check-in" with a primary "Confirm" button and a ghost "Decline" button.
  - Uses design system patterns: card (`rounded-md border bg-bg-surface p-4`), primary badge colors, buttons per design system.
  - Animate entrance with `animate-fade-in`.
  - Tests: `src/components/__tests__/pending-transition-banner.test.tsx`

- [x] **PC-U2**: Update `CheckInDraftView` for pending start requests
  - File: `src/app/(app)/check-ins/[id]/check-in-draft-view.tsx`
  - When `pendingTransition === 'start'` and user is initiator: disable "Start Check-in" button, show initiator banner above button.
  - When `pendingTransition === 'start'` and user is partner: show partner banner prominently near top of page (below header, above questions).

- [x] **PC-U3**: Update `CheckInActiveView` for pending complete requests
  - File: `src/app/(app)/check-ins/[id]/check-in-active-view.tsx`
  - Same pattern for `pendingTransition === 'complete'`.
  - Initiator: disable "Complete Check-in" button, show waiting banner.
  - Partner: show confirmation banner near top.

- [x] **PC-U4**: Update `CheckInResultsView` for pending reopen requests
  - File: `src/app/(app)/check-ins/[id]/check-in-results-view.tsx`
  - Same pattern for `pendingTransition === 'reopen'`.
  - Initiator: disable "Re-open" button, show waiting banner.
  - Partner: show confirmation banner near top.

- [x] **PC-U5**: Update `CheckInStatusBadge` for pending transitions
  - File: `src/components/check-in-status-badge.tsx`
  - Added optional `pendingTransition` prop.
  - When pending, shows additional "Pending" indicator using warning colors.

### Page Updates (Complete)

- [x] **PC-P1**: Update `/check-ins/[id]` page to pass pending transition data
  - File: `src/app/(app)/check-ins/[id]/page.tsx`
  - Passes `pendingTransition` and `pendingTransitionById` from `getCheckIn` result to the view components.
  - Added `export const dynamic = 'force-dynamic'` to prevent caching (page depends on session/auth).

### Integration Tests (Complete)

- [x] **PC-TEST1**: Update existing action integration tests for new pending request behavior
  - File: `src/__tests__/integration/check-in-actions.test.ts`
  - `startCheckIn` now creates a pending request instead of immediate transition.
  - `completeCheckIn` now creates a pending request instead of immediate transition.
  - `reopenCheckIn` now creates a pending request instead of immediate transition.
  - Verifies status does NOT change, `pendingTransition` and `pendingTransitionById` are set.
  - Added tests for rejecting requests when a pending transition already exists.

- [x] **PC-TEST2**: New integration tests for `confirmTransition` and `cancelTransition`
  - File: `src/__tests__/integration/check-in-actions.test.ts`
  - `confirmTransition`: auth, non-member rejection, no pending transition, initiator cannot confirm (must be partner), successful confirm for each transition type (start/complete/reopen) with correct side effects.
  - `cancelTransition`: auth, non-member rejection, no pending transition, non-initiator cannot cancel, successful cancel clears fields.

- [x] **PC-TEST3**: Update view component tests for pending transition banner
  - Files: `src/app/(app)/check-ins/[id]/__tests__/check-in-draft-view.test.tsx`, `check-in-active-view.test.tsx`, `check-in-results-view.test.tsx`
  - Verifies banner renders for initiator and partner perspectives.
  - Verifies button is disabled when pending transition exists.

- [x] **PC-TEST4**: Update helper unit tests for new guard
  - File: `src/app/(app)/check-ins/__tests__/helpers.test.ts`
  - Tests `guardNoPendingTransition`: null returns no error, non-null returns error.

### Task Summary

| Task                          | Category | Effort | Dependencies        | Status |
| ----------------------------- | -------- | ------ | ------------------- | ------ |
| PC-S1 Schema changes          | Schema   | Small  | --                  | Done   |
| PC-T1 Type updates            | Types    | Small  | PC-S1               | Done   |
| PC-H1 Helper updates          | Helpers  | Small  | PC-S1               | Done   |
| PC-H2 New guard               | Helpers  | Small  | PC-S1               | Done   |
| PC-Q1 Query updates           | Query    | Small  | PC-S1               | Done   |
| PC-A1 Modify startCheckIn     | Action   | Medium | PC-S1, PC-H1, PC-H2 | Done   |
| PC-A2 Modify completeCheckIn  | Action   | Medium | PC-S1, PC-H1, PC-H2 | Done   |
| PC-A3 Modify reopenCheckIn    | Action   | Medium | PC-S1, PC-H1, PC-H2 | Done   |
| PC-A4 confirmTransition       | Action   | Medium | PC-S1, PC-H1        | Done   |
| PC-A5 cancelTransition        | Action   | Small  | PC-S1, PC-H1        | Done   |
| PC-U1 PendingTransitionBanner | UI       | Medium | PC-A4, PC-A5        | Done   |
| PC-U2 Update DraftView        | UI       | Small  | PC-U1               | Done   |
| PC-U3 Update ActiveView       | UI       | Small  | PC-U1               | Done   |
| PC-U4 Update ResultsView      | UI       | Small  | PC-U1               | Done   |
| PC-U5 Update StatusBadge      | UI       | Small  | --                  | Done   |
| PC-P1 Update page.tsx         | Page     | Small  | PC-Q1               | Done   |
| PC-TEST1 Update action tests  | Test     | Medium | PC-A1-A3            | Done   |
| PC-TEST2 New action tests     | Test     | Medium | PC-A4, PC-A5        | Done   |
| PC-TEST3 View component tests | Test     | Medium | PC-U2-U4            | Done   |
| PC-TEST4 Helper tests         | Test     | Small  | PC-H1, PC-H2        | Done   |

---

## Cross-cutting: E2E Test Infrastructure

- [x] **E2E-1**: E2E database seed helpers
  - File: `e2e/helpers/db.ts`
  - Added: `seedTemplate()`, `seedTemplateQuestion()`, `seedCheckIn()`, `seedCheckInQuestion()`, `seedCheckInResponse()`, `seedActionItem()`.
  - Updated `truncateAll()` to include check-in related tables (action_items, check_in_responses, check_in_questions, check_ins, template_questions, check_in_templates).
  - `seedCheckIn` supports `pendingTransition` and `pendingTransitionById` fields.

- [x] **E2E-2**: E2E test specs (scaffolded)
  - Created: `e2e/partner-invite.spec.ts` -- partner invitation flow E2E test.
  - Created: `e2e/check-in-lifecycle.spec.ts` -- check-in lifecycle E2E test.
  - Created: `e2e/action-items.spec.ts` -- action items E2E test.

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

| Order | Tasks                                                                 | Phase         | Status |
| ----- | --------------------------------------------------------------------- | ------------- | ------ |
| 1     | P3-U6, P3-U7 (shared components)                                      | 3             | Done   |
| 2     | P3-U1, P3-U2, P3-U4, P3-U5, P3-P1 through P3-P3 (check-in UI + pages) | 3             | Done   |
| 3     | P4-S1, P4-A1 through P4-A5 (action items schema + actions + tests)    | 4             | Done   |
| 4     | P4-U1 through P4-U4, P4-INT1, P4-INT2 (action items UI + integration) | 4             | Done   |
| 4b    | REFACTOR-1 through REFACTOR-4 (code organization + partner tests)     | Cross-cutting | Done   |
| 4c    | PC-S1, PC-T1, PC-H1, PC-H2, PC-Q1 (partner confirm schema + helpers)  | Cross-cutting | Done   |
| 4d    | PC-A1 through PC-A5 (partner confirm actions)                         | Cross-cutting | Done   |
| 4e    | PC-U1 through PC-U5, PC-P1 (partner confirm UI + page)                | Cross-cutting | Done   |
| 4f    | PC-TEST1 through PC-TEST4 (partner confirm tests)                     | Cross-cutting | Done   |
| 4g    | E2E-1, E2E-2 (E2E test infrastructure + specs)                        | Cross-cutting | Done   |
| 5     | DASH-1, DASH-2 (dashboard redesign)                                   | Cross-cutting |        |
| 6     | P5-A1, P5-U1 through P5-U5 (history + search)                         | 5             |        |
| 7     | P6-S1, P6-DEP1, P6-A1, P6-A2 (AI schema + actions)                    | 6             |        |
| 8     | P6-U1 through P6-U3, P6-INT1 (AI UI + integration)                    | 6             |        |
| 9     | NF-1 through NF-8 (non-functional polish)                             | Cross-cutting |        |
