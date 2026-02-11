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

Partnership lifecycle with `partnerships` table (pgEnum: pending/accepted/declined/cancelled/dissolved), unique active pair index. Server actions in `src/app/(app)/partner/actions.ts`: invite, accept, decline, cancel, dissolve, get status. UI: invite form, pending/incoming views, partner card with unlink dialog. Page: `/partner`.

### Phase 2: Check-in Templates

Template system with `checkInTemplates` and `templateQuestions` tables (all questions free text). 3 seeded system templates (Weekly, Monthly Deep Dive, Quick Pulse). CRUD actions + duplicate in `src/app/(app)/templates/actions.ts` and `queries.ts`. Types in `types.ts`, validation helpers in `helpers.ts`, `MAX_QUESTIONS = 20` in `constants.ts`. Full UI: template list, card, form with question builder, detail view. Pages: `/templates`, `/templates/new`, `/templates/[id]`, `/templates/[id]/edit`. Integration tests in `src/__tests__/integration/template-actions.test.ts` and `template-queries.test.ts`.

### Phase 7: Profile Editing (Independent)

Extracted shared profile field components from onboarding wizard to `src/components/profile/` (constants, about-you, love-connection, goals fields). `updateProfile` action in `src/app/(app)/settings/actions.ts`. Single-page `ProfileEditForm` at `/settings/profile`.

### Cross-cutting: Dev Seed Data

Dev seed script (`src/db/seed-dev.ts`, `pnpm db:seed:dev`) creates two test users (Jeremy, Monica), profiles, partnership, and templates. Idempotent with upsert logic. `db:seed` updated to load `.env`.

### Cross-cutting: Navigation & Route Groups

Persistent nav bar (`src/components/nav-bar.tsx`) with desktop top bar and mobile bottom tabs. `(app)` route group layout (`src/app/(app)/layout.tsx`) handles auth/onboarding guards. `(auth)` route group for login/register. Sign-out action in `src/lib/sign-out-action.ts`. Route stubs created for all nav targets.

---

## Phase 3: Check-in Lifecycle (In Progress)

> The core feature. A check-in is an instance of a template that both partners work through together.
> PRD reference: Section 3 -- Phase 3
> Depends on: Phase 2

### Schema (Complete)

- [x] **P3-S1**: `checkInStatusEnum` -- values: `draft`, `scheduled`, `in_progress`, `completed`
- [x] **P3-S2**: `checkIns` table -- `id`, `partnershipId`, `templateId`, `title`, `status`, `scheduledFor`, `startedAt`, `completedAt`, `createdById`, timestamps. Indexes on partnershipId, status, scheduledFor.
- [x] **P3-S3**: `questionTypeEnum` -- Skipped (all free text for now)
- [x] **P3-S4**: `checkInQuestions` table -- copied from template at creation, immutable. Cascade delete from checkIn.
- [x] **P3-S5**: `checkInResponses` table -- unique on `(checkInQuestionId, userId)`, `isDraft` flag.

All schema in `src/db/schema.ts`.

### Server Actions (Complete)

- [x] **P3-A1**: `createCheckIn(data)` -- from template (required), copies questions, sets draft/scheduled
- ~~P3-A2 through P3-A5~~ -- Dropped (questions locked from template)
- [x] **P3-A6**: `saveResponse(questionId, text)` -- upsert, isDraft by status, max 5k chars
- [x] **P3-A7**: `startCheckIn` -- draft/scheduled -> in_progress, marks responses visible
- [x] **P3-A8**: `completeCheckIn` -- in_progress -> completed, sets completedAt
- [x] **P3-A9**: `reopenCheckIn` -- completed -> in_progress, clears completedAt
- [x] **P3-A10**: `getCheckIn(id)` -- with questions/responses, privacy filtering by status
- [x] **P3-A11**: `getCheckIns()` -- list for partnership, ordered by most recent

All actions in `src/app/(app)/check-ins/actions.ts`, queries in `src/app/(app)/check-ins/queries.ts`.

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

