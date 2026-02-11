# Sync -- Product Requirements Document

## Table of Contents

- [1. Product Overview](#1-product-overview)
- [2. User Personas and Journeys](#2-user-personas-and-journeys)
- [3. Implementation Phases](#3-implementation-phases)
  - [Phase 1: Partner Connection](#phase-1-partner-connection)
  - [Phase 2: Check-in Templates](#phase-2-check-in-templates)
  - [Phase 3: Check-in Lifecycle](#phase-3-check-in-lifecycle)
  - [Phase 4: Action Items](#phase-4-action-items)
  - [Phase 5: Check-in History and Search](#phase-5-check-in-history-and-search)
  - [Phase 6: AI Summarization](#phase-6-ai-summarization)
  - [Phase 7: Profile Editing](#phase-7-profile-editing)
- [4. Data Model](#4-data-model)
- [5. Server Actions](#5-server-actions)
- [6. Page Structure and Routing](#6-page-structure-and-routing)
- [7. Check-in State Machine](#7-check-in-state-machine)
- [8. Non-functional Requirements](#8-non-functional-requirements)

---

## 1. Product Overview

### Vision

Sync is a relationship check-in app that helps couples communicate intentionally. Instead of letting issues pile up or hoping problems resolve on their own, Sync gives partners a structured space to reflect, share, and follow through -- together.

### Target Users

Couples in committed relationships (dating, engaged, married) who want to:

- Build a regular habit of open communication
- Address concerns before they become conflicts
- Track commitments they make to each other
- Reflect on how their relationship is evolving over time

### Core Value Proposition

1. **Structured reflection** -- Templates with thoughtful questions remove the awkwardness of "we need to talk"
2. **Mutual accountability** -- Action items with clear owners ensure follow-through
3. **Longitudinal insight** -- Check-in history and AI summaries reveal patterns across weeks and months
4. **Private and safe** -- Each partner drafts answers independently before sharing, eliminating pressure to perform in the moment

### Current State

The following features are already shipped:

| Feature                     | Status | Key Files             |
| --------------------------- | ------ | --------------------- |
| Email/password registration | Done   | `src/app/register/`   |
| Email/password login        | Done   | `src/app/login/`      |
| Onboarding wizard (3 steps) | Done   | `src/app/onboarding/` |
| Minimal dashboard           | Done   | `src/app/page.tsx`    |
| User profiles table         | Done   | `src/db/schema.ts`    |

Tech stack: Next.js 15, NextAuth v5 (JWT sessions), Drizzle ORM, PostgreSQL, Tailwind CSS v4 (dark purple theme).

---

## 2. User Personas and Journeys

### Primary Persona: Alex and Jordan

Alex and Jordan have been together for two years. They communicate well day-to-day but notice that deeper topics -- finances, future plans, emotional needs -- get deferred. They want a low-pressure way to regularly check in.

### End-to-End Journey

```
Register --> Onboarding --> Connect Partner --> Create/Pick Template --> Schedule Check-in
    --> Draft Answers --> Start Check-in --> Review & Discuss --> Add Action Items
    --> Complete --> View Results --> AI Summary --> Track Action Items
```

**Detailed flow:**

1. **Alex registers** with email and password, completes the 3-step onboarding (display name, love language, goals).
2. **Alex invites Jordan** by entering Jordan's email on the dashboard.
3. **Jordan logs in** (they must already have an account), sees a pending invite on their dashboard, and accepts.
4. **Alex creates a check-in** from the "Weekly Check-in" default template, scheduled for Sunday at 7 PM.
5. **Both partners draft answers** independently before Sunday. Neither can see the other's drafts.
6. **Sunday arrives** -- Alex starts the check-in, transitioning it to "in progress."
7. **During the check-in**, both partners can see each other's answers, edit their own, and fill in anything they skipped.
8. **They add action items** for specific questions (e.g., "Plan a date night this week" assigned to Jordan).
9. **Alex marks the check-in as complete.** Both partners see the full results: answers side by side plus action items.
10. **Jordan taps "Summarize with AI"** to get key themes and suggested follow-ups.
11. **Over the following week**, they check off action items as they complete them.
12. **The next Sunday**, they start a new check-in and can reference past results for context.

---

## 3. Implementation Phases

### Phase Dependency Graph

```
Phase 1 (Partner Connection)
    |
    v
Phase 2 (Check-in Templates)
    |
    v
Phase 3 (Check-in Lifecycle)
    |
    v
Phase 4 (Action Items)
    |
    v
Phase 5 (History & Search)
    |
    v
Phase 6 (AI Summarization)

Phase 7 (Profile Editing) -- independent, can be built at any time
```

---

### Phase 1: Partner Connection

#### Overview

Partners must be linked before any check-in features are useful. This phase introduces the partnership system: inviting a partner by email, accepting/declining invites, and dissolving a partnership.

#### Constraints

- A user can have **at most one active partnership** at a time.
- A user cannot invite themselves.
- A user with an active partnership cannot send or receive new invites.
- The invitee must already have a registered account. Inviting unregistered users is not supported.

#### User Stories

| ID   | Story                                                                          | Acceptance Criteria                                                                                                                 |
| ---- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | As a user, I can invite my partner by entering their email                     | The email must belong to a registered user. System creates a pending invite and the invitee sees it on their dashboard immediately. |
| P1-2 | As a user, I can see a pending invite on my dashboard                          | Invite card shows inviter's display name, email, and accept/decline buttons.                                                        |
| P1-3 | As a user, I can accept a partnership invite                                   | Both users are now linked. The invite card is replaced with a partner card showing partner info.                                    |
| P1-4 | As a user, I can decline a partnership invite                                  | The invite is removed. The inviter sees a "declined" status and can invite someone else.                                            |
| P1-5 | As a user, I can dissolve my active partnership                                | Both users are unlinked. All existing check-in data is retained but read-only.                                                      |
| P1-6 | As a user, I cannot invite a second partner while I have an active partnership | The invite form is hidden or disabled when a partnership is active.                                                                 |

#### Invite Flow

1. User navigates to dashboard (or `/partner`).
2. If no active partnership and no pending outgoing invite:
   - Display an "Invite your partner" form with an email input.
3. User enters partner's email and submits.
4. Server validates:
   - Email is not the user's own email.
   - User does not already have an active partnership.
   - User does not already have a pending outgoing invite.
   - The target email belongs to a registered user.
   - The target user does not already have an active partnership.
5. Server creates a `partnerships` row with `status: 'pending'`, storing the invitee's `userId` in `inviteeId`.
6. Dashboard updates to show "Invite sent to [email]. Waiting for response."

#### Accept/Decline Flow

1. Invitee logs in and sees the pending invite on their dashboard.
2. **Accept**: Status changes to `accepted`. Both users' dashboards now show partner info.
3. **Decline**: Status changes to `declined`. Inviter is freed to send a new invite.

#### Dissolution Flow

1. Either partner can choose to disconnect.
2. A confirmation dialog is shown: "Are you sure? Your check-in history will be preserved but you will no longer be able to create new check-ins together."
3. On confirm, partnership status changes to `dissolved`.
4. Both users return to the unpartnered dashboard state.

#### Database: `partnerships` Table

| Column       | Type          | Notes                                                               |
| ------------ | ------------- | ------------------------------------------------------------------- |
| `id`         | `text` (UUID) | Primary key                                                         |
| `inviter_id` | `text`        | FK to `users.id`, NOT NULL                                          |
| `invitee_id` | `text`        | FK to `users.id`, NOT NULL                                          |
| `status`     | `text`        | One of: `pending`, `accepted`, `declined`, `cancelled`, `dissolved` |
| `created_at` | `timestamp`   | Default: now                                                        |
| `updated_at` | `timestamp`   | Default: now                                                        |

**Indexes:**

- Unique constraint: only one `accepted` partnership per user (enforced in application logic).
- Index on `inviter_id` and `invitee_id` for dashboard queries.

#### UI Components

- **InvitePartnerForm**: Email input + submit button. Shown when user has no active partnership or pending outgoing invite.
- **PendingInviteOutgoing**: Card showing "Invite sent to [email]" with a cancel button.
- **PendingInviteIncoming**: Card showing inviter info with accept/decline buttons.
- **PartnerCard**: Shows partner's display name, pronouns, and a "Disconnect" button.
- **DisconnectConfirmDialog**: Modal confirming dissolution.

---

### Phase 2: Check-in Templates

#### Overview

Templates define the structure of a check-in: a name, an optional description, and an ordered list of questions. The system provides sensible defaults, and users can create their own.

#### System Default Templates

**Weekly Check-in** (5 questions):

1. "How are you feeling about us this week?" (free text)
2. "What's something I did this week that you appreciated?" (free text)
3. "Is there anything that's been on your mind that you'd like to discuss?" (free text)
4. "How connected have you felt to me this week?" (scale 1-10)
5. "What's one thing we can do together this coming week?" (free text)

**Monthly Deep Dive** (7 questions):

1. "How would you describe the overall state of our relationship this month?" (free text)
2. "What was the highlight of our month together?" (free text)
3. "Is there an unresolved issue we need to revisit?" (free text)
4. "How satisfied are you with our communication this month?" (scale 1-10)
5. "How satisfied are you with our intimacy and connection this month?" (scale 1-10)
6. "What's one goal you'd like us to work on next month?" (free text)
7. "Is there anything you need from me that you haven't asked for?" (free text)

**Quick Pulse** (3 questions):

1. "One word to describe how you're feeling right now?" (free text)
2. "Anything you need from me today?" (free text)
3. "How connected do you feel to me right now?" (scale 1-10)

System templates are **read-only**. Users can duplicate them to create editable copies.

#### Custom Templates

Users can create templates from scratch or by duplicating a system template. Either partner in a partnership can create templates; templates are shared within the partnership.

#### Question Types

| Type              | Description                    | Response Format                      |
| ----------------- | ------------------------------ | ------------------------------------ |
| `free_text`       | Open-ended question            | Free-form text response              |
| `scale`           | Numeric scale rating           | Integer from 1 to 10                 |
| `multiple_choice` | Select from predefined options | One selection from a list of options |

#### User Stories

| ID  | Story                                        | Acceptance Criteria                                                                       |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| T1  | As a user, I can browse available templates  | List shows system defaults and any custom templates for my partnership.                   |
| T2  | As a user, I can view a template's questions | Detail view shows all questions in order with their types.                                |
| T3  | As a user, I can create a custom template    | Form for name, description, and adding/reordering questions.                              |
| T4  | As a user, I can edit a custom template      | Can modify name, description, add/remove/reorder questions. Cannot edit system templates. |
| T5  | As a user, I can delete a custom template    | Confirmation dialog. Cannot delete if a check-in is currently using this template.        |
| T6  | As a user, I can duplicate a system template | Creates an editable copy with "(Copy)" appended to the name.                              |

#### Template Creation Flow

1. User navigates to `/templates/new`.
2. Enters template name (required) and description (optional).
3. Adds questions one at a time:
   - Enter question text.
   - Select question type (free text, scale, or multiple choice).
   - If multiple choice, enter options (minimum 2).
   - Questions appear in a sortable list; user can drag to reorder.
4. Saves the template. Minimum 1 question required.

#### Database: `check_in_templates` Table

| Column           | Type          | Notes                                                         |
| ---------------- | ------------- | ------------------------------------------------------------- |
| `id`             | `text` (UUID) | Primary key                                                   |
| `partnership_id` | `text`        | FK to `partnerships.id`, nullable (null for system templates) |
| `created_by_id`  | `text`        | FK to `users.id`, nullable (null for system templates)        |
| `name`           | `text`        | NOT NULL                                                      |
| `description`    | `text`        | Nullable                                                      |
| `is_system`      | `boolean`     | Default: false. True for system-provided templates.           |
| `created_at`     | `timestamp`   | Default: now                                                  |
| `updated_at`     | `timestamp`   | Default: now                                                  |

#### Database: `template_questions` Table

| Column          | Type          | Notes                                                               |
| --------------- | ------------- | ------------------------------------------------------------------- |
| `id`            | `text` (UUID) | Primary key                                                         |
| `template_id`   | `text`        | FK to `check_in_templates.id`, NOT NULL, cascade delete             |
| `question_text` | `text`        | NOT NULL                                                            |
| `question_type` | `text`        | One of: `free_text`, `scale`, `multiple_choice`                     |
| `options`       | `text`        | JSON-stringified array of strings. Only used for `multiple_choice`. |
| `is_required`   | `boolean`     | Default: true                                                       |
| `order_index`   | `integer`     | NOT NULL, determines display order                                  |
| `created_at`    | `timestamp`   | Default: now                                                        |

#### UI Components

- **TemplateList**: Grid/list of available templates with system badge on defaults.
- **TemplateCard**: Shows name, description preview, question count, and actions (view, edit, duplicate, delete).
- **TemplateForm**: Create/edit form with name, description, and question builder.
- **QuestionBuilder**: Sortable list of questions with type selector and options editor for multiple choice.
- **TemplateDetail**: Read-only view of a template's questions.

---

### Phase 3: Check-in Lifecycle

#### Overview

This is the core feature. A check-in is an instance of a template (or a custom set of questions) that both partners work through together. Check-ins have a well-defined lifecycle managed by a state machine.

#### Check-in States

See [Section 7: Check-in State Machine](#7-check-in-state-machine) for the full state diagram.

| State         | Description                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `draft`       | Check-in created, questions defined. Partners can draft answers privately.                            |
| `scheduled`   | Check-in has a future date/time. Behaves like `draft` until then.                                     |
| `in_progress` | Check-in is active. Both partners can see each other's answers, edit their own, and add action items. |
| `completed`   | Check-in is finished. Results view is available. Answers are read-only.                               |

#### User Stories

| ID  | Story                                                               | Acceptance Criteria                                                                                                                     |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | As a user, I can create a check-in from a template                  | Questions are copied from the template. Check-in starts in `draft` state.                                                               |
| C2  | As a user, I can schedule a check-in for a specific date and time   | Check-in enters `scheduled` state. Date/time is displayed on the dashboard.                                                             |
| C3  | As a user, I can draft answers before the check-in starts           | In `draft` or `scheduled` state, I can write answers. My partner cannot see them yet.                                                   |
| C4  | As a user, I can start a check-in                                   | Transitions from `draft` or `scheduled` to `in_progress`. Both partners' answers become visible.                                        |
| C5  | As a user, I can answer questions during an active check-in         | In `in_progress` state, I can type or update my responses.                                                                              |
| C6  | As a user, I can see my partner's answers during an active check-in | Both sets of answers are shown side by side per question.                                                                               |
| C7  | As a user, I can complete a check-in                                | Transitions to `completed`. Results summary is shown.                                                                                   |
| C8  | As a user, I can re-open a completed check-in                       | Transitions back to `in_progress`. Answers become editable again.                                                                       |
| C9  | As a user, I can view the results of a completed check-in           | Shows all questions with both partners' answers and any action items.                                                                   |
| C10 | As a user, I can add custom questions to a check-in                 | In `draft` or `scheduled` state, I can add new questions with a type and optional options. New questions appear at the end of the list. |
| C11 | As a user, I can edit a question on a check-in                      | In `draft` or `scheduled` state, I can edit the question text, type, options, and required flag of any question.                        |
| C12 | As a user, I can remove a question from a check-in                  | In `draft` or `scheduled` state, I can remove any question. Removal deletes associated draft responses. A confirmation dialog is shown. |
| C13 | As a user, I can reorder questions on a check-in                    | In `draft` or `scheduled` state, I can drag questions to reorder them. Order indexes are updated accordingly.                           |

#### Creating a Check-in

1. User navigates to `/check-ins/new`.
2. Selects a template from the list (or "Blank check-in" to start with no questions).
3. If using a template, questions are **copied** into the check-in (so template changes don't affect existing check-ins).
4. Optionally sets a scheduled date/time.
5. Saves. Check-in enters `draft` (or `scheduled` if a date was provided).

#### Customizing Questions

While a check-in is in `draft` or `scheduled` state, either partner can modify the question list:

- **Add a question**: Click "Add question" at the bottom of the question list. Specify question text, type (free text, scale, or multiple choice), and whether it is required. The question is appended to the end.
- **Edit a question**: Click the edit icon on any question to modify its text, type, options (for multiple choice), or required flag. If a draft response already exists for that question, it is preserved (the user can re-answer if the question changed substantially).
- **Remove a question**: Click the delete icon on any question. A confirmation dialog is shown. Removing a question also deletes any draft responses associated with it.
- **Reorder questions**: Drag questions to rearrange them. The `order_index` values are updated.

Once a check-in moves to `in_progress`, questions are **locked** -- no adding, editing, removing, or reordering. This ensures both partners are answering the same set of questions. If questions need to change after starting, the check-in must be re-opened as a new draft (not supported -- the user should create a new check-in instead).

#### Drafting Answers

- Available in `draft` and `scheduled` states.
- Each partner can write answers to any question.
- Drafts are saved automatically (debounced auto-save, 1 second after typing stops).
- Drafts are **private** -- your partner cannot see your answers until the check-in transitions to `in_progress`.
- A progress indicator shows how many questions each partner has answered (without revealing content). E.g., "You: 3/5 answered. Partner: 2/5 answered."

#### Starting a Check-in

- Either partner can transition the check-in to `in_progress`.
- A confirmation dialog warns: "Starting this check-in will make all drafted answers visible to both partners. Continue?"
- All existing draft responses are marked as visible.
- A `started_at` timestamp is recorded.

#### In-Progress Experience

- Questions are displayed in order.
- For each question, both partners' answers are shown side by side (or stacked on mobile).
- Partners can:
  - Edit their own answers.
  - Answer questions they haven't responded to yet.
  - Add action items per question (see Phase 4).
- Changes save automatically.

#### Completing a Check-in

- Either partner can mark the check-in as `completed`.
- A `completed_at` timestamp is recorded.
- Answers become read-only.
- The results view is displayed.

#### Re-opening a Check-in

- Either partner can re-open a `completed` check-in.
- The check-in transitions back to `in_progress`.
- Answers become editable again.
- `completed_at` is cleared.

#### Results View

Displayed when a check-in is in `completed` state (also accessible from history):

- **Header**: Check-in title, template name, completion date.
- **Questions**: Listed in order. Each shows:
  - The question text.
  - Partner A's answer (labeled with display name).
  - Partner B's answer (labeled with display name).
  - Any action items for this question.
- **Summary section**: Overall action items with status and owners.
- **AI Summarize button** (Phase 6).

#### Database: `check_ins` Table

| Column           | Type          | Notes                                                                  |
| ---------------- | ------------- | ---------------------------------------------------------------------- |
| `id`             | `text` (UUID) | Primary key                                                            |
| `partnership_id` | `text`        | FK to `partnerships.id`, NOT NULL                                      |
| `template_id`    | `text`        | FK to `check_in_templates.id`, nullable (null if created from scratch) |
| `title`          | `text`        | NOT NULL. Defaults to template name + date.                            |
| `status`         | `text`        | One of: `draft`, `scheduled`, `in_progress`, `completed`               |
| `scheduled_for`  | `timestamp`   | Nullable. The date/time the check-in is planned for.                   |
| `started_at`     | `timestamp`   | Nullable. When the check-in transitioned to `in_progress`.             |
| `completed_at`   | `timestamp`   | Nullable. When the check-in was marked complete.                       |
| `created_by_id`  | `text`        | FK to `users.id`, NOT NULL                                             |
| `created_at`     | `timestamp`   | Default: now                                                           |
| `updated_at`     | `timestamp`   | Default: now                                                           |

**Indexes:**

- Index on `partnership_id` for listing a partnership's check-ins.
- Index on `status` for filtering.
- Index on `scheduled_for` for upcoming check-ins queries.

#### Database: `check_in_questions` Table

| Column          | Type          | Notes                                                                                               |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `id`            | `text` (UUID) | Primary key                                                                                         |
| `check_in_id`   | `text`        | FK to `check_ins.id`, NOT NULL, cascade delete                                                      |
| `question_text` | `text`        | NOT NULL (copied from template at creation time, or written by user for custom questions)           |
| `question_type` | `text`        | One of: `free_text`, `scale`, `multiple_choice`                                                     |
| `options`       | `text`        | JSON-stringified array. Only for `multiple_choice`.                                                 |
| `is_required`   | `boolean`     | Default: true                                                                                       |
| `order_index`   | `integer`     | NOT NULL                                                                                            |
| `created_by_id` | `text`        | FK to `users.id`, nullable. Null for questions copied from templates; set for user-added questions. |

Questions can be added, edited, removed, and reordered while the check-in is in `draft` or `scheduled` state. Once the check-in transitions to `in_progress`, questions are locked.

#### Database: `check_in_responses` Table

| Column                 | Type          | Notes                                                             |
| ---------------------- | ------------- | ----------------------------------------------------------------- |
| `id`                   | `text` (UUID) | Primary key                                                       |
| `check_in_question_id` | `text`        | FK to `check_in_questions.id`, NOT NULL, cascade delete           |
| `user_id`              | `text`        | FK to `users.id`, NOT NULL                                        |
| `response_text`        | `text`        | The answer content                                                |
| `is_draft`             | `boolean`     | Default: true. Set to false when check-in moves to `in_progress`. |
| `created_at`           | `timestamp`   | Default: now                                                      |
| `updated_at`           | `timestamp`   | Default: now                                                      |

**Constraints:**

- Unique constraint on (`check_in_question_id`, `user_id`) -- one response per user per question.

#### UI Components

- **CreateCheckInForm**: Template selector, optional title override, optional schedule picker.
- **CheckInDraftView**: Question list with answer inputs, question management controls (add, edit, remove, reorder). Progress indicator. "Start Check-in" button.
- **CheckInQuestionEditor**: Inline form for adding or editing a question (text input, type selector, options builder for multiple choice, required toggle).
- **CheckInActiveView**: Side-by-side answer display per question. Editable own answers. Action item controls. Questions are locked (no editing).
- **CheckInResultsView**: Read-only summary of all answers and action items. Re-open and AI summarize buttons.
- **CheckInStatusBadge**: Visual indicator of check-in state (draft, scheduled, in progress, completed).

---

### Phase 4: Action Items

#### Overview

During an active check-in, partners can create action items tied to specific questions. Action items have an owner (one of the two partners), a description, and a status. They appear in the check-in results and can be tracked independently.

#### User Stories

| ID  | Story                                                                       | Acceptance Criteria                                                                              |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A1  | As a user, I can add an action item to a question during an active check-in | Action item appears under the question with owner selector.                                      |
| A2  | As a user, I can assign an action item to myself or my partner              | Owner is shown by display name.                                                                  |
| A3  | As a user, I can set an optional due date for an action item                | Date picker input on the action item.                                                            |
| A4  | As a user, I can mark an action item as complete                            | Status changes to `completed`. Shown with strikethrough or checkmark.                            |
| A5  | As a user, I can view all my action items across check-ins                  | Action items dashboard/section on the main dashboard.                                            |
| A6  | As a user, I can edit or delete an action item                              | Only while the check-in is `in_progress`. In `completed` state, only status changes are allowed. |

#### Action Item Lifecycle

1. **Created** during `in_progress` check-in. Status: `open`.
2. **In progress** -- partner has started working on it. Status: `in_progress`.
3. **Completed** -- partner has finished it. Status: `completed`.

Status changes can happen at any time, regardless of check-in state.

#### Database: `action_items` Table

| Column                 | Type          | Notes                                                        |
| ---------------------- | ------------- | ------------------------------------------------------------ |
| `id`                   | `text` (UUID) | Primary key                                                  |
| `check_in_id`          | `text`        | FK to `check_ins.id`, NOT NULL                               |
| `check_in_question_id` | `text`        | FK to `check_in_questions.id`, NOT NULL                      |
| `description`          | `text`        | NOT NULL                                                     |
| `owner_id`             | `text`        | FK to `users.id`, NOT NULL                                   |
| `created_by_id`        | `text`        | FK to `users.id`, NOT NULL                                   |
| `status`               | `text`        | One of: `open`, `in_progress`, `completed`. Default: `open`. |
| `due_date`             | `timestamp`   | Nullable                                                     |
| `completed_at`         | `timestamp`   | Nullable. Set when status changes to `completed`.            |
| `created_at`           | `timestamp`   | Default: now                                                 |
| `updated_at`           | `timestamp`   | Default: now                                                 |

**Indexes:**

- Index on `check_in_id` for loading action items with a check-in.
- Index on `owner_id` for "my action items" queries.
- Index on `status` for filtering open items.

#### UI Components

- **ActionItemForm**: Inline form under a question to add an action item (description, owner selector, optional due date).
- **ActionItemCard**: Shows description, owner name, status badge, due date. Click to toggle status.
- **ActionItemList**: Aggregated view of all action items for a check-in or for a user.
- **DashboardActionItems**: Widget on the main dashboard showing open action items assigned to the current user.

---

### Phase 5: Check-in History and Search

#### Overview

Partners can browse their complete check-in history, search across check-in content, and filter by status and date range.

#### User Stories

| ID  | Story                                                       | Acceptance Criteria                                                          |
| --- | ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| H1  | As a user, I can view a chronological list of all check-ins | List shows title, date, status badge, and question count. Most recent first. |
| H2  | As a user, I can search check-in history by keyword         | Searches across question text, responses, and action item descriptions.      |
| H3  | As a user, I can filter check-ins by status                 | Dropdown or toggle for: all, draft, scheduled, in progress, completed.       |
| H4  | As a user, I can filter check-ins by date range             | Date range picker filters the list.                                          |
| H5  | As a user, I can click a check-in to view its details       | Navigates to the check-in detail page.                                       |

#### Search Implementation

- **Server-side search** using PostgreSQL `ILIKE` queries across:
  - `check_ins.title`
  - `check_in_questions.question_text`
  - `check_in_responses.response_text`
  - `action_items.description`
- Results are grouped by check-in, with matching snippets highlighted.
- Search is scoped to the current user's partnership.

#### UI Components

- **CheckInHistoryList**: Paginated list of check-ins with infinite scroll or pagination.
- **SearchBar**: Text input with debounced search (300ms).
- **StatusFilter**: Dropdown or pill toggle for filtering by status.
- **DateRangeFilter**: Two date inputs for start/end date range.
- **CheckInHistoryCard**: Summary card for each check-in showing title, date, status, question count, and action item count.

---

### Phase 6: AI Summarization

#### Overview

After completing a check-in, either partner can request an AI-generated summary. The summary analyzes both partners' responses and action items to surface key themes, areas of alignment, areas of potential concern, and suggested follow-ups.

#### User Stories

| ID  | Story                                                          | Acceptance Criteria                                                                                                  |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| AI1 | As a user, I can request an AI summary of a completed check-in | "Summarize" button on the results page. Shows loading state while generating.                                        |
| AI2 | As a user, I can view the AI-generated summary                 | Summary includes: overview paragraph, key themes, areas of alignment, areas for attention, and suggested follow-ups. |
| AI3 | As a user, I can regenerate a summary                          | If the summary feels off, the user can request a fresh one.                                                          |
| AI4 | As a user, I can view previously generated summaries           | Summaries are persisted and displayed without re-generating.                                                         |

#### AI Prompt Design

The system prompt will include:

- Context about the app's purpose (relationship check-ins).
- The partnership's profile data (love languages, goals) for personalization.
- All questions and both partners' responses.
- All action items with owners and statuses.

The response schema:

```json
{
  "overview": "A 2-3 sentence summary of the check-in.",
  "themes": ["Theme 1", "Theme 2"],
  "alignments": ["Area where both partners agree or are in sync"],
  "attentionAreas": ["Area that may need more discussion or care"],
  "suggestedFollowUps": ["Specific, actionable suggestion"]
}
```

#### Privacy Considerations

- AI summaries are generated server-side. Raw check-in data is sent to OpenAI.
- Users should be informed that their responses will be processed by AI.
- A disclaimer should be shown before the first summary generation.

#### Database: `ai_summaries` Table

| Column                 | Type          | Notes                                          |
| ---------------------- | ------------- | ---------------------------------------------- |
| `id`                   | `text` (UUID) | Primary key                                    |
| `check_in_id`          | `text`        | FK to `check_ins.id`, NOT NULL, cascade delete |
| `overview`             | `text`        | NOT NULL                                       |
| `themes`               | `text`        | JSON-stringified array of strings              |
| `alignments`           | `text`        | JSON-stringified array of strings              |
| `attention_areas`      | `text`        | JSON-stringified array of strings              |
| `suggested_follow_ups` | `text`        | JSON-stringified array of strings              |
| `generated_at`         | `timestamp`   | NOT NULL                                       |
| `created_at`           | `timestamp`   | Default: now                                   |

#### UI Components

- **SummarizeButton**: Triggers AI summary generation. Shows loading spinner.
- **AISummaryCard**: Displays the structured summary with sections for themes, alignments, attention areas, and follow-ups.
- **AIDisclaimerDialog**: First-time consent dialog explaining that data will be processed by AI.

---

### Phase 7: Profile Editing

#### Overview

Users can edit any information they provided during onboarding. This re-uses the onboarding wizard's input components in a settings context.

#### User Stories

| ID  | Story                                       | Acceptance Criteria                              |
| --- | ------------------------------------------- | ------------------------------------------------ |
| PE1 | As a user, I can access my profile settings | Settings link in navigation or dashboard.        |
| PE2 | As a user, I can edit my display name       | Updated immediately in all views.                |
| PE3 | As a user, I can edit my birthday           | Date picker pre-filled with current value.       |
| PE4 | As a user, I can change my pronouns         | Same pronoun selector as onboarding.             |
| PE5 | As a user, I can change my love language    | Same love language picker as onboarding.         |
| PE6 | As a user, I can update my interests        | Same interest chips as onboarding.               |
| PE7 | As a user, I can update my goals            | Same goal selector as onboarding.                |
| PE8 | As a user, I can save changes with feedback | Success toast on save. Validation errors inline. |

#### Implementation Notes

- Extract the onboarding step components (`StepAboutYou`, `StepLoveConnection`, `StepGoals`) into shared components in `src/components/profile/`.
- The profile edit page shows all sections on a single page (no wizard steps) with a save button at the bottom.
- Pre-populate all fields from the user's existing profile data.
- The `saveProfile` server action can be reused with minor modifications to support updates.

#### UI Components

- **ProfileEditPage**: Single-page form with all profile fields.
- **ProfileSection**: Reusable section wrapper with heading and description.
- Shared input components extracted from the onboarding wizard.

---

## 4. Data Model

### Complete Entity Relationship Diagram

```
users
  |-- 1:1 -- profiles
  |-- 1:N -- accounts (OAuth)
  |-- 1:N -- sessions
  |-- 1:N -- partnerships (as inviter)
  |-- 1:N -- partnerships (as invitee)
  |-- 1:N -- check_in_responses
  |-- 1:N -- action_items (as owner)
  |-- 1:N -- action_items (as creator)

partnerships
  |-- 1:N -- check_in_templates
  |-- 1:N -- check_ins

check_in_templates
  |-- 1:N -- template_questions
  |-- 1:N -- check_ins (reference)

check_ins
  |-- 1:N -- check_in_questions
  |-- 1:N -- action_items
  |-- 1:1 -- ai_summaries

check_in_questions
  |-- 1:N -- check_in_responses
  |-- 1:N -- action_items
```

### New Tables Summary

| Table                | Phase | Description                                                 |
| -------------------- | ----- | ----------------------------------------------------------- |
| `partnerships`       | 1     | Links two users as partners                                 |
| `check_in_templates` | 2     | Defines reusable check-in structures                        |
| `template_questions` | 2     | Questions belonging to a template                           |
| `check_ins`          | 3     | Individual check-in instances                               |
| `check_in_questions` | 3     | Questions copied from a template or added by users directly |
| `check_in_responses` | 3     | Each partner's answers                                      |
| `action_items`       | 4     | Follow-up tasks with owners                                 |
| `ai_summaries`       | 6     | AI-generated check-in summaries                             |

### Drizzle Schema Additions

All new tables follow the existing schema patterns in `src/db/schema.ts`:

- UUIDs generated via `crypto.randomUUID()` as `text` primary keys.
- `timestamp` columns with `{ mode: 'date' }`.
- Foreign keys with `onDelete: 'cascade'` where appropriate.
- JSON data stored as `text` columns with JSON stringification (consistent with `profiles.interests` and `profiles.goals`).

---

## 5. Server Actions

### Phase 1: Partner Connection

| Action                               | File                         | Description                                |
| ------------------------------------ | ---------------------------- | ------------------------------------------ |
| `sendPartnerInvite(email)`           | `src/app/partner/actions.ts` | Validates and creates a partnership invite |
| `acceptInvite(partnershipId)`        | `src/app/partner/actions.ts` | Accepts a pending invite                   |
| `declineInvite(partnershipId)`       | `src/app/partner/actions.ts` | Declines a pending invite                  |
| `cancelInvite(partnershipId)`        | `src/app/partner/actions.ts` | Cancels an outgoing pending invite         |
| `dissolvePartnership(partnershipId)` | `src/app/partner/actions.ts` | Dissolves an active partnership            |

### Phase 2: Check-in Templates

| Action                     | File                           | Description                                       |
| -------------------------- | ------------------------------ | ------------------------------------------------- |
| `createTemplate(data)`     | `src/app/templates/actions.ts` | Creates a new template with questions             |
| `updateTemplate(id, data)` | `src/app/templates/actions.ts` | Updates template name, description, and questions |
| `deleteTemplate(id)`       | `src/app/templates/actions.ts` | Deletes a custom template                         |
| `duplicateTemplate(id)`    | `src/app/templates/actions.ts` | Duplicates a template (system or custom)          |

### Phase 3: Check-in Lifecycle

| Action                                    | File                           | Description                                              |
| ----------------------------------------- | ------------------------------ | -------------------------------------------------------- |
| `createCheckIn(data)`                     | `src/app/check-ins/actions.ts` | Creates a check-in from template or scratch              |
| `addQuestion(checkInId, data)`            | `src/app/check-ins/actions.ts` | Adds a custom question to a draft/scheduled check-in     |
| `updateQuestion(questionId, data)`        | `src/app/check-ins/actions.ts` | Edits a question's text, type, options, or required flag |
| `removeQuestion(questionId)`              | `src/app/check-ins/actions.ts` | Removes a question and its draft responses               |
| `reorderQuestions(checkInId, orderedIds)` | `src/app/check-ins/actions.ts` | Updates order_index for all questions in the check-in    |
| `saveResponse(questionId, text)`          | `src/app/check-ins/actions.ts` | Upserts a response (draft or active)                     |
| `startCheckIn(checkInId)`                 | `src/app/check-ins/actions.ts` | Transitions to `in_progress`                             |
| `completeCheckIn(checkInId)`              | `src/app/check-ins/actions.ts` | Transitions to `completed`                               |
| `reopenCheckIn(checkInId)`                | `src/app/check-ins/actions.ts` | Transitions back to `in_progress`                        |

### Phase 4: Action Items

| Action                               | File                           | Description                                    |
| ------------------------------------ | ------------------------------ | ---------------------------------------------- |
| `createActionItem(data)`             | `src/app/check-ins/actions.ts` | Creates an action item for a question          |
| `updateActionItemStatus(id, status)` | `src/app/check-ins/actions.ts` | Updates action item status                     |
| `updateActionItem(id, data)`         | `src/app/check-ins/actions.ts` | Edits action item description, owner, due date |
| `deleteActionItem(id)`               | `src/app/check-ins/actions.ts` | Removes an action item                         |

### Phase 5: Check-in History

| Action                           | File                           | Description                                 |
| -------------------------------- | ------------------------------ | ------------------------------------------- |
| `searchCheckIns(query, filters)` | `src/app/check-ins/actions.ts` | Searches check-ins with keyword and filters |

### Phase 6: AI Summarization

| Action                       | File                           | Description                         |
| ---------------------------- | ------------------------------ | ----------------------------------- |
| `generateSummary(checkInId)` | `src/app/check-ins/actions.ts` | Calls OpenAI and stores the summary |

### Phase 7: Profile Editing

| Action                | File                          | Description                                                             |
| --------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `updateProfile(data)` | `src/app/settings/actions.ts` | Updates the user's profile. Reuses logic from onboarding `saveProfile`. |

---

## 6. Page Structure and Routing

### Route Map

```
/                           Dashboard (partner status, upcoming check-ins, action items)
/login                      Login page (existing)
/register                   Registration page (existing)
/onboarding                 Onboarding wizard (existing)

/partner                    Partner connection management
  - Invite form (if unpartnered)
  - Pending invite status
  - Partner info card (if partnered)

/check-ins                  Check-in history list with search and filters
/check-ins/new              Create a new check-in (template picker + schedule)
/check-ins/[id]             Check-in detail (adapts view based on state)
  - draft/scheduled: Draft answer view
  - in_progress: Active check-in view with side-by-side answers
  - completed: Results view with action items and AI summary

/templates                  Template list (system + custom)
/templates/new              Create a new template
/templates/[id]             View template details
/templates/[id]/edit        Edit a custom template

/settings/profile           Edit profile information
```

### Navigation

The app should have a persistent navigation bar (bottom on mobile, sidebar on desktop) with:

- **Home** (dashboard)
- **Check-ins** (history)
- **Templates** (template management)
- **Settings** (profile)

The partner connection page is accessible from the dashboard and does not need its own nav item.

### Dashboard Layout

The dashboard (`/`) adapts based on partnership status:

**Unpartnered state:**

- Welcome message with user's display name.
- Invite partner form or pending invite status.
- Profile completion card (if applicable).

**Partnered state:**

- Welcome message with partner's display name.
- **Upcoming check-ins** section: Shows scheduled or in-progress check-ins.
- **My action items** section: Open action items assigned to the user.
- **Recent check-ins** section: Last 3 completed check-ins.
- **Quick actions**: "New check-in" button, "View history" link.

---

## 7. Check-in State Machine

### State Transition Diagram

```
                  +-----------+
                  |           |
          +------>|   draft   |-------+
          |       |           |       |
          |       +-----------+       |
          |             |             |
          |             | schedule    | start
          |             v             |
          |       +-----------+       |
          |       |           |       |
          |       | scheduled |-------+
          |       |           |       |
          |       +-----------+       |
          |                           |
          |                           v
          |                    +-----------+
          |                    |           |
          |  reopen            |in_progress|
          +--------------------+           |
                               +-----------+
                                     |
                                     | complete
                                     v
                               +-----------+
                               |           |
                               | completed |
                               |           |
                               +-----------+
```

### Transition Rules

| From          | To            | Trigger                                                | Guard                                 | Side Effects                                                         |
| ------------- | ------------- | ------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------- |
| `draft`       | `scheduled`   | User sets a scheduled date/time                        | `scheduled_for` must be in the future | `scheduled_for` is saved                                             |
| `draft`       | `in_progress` | User clicks "Start Check-in"                           | --                                    | `started_at` = now, all draft responses have `is_draft` set to false |
| `scheduled`   | `in_progress` | User clicks "Start Check-in" or scheduled time arrives | --                                    | `started_at` = now, all draft responses have `is_draft` set to false |
| `scheduled`   | `draft`       | User removes the scheduled date                        | --                                    | `scheduled_for` is cleared                                           |
| `in_progress` | `completed`   | User clicks "Complete Check-in"                        | --                                    | `completed_at` = now                                                 |
| `completed`   | `in_progress` | User clicks "Re-open"                                  | --                                    | `completed_at` is cleared                                            |

### Authorization

- Only members of the partnership can view or interact with a check-in.
- Either partner can trigger any state transition.
- Either partner can create, answer, and manage action items.

---

## 8. Non-functional Requirements

### Privacy

- **Draft isolation**: A partner's draft responses are never visible to the other partner until the check-in moves to `in_progress`. This is enforced both at the query level (filtering by `is_draft`) and in the UI.
- **Partnership scoping**: All queries for check-ins, templates, responses, and action items are scoped to the user's active partnership. Users cannot access data from other partnerships.
- **Dissolution data retention**: When a partnership is dissolved, check-in data is retained but becomes read-only. Neither partner can create new check-ins, but both can view historical data.

### Performance

- **Auto-save**: Response edits are debounced (1 second) and saved via server actions. Optimistic UI updates are used so the user never waits for a save confirmation.
- **Pagination**: Check-in history uses cursor-based pagination (20 items per page) with infinite scroll.
- **Search**: Keyword search is debounced (300ms) and executed server-side.

### Accessibility

- All interactive elements must be keyboard-navigable.
- Form inputs have associated labels.
- Status badges use both color and text/icon (not color alone).
- Focus management when modals/dialogs open and close.
- Screen reader announcements for state transitions (e.g., "Check-in started").

### Mobile Responsiveness

- The app is designed mobile-first.
- Side-by-side answer views stack vertically on screens under 768px.
- Navigation switches from sidebar to bottom tab bar on mobile.
- Touch targets are at least 44x44px.

### Error Handling

- All server actions return `{ success: boolean, error?: string }` consistent with the existing pattern.
- Network errors show a toast notification with a retry option.
- Stale state (e.g., partner already completed the check-in) triggers a page refresh with an informational message.

### Data Validation

- All server actions validate inputs using Zod schemas.
- Email format validation for partner invites.
- Template names must be 1-100 characters.
- Question text must be 1-500 characters.
- Multiple choice options must have at least 2 items, each 1-200 characters.
- Question modifications (add, edit, remove, reorder) are only permitted when the check-in status is `draft` or `scheduled`. Server actions reject changes if the check-in is `in_progress` or `completed`.
- Response text has no hard limit but is capped at 5,000 characters per response.
- Action item descriptions are capped at 500 characters.
