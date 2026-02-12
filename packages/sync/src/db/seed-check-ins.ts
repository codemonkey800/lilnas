import { asc, eq } from 'drizzle-orm'

import { db } from './index'
import {
  actionItems,
  checkInQuestions,
  checkInResponses,
  checkIns,
  checkInTemplates,
  templateQuestions,
} from './schema'
import { SEED_IDS as IDS } from './seed-ids'

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(10, 0, 0, 0)
  return d
}

function daysFromNow(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  d.setHours(10, 0, 0, 0)
  return d
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a template by name and return its ID + questions. */
async function getTemplate(name: string) {
  const [tpl] = await db
    .select({ id: checkInTemplates.id })
    .from(checkInTemplates)
    .where(eq(checkInTemplates.name, name))
    .limit(1)

  if (!tpl) {
    throw new Error(
      `Template "${name}" not found. Did you run the main seed first? (pnpm db:seed)`,
    )
  }

  const questions = await db
    .select({
      id: templateQuestions.id,
      questionText: templateQuestions.questionText,
      isRequired: templateQuestions.isRequired,
      orderIndex: templateQuestions.orderIndex,
    })
    .from(templateQuestions)
    .where(eq(templateQuestions.templateId, tpl.id))
    .orderBy(asc(templateQuestions.orderIndex))

  return { id: tpl.id, questions }
}

/** Insert a check-in and copy questions from the template. Returns the
 *  check-in ID and the IDs of the created check-in questions. */
async function insertCheckIn(opts: {
  id: string
  templateId: string
  title: string
  status: 'draft' | 'in_progress' | 'completed'
  createdById: string
  startedAt?: Date | null
  completedAt?: Date | null
  createdAt?: Date
  questions: {
    questionText: string
    isRequired: boolean
    orderIndex: number
  }[]
}) {
  await db.insert(checkIns).values({
    id: opts.id,
    partnershipId: IDS.partnership,
    templateId: opts.templateId,
    title: opts.title,
    status: opts.status,
    createdById: opts.createdById,
    startedAt: opts.startedAt ?? null,
    completedAt: opts.completedAt ?? null,
    createdAt: opts.createdAt ?? new Date(),
  })

  const questionIds: string[] = []

  for (const q of opts.questions) {
    const qId = crypto.randomUUID()
    await db.insert(checkInQuestions).values({
      id: qId,
      checkInId: opts.id,
      questionText: q.questionText,
      isRequired: q.isRequired,
      orderIndex: q.orderIndex,
    })
    questionIds.push(qId)
  }

  return questionIds
}

/** Insert a response for a question. */
async function insertResponse(
  questionId: string,
  userId: string,
  responseText: string,
  isDraft: boolean,
) {
  await db.insert(checkInResponses).values({
    id: crypto.randomUUID(),
    checkInQuestionId: questionId,
    userId,
    responseText,
    isDraft,
  })
}

/** Insert an action item. */
async function insertActionItem(opts: {
  checkInId: string
  checkInQuestionId: string
  description: string
  ownerType: 'individual' | 'both'
  ownerId: string | null
  createdById: string
  status: 'open' | 'in_progress' | 'completed'
  dueDate?: Date | null
  completedAt?: Date | null
}) {
  await db.insert(actionItems).values({
    id: crypto.randomUUID(),
    checkInId: opts.checkInId,
    checkInQuestionId: opts.checkInQuestionId,
    description: opts.description,
    ownerType: opts.ownerType,
    ownerId: opts.ownerId,
    createdById: opts.createdById,
    status: opts.status,
    dueDate: opts.dueDate ?? null,
    completedAt: opts.completedAt ?? null,
  })
}

// ---------------------------------------------------------------------------
// Stable check-in IDs (so re-runs are predictable)
// ---------------------------------------------------------------------------

const CHECK_IN_IDS = {
  completed1: 'c1000000-0000-0000-0000-000000000001',
  completed2: 'c1000000-0000-0000-0000-000000000002',
  inProgress: 'c1000000-0000-0000-0000-000000000003',
  draft1: 'c1000000-0000-0000-0000-000000000004',
  draft2: 'c1000000-0000-0000-0000-000000000005',
} as const

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------

async function seedCheckIns() {
  console.log('=== Seeding check-in data ===\n')

  // ------ Clean existing check-in data (cascade deletes questions, responses, action items) ------
  console.log('Clearing existing check-in data...')
  await db
    .delete(checkIns)
    .where(eq(checkIns.partnershipId, IDS.partnership))
  console.log('  Done.\n')

  // ------ Look up templates ------
  console.log('Looking up templates...')
  const weeklyTemplate = await getTemplate('Weekly Check-in')
  console.log(
    `  Weekly Check-in: ${weeklyTemplate.questions.length} questions`,
  )
  const customTemplate = await getTemplate('Our check In')
  console.log(
    `  Our check In: ${customTemplate.questions.length} questions`,
  )
  const pulseTemplate = await getTemplate('Quick Pulse')
  console.log(`  Quick Pulse: ${pulseTemplate.questions.length} questions\n`)

  // ================================================================
  // 1. COMPLETED check-in #1 — Weekly Check-in (3 weeks ago)
  // ================================================================
  console.log('Creating completed check-in #1 (Weekly Check-in)...')
  const c1Qs = await insertCheckIn({
    id: CHECK_IN_IDS.completed1,
    templateId: weeklyTemplate.id,
    title: 'Week of Jan 20 Check-in',
    status: 'completed',
    createdById: IDS.jeremy,
    startedAt: daysAgo(23),
    completedAt: daysAgo(21),
    createdAt: daysAgo(24),
    questions: weeklyTemplate.questions,
  })

  // Both partners responded (all finalized)
  const c1Responses: [string, string, string][] = [
    [c1Qs[0]!, IDS.jeremy, 'Feeling really connected this week, we had some great conversations.'],
    [c1Qs[0]!, IDS.monica, 'I feel good about us. We spent quality time together which I appreciated.'],
    [c1Qs[1]!, IDS.jeremy, 'You surprised me with that home-cooked meal on Tuesday, it meant a lot.'],
    [c1Qs[1]!, IDS.monica, 'You remembered to ask about my day every evening, that was really sweet.'],
    [c1Qs[2]!, IDS.jeremy, "Nothing major — maybe we could plan weekend activities earlier in the week."],
    [c1Qs[2]!, IDS.monica, "I'd like us to spend a bit less time on our phones during dinner."],
    [c1Qs[3]!, IDS.jeremy, 'Very connected — 8 out of 10.'],
    [c1Qs[3]!, IDS.monica, 'Probably a 7. We had a busy stretch mid-week but recovered nicely.'],
    [c1Qs[4]!, IDS.jeremy, 'Maybe a hike on Saturday if the weather is nice?'],
    [c1Qs[4]!, IDS.monica, "I'd love to try that new Thai place for date night!"],
  ]
  for (const [qId, userId, text] of c1Responses) {
    await insertResponse(qId, userId, text, false)
  }

  // Action items from completed check-in #1
  await insertActionItem({
    checkInId: CHECK_IN_IDS.completed1,
    checkInQuestionId: c1Qs[2]!,
    description: 'Plan weekend activities by Wednesday each week',
    ownerType: 'both',
    ownerId: null,
    createdById: IDS.jeremy,
    status: 'completed',
    completedAt: daysAgo(14),
  })
  await insertActionItem({
    checkInId: CHECK_IN_IDS.completed1,
    checkInQuestionId: c1Qs[2]!,
    description: 'No phones at the dinner table — start a 7-day streak',
    ownerType: 'both',
    ownerId: null,
    createdById: IDS.monica,
    status: 'in_progress',
  })
  await insertActionItem({
    checkInId: CHECK_IN_IDS.completed1,
    checkInQuestionId: c1Qs[4]!,
    description: 'Research hiking trails within 1 hour drive',
    ownerType: 'individual',
    ownerId: IDS.jeremy,
    createdById: IDS.jeremy,
    status: 'completed',
    dueDate: daysAgo(18),
    completedAt: daysAgo(19),
  })
  console.log('  5 questions, 10 responses, 3 action items\n')

  // ================================================================
  // 2. COMPLETED check-in #2 — Quick Pulse (10 days ago)
  // ================================================================
  console.log('Creating completed check-in #2 (Quick Pulse)...')
  const c2Qs = await insertCheckIn({
    id: CHECK_IN_IDS.completed2,
    templateId: pulseTemplate.id,
    title: 'Quick Pulse — Feb 2',
    status: 'completed',
    createdById: IDS.monica,
    startedAt: daysAgo(11),
    completedAt: daysAgo(10),
    createdAt: daysAgo(12),
    questions: pulseTemplate.questions,
  })

  const c2Responses: [string, string, string][] = [
    [c2Qs[0]!, IDS.jeremy, 'Grateful'],
    [c2Qs[0]!, IDS.monica, 'Content'],
    [c2Qs[1]!, IDS.jeremy, 'Just your company tonight is enough.'],
    [c2Qs[1]!, IDS.monica, 'Could you help me pick out a gift for my mom this weekend?'],
    [c2Qs[2]!, IDS.jeremy, 'Very connected — we had a great weekend.'],
    [c2Qs[2]!, IDS.monica, 'Super close today. That morning walk was lovely.'],
  ]
  for (const [qId, userId, text] of c2Responses) {
    await insertResponse(qId, userId, text, false)
  }

  await insertActionItem({
    checkInId: CHECK_IN_IDS.completed2,
    checkInQuestionId: c2Qs[1]!,
    description: "Help Monica pick a gift for her mom",
    ownerType: 'individual',
    ownerId: IDS.jeremy,
    createdById: IDS.monica,
    status: 'open',
    dueDate: daysFromNow(3),
  })
  console.log('  3 questions, 6 responses, 1 action item\n')

  // ================================================================
  // 3. IN-PROGRESS check-in — Our check In (current week)
  // ================================================================
  console.log('Creating in-progress check-in (Our check In)...')
  // Only use first 5 questions to keep it manageable
  const inProgressQuestions = customTemplate.questions.slice(0, 5)
  const c3Qs = await insertCheckIn({
    id: CHECK_IN_IDS.inProgress,
    templateId: customTemplate.id,
    title: 'Weekly Sync — Feb 10',
    status: 'in_progress',
    createdById: IDS.jeremy,
    startedAt: daysAgo(2),
    createdAt: daysAgo(3),
    questions: inProgressQuestions,
  })

  // Jeremy answered questions 0-2, Monica answered 0-1 (some still draft)
  const c3Responses: [string, string, string, boolean][] = [
    [c3Qs[0]!, IDS.jeremy, 'I want to take responsibility for being distracted during our talk on Monday.', false],
    [c3Qs[0]!, IDS.monica, "I should've been more patient when you were stressed about work.", false],
    [c3Qs[1]!, IDS.jeremy, 'Nothing comes to mind — we handled disagreements well this week.', false],
    [c3Qs[1]!, IDS.monica, "No apology needed, but I'd appreciate more heads-up when you'll be late.", false],
    [c3Qs[2]!, IDS.jeremy, "We sometimes default to watching TV instead of talking. Let's try one screen-free evening.", true],
    // Monica hasn't answered question 2 yet
    // Questions 3 and 4 unanswered by both
  ]
  for (const [qId, userId, text, isDraft] of c3Responses) {
    await insertResponse(qId, userId, text, isDraft)
  }

  // Action items from in-progress check-in
  await insertActionItem({
    checkInId: CHECK_IN_IDS.inProgress,
    checkInQuestionId: c3Qs[0]!,
    description: 'Put phone away during conversations — practice active listening',
    ownerType: 'individual',
    ownerId: IDS.jeremy,
    createdById: IDS.jeremy,
    status: 'open',
  })
  await insertActionItem({
    checkInId: CHECK_IN_IDS.inProgress,
    checkInQuestionId: c3Qs[1]!,
    description: 'Text when running more than 15 minutes late',
    ownerType: 'individual',
    ownerId: IDS.jeremy,
    createdById: IDS.monica,
    status: 'open',
    dueDate: daysFromNow(7),
  })
  await insertActionItem({
    checkInId: CHECK_IN_IDS.inProgress,
    checkInQuestionId: c3Qs[2]!,
    description: 'Pick one screen-free evening per week (try Wednesday)',
    ownerType: 'both',
    ownerId: null,
    createdById: IDS.jeremy,
    status: 'open',
    dueDate: daysFromNow(5),
  })
  await insertActionItem({
    checkInId: CHECK_IN_IDS.inProgress,
    checkInQuestionId: c3Qs[1]!,
    description: 'Practice patience when partner is stressed — count to 5 before reacting',
    ownerType: 'individual',
    ownerId: IDS.monica,
    createdById: IDS.monica,
    status: 'in_progress',
  })
  console.log('  5 questions, 5 responses (1 draft), 4 action items\n')

  // ================================================================
  // 4. DRAFT check-in #1 — Weekly Check-in (some responses, has action items)
  // ================================================================
  console.log('Creating draft check-in #1 (Weekly Check-in)...')
  const c4Qs = await insertCheckIn({
    id: CHECK_IN_IDS.draft1,
    templateId: weeklyTemplate.id,
    title: 'Week of Feb 17 Check-in',
    status: 'draft',
    createdById: IDS.jeremy,
    createdAt: daysAgo(1),
    questions: weeklyTemplate.questions,
  })

  // Jeremy started drafting answers for questions 0 and 1; Monica answered question 0
  // Questions 2-4 have no responses
  const c4Responses: [string, string, string, boolean][] = [
    [c4Qs[0]!, IDS.jeremy, "Pretty good — we've been making more time for each other.", true],
    [c4Qs[0]!, IDS.monica, 'Feeling optimistic. The new routine is helping.', true],
    [c4Qs[1]!, IDS.jeremy, 'You left me a sweet note on the fridge, that made my morning.', true],
  ]
  for (const [qId, userId, text, isDraft] of c4Responses) {
    await insertResponse(qId, userId, text, isDraft)
  }

  // One action item already created while drafting
  await insertActionItem({
    checkInId: CHECK_IN_IDS.draft1,
    checkInQuestionId: c4Qs[0]!,
    description: 'Keep the new morning routine going for another week',
    ownerType: 'both',
    ownerId: null,
    createdById: IDS.monica,
    status: 'open',
    dueDate: daysFromNow(7),
  })
  await insertActionItem({
    checkInId: CHECK_IN_IDS.draft1,
    checkInQuestionId: c4Qs[1]!,
    description: 'Write a love note for Monica this week',
    ownerType: 'individual',
    ownerId: IDS.jeremy,
    createdById: IDS.jeremy,
    status: 'open',
    dueDate: daysFromNow(5),
  })
  console.log('  5 questions, 3 responses (all draft), 2 action items\n')

  // ================================================================
  // 5. DRAFT check-in #2 — Monthly Deep Dive (no responses, no action items)
  // ================================================================
  console.log('Creating draft check-in #2 (Monthly Deep Dive)...')
  const monthlyTemplate = await getTemplate('Monthly Deep Dive')
  await insertCheckIn({
    id: CHECK_IN_IDS.draft2,
    templateId: monthlyTemplate.id,
    title: 'February Deep Dive',
    status: 'draft',
    createdById: IDS.monica,
    createdAt: new Date(),
    questions: monthlyTemplate.questions,
  })
  console.log(
    `  ${monthlyTemplate.questions.length} questions, no responses, no action items\n`,
  )

  // ------ Summary ------
  console.log('=== Check-in seed complete ===')
  console.log('')
  console.log('  2 completed check-ins (with responses and action items)')
  console.log('  1 in-progress check-in (partial responses, open action items)')
  console.log('  2 draft check-ins:')
  console.log('    - Draft #1: partial draft responses + 2 action items')
  console.log('    - Draft #2: empty (no responses, no action items)')
  console.log('')
  console.log('  Action item breakdown:')
  console.log('    6 open, 2 in_progress, 2 completed')
  console.log('    3 shared (both), 7 individual')

  process.exit(0)
}

seedCheckIns().catch(err => {
  console.error('Check-in seed failed:', err)
  process.exit(1)
})