- [ ] **P3-U1**: `CreateCheckInForm` -- Template selector (required), optional title override, optional schedule picker
  - File: `src/app/(app)/check-ins/new/create-check-in-form.tsx` (new)
  - Lists available templates (system + custom). A template must be selected.
  - Title input (defaults to template name + date).
  - Optional date/time picker for scheduling.

- [ ] **P3-U2**: `CheckInDraftView` -- Question list with answer inputs (questions are read-only)
  - File: `src/app/(app)/check-ins/[id]/check-in-draft-view.tsx` (new)
  - Shows questions in order. Each has a textarea answer input.
  - Questions are read-only (copied from template, no editing controls).
  - Progress indicator: "You: 3/5 answered. Partner: 2/5 answered." (count only, no content).
  - "Start Check-in" button with confirmation dialog.

- ~~**P3-U3**: `CheckInQuestionEditor`~~ -- Dropped. Questions are locked from template.

- [ ] **P3-U4**: `CheckInActiveView` -- Side-by-side answer display during in_progress state
  - File: `src/app/(app)/check-ins/[id]/check-in-active-view.tsx` (new)
  - Questions displayed in order. For each question:
    - Partner A's answer (labeled with display name).
    - Partner B's answer (labeled with display name).
    - Own answer is editable. Partner's is read-only.
  - On mobile (< 768px): answers stack vertically instead of side-by-side.
  - Auto-save: debounced (1 second after typing stops), optimistic UI.
  - Action item controls per question (Phase 4).
  - "Complete Check-in" button.

- [ ] **P3-U5**: `CheckInResultsView` -- Read-only summary of completed check-in
  - File: `src/app/(app)/check-ins/[id]/check-in-results-view.tsx` (new)
  - Header: title, template name, completion date.
  - Questions listed with both partners' answers side-by-side.
  - Action items section.
  - "Re-open" button.
  - "Summarize with AI" button (Phase 6 placeholder).

- [x] **P3-U6**: `CheckInStatusBadge` -- Visual indicator of check-in state
  - File: `src/components/check-in-status-badge.tsx`
  - States: draft, scheduled, in progress, completed.
  - Uses both color and text (not color alone, per accessibility requirements).
  - Tests: `src/components/__tests__/check-in-status-badge.test.tsx`

- [x] **P3-U7**: `ResponseInput` -- Textarea input component for answering questions
  - File: `src/components/response-input.tsx`
  - Textarea with character counter (max 5,000).
  - Supports auto-save via `onAutoSave` callback with 1s debounce.
  - Tests: `src/components/__tests__/response-input.test.tsx`

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

### Supporting Code

- [x] **P3-H1**: Shared partnership helpers extracted to `src/lib/partnership.ts`
  - `getActivePartnership(userId)` and `isPartnershipMember(partnershipId, userId)`.
  - Previously in `src/app/(app)/templates/helpers.ts`; now re-exported from there for backward compatibility.

- [x] **P3-H2**: Check-in types definition
  - File: `src/app/(app)/check-ins/types.ts`
  - Types: `ActionResult`, `CreateCheckInInput`, `CheckInListItem`, `CheckInQuestion`, `CheckInResponse`, `CheckInDetail`.

- [x] **P3-H3**: Check-in helpers
  - File: `src/app/(app)/check-ins/helpers.ts`
  - Helpers: `getCheckInForUser()`, `guardDraftOrScheduled()`, `guardCanRespond()`, `guardInProgress()`, `guardCompleted()`, `validateTitle()`, `validateResponseText()`.

### Integration Tests

- [x] **P3-T1**: Integration test helpers for check-ins
  - File: `src/__tests__/integration/helpers.ts`
  - Added: `createTestCheckIn()`, `createTestCheckInQuestion()`, `createTestCheckInResponse()`, `getCheckIn()`, `getCheckInQuestions()`, `getCheckInResponses()` factory/assertion helpers.
  - Updated `TABLES_IN_DELETE_ORDER` to include `checkInResponses`, `checkInQuestions`, and `checkIns`.

- [x] **P3-T2**: Integration tests for check-in actions
  - File: `src/__tests__/integration/check-in-actions.test.ts`
  - Coverage: `createCheckIn` (happy path, custom title, default title, scheduled status, draft status, auth, partnership, template not found, empty template, title validation), `saveResponse` (new response, upsert, isDraft by status, auth, question not found, membership, completed guard, response length), `startCheckIn` (draft->in_progress, marks drafts visible, auth, membership, already started, already completed), `completeCheckIn` (in_progress->completed, auth, membership, draft guard, completed guard), `reopenCheckIn` (completed->in_progress, clears completedAt, auth, membership, draft guard, in_progress guard).

- [x] **P3-T3**: Integration tests for check-in queries
  - File: `src/__tests__/integration/check-in-queries.test.ts`
  - Coverage: `getCheckIn` (member access with questions/responses, draft privacy filtering, in_progress shows both, displayName included, non-member rejection, auth), `getCheckIns` (ordering by most recent, questionCount, empty partnership, auth, no partnership).

- [x] **P3-T4**: Unit tests for check-in helpers
  - File: `src/app/(app)/check-ins/__tests__/helpers.test.ts`
  - Coverage: `guardDraftOrScheduled` (accepts draft/scheduled, rejects in_progress/completed), `guardCanRespond` (accepts draft/scheduled/in_progress, rejects completed), `guardInProgress` (accepts in_progress, rejects others), `guardCompleted` (accepts completed, rejects others), `validateTitle` (valid, boundary 200 chars, empty, whitespace, over limit, trimming), `validateResponseText` (empty, boundary 5000 chars, over limit).

### Phase 3 Remaining Tasks

| Task                         | Category | Effort | Dependencies        | Status |
| ---------------------------- | -------- | ------ | ------------------- | ------ |
| P3-U1 CreateCheckInForm      | UI       | Medium | P2-A5, P3-A1        |        |
| P3-U2 CheckInDraftView       | UI       | Medium | P3-A6, P3-U7        |        |
| P3-U4 CheckInActiveView      | UI       | Large  | P3-A6, P3-U7        |        |
| P3-U5 CheckInResultsView     | UI       | Medium | P3-A10              |        |
| P3-U6 CheckInStatusBadge     | UI       | Small  | --                  | Done   |
| P3-U7 ResponseInput          | UI       | Small  | --                  | Done   |
| P3-P1 /check-ins page        | Page     | Small  | P3-A11, P3-U6       |        |
| P3-P2 /check-ins/new page    | Page     | Small  | P3-U1               |        |
| P3-P3 /check-ins/[id] page   | Page     | Medium | P3-U2, P3-U4, P3-U5 |        |

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

| Order | Tasks                                                                   | Phase         |
| ----- | ----------------------------------------------------------------------- | ------------- |
| 1     | P3-U6, P3-U7 (shared components)                                       | 3             |
| 2     | P3-U1, P3-U2, P3-U4, P3-U5, P3-P1 through P3-P3 (check-in UI + pages) | 3             |
| 3     | P4-S1, P4-A1 through P4-A5 (action items schema + actions)             | 4             |
| 4     | P4-U1 through P4-U4, P4-INT1, P4-INT2 (action items UI + integration)  | 4             |
| 5     | DASH-1, DASH-2 (dashboard redesign)                                     | Cross-cutting |
| 6     | P5-A1, P5-U1 through P5-U5 (history + search)                          | 5             |
| 7     | P6-S1, P6-DEP1, P6-A1, P6-A2 (AI schema + actions)                     | 6             |
| 8     | P6-U1 through P6-U3, P6-INT1 (AI UI + integration)                     | 6             |
| 9     | NF-1 through NF-8 (non-functional polish)                               | Cross-cutting |
