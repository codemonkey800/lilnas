import { and, eq } from 'drizzle-orm'

import { db } from './index'
import { checkInTemplates, templateQuestions } from './schema'

// ---------------------------------------------------------------------------
// System default templates (from PRD Phase 2)
// ---------------------------------------------------------------------------

interface SeedTemplate {
  name: string
  description: string
  questions: string[]
}

const SYSTEM_TEMPLATES: SeedTemplate[] = [
  {
    name: 'Weekly Check-in',
    description:
      'A quick weekly reflection to stay connected and address anything on your mind.',
    questions: [
      'How are you feeling about us this week?',
      "What's something I did this week that you appreciated?",
      "Is there anything that's been on your mind that you'd like to discuss?",
      'How connected have you felt to me this week?',
      "What's one thing we can do together this coming week?",
    ],
  },
  {
    name: 'Monthly Deep Dive',
    description:
      'A deeper monthly conversation covering communication, intimacy, goals, and unspoken needs.',
    questions: [
      'How would you describe the overall state of our relationship this month?',
      'What was the highlight of our month together?',
      'Is there an unresolved issue we need to revisit?',
      'How satisfied are you with our communication this month?',
      'How satisfied are you with our intimacy and connection this month?',
      "What's one goal you'd like us to work on next month?",
      "Is there anything you need from me that you haven't asked for?",
    ],
  },
  {
    name: 'Quick Pulse',
    description:
      'A fast check-in to gauge how you and your partner are feeling right now.',
    questions: [
      "One word to describe how you're feeling right now?",
      'Anything you need from me today?',
      'How connected do you feel to me right now?',
    ],
  },
]

// ---------------------------------------------------------------------------
// Seed logic (idempotent -- skips templates that already exist)
// ---------------------------------------------------------------------------

async function seed() {
  console.log('Seeding system templates...')

  for (const tpl of SYSTEM_TEMPLATES) {
    // Check if this system template already exists
    const existing = await db
      .select({ id: checkInTemplates.id })
      .from(checkInTemplates)
      .where(
        and(
          eq(checkInTemplates.name, tpl.name),
          eq(checkInTemplates.isSystem, true),
        ),
      )
      .limit(1)

    if (existing.length > 0) {
      console.log(`  Skipping "${tpl.name}" (already exists)`)
      continue
    }

    // Insert template
    const rows = await db
      .insert(checkInTemplates)
      .values({
        name: tpl.name,
        description: tpl.description,
        isSystem: true,
        partnershipId: null,
        createdById: null,
      })
      .returning({ id: checkInTemplates.id })

    const templateId = rows[0]!.id

    // Insert questions
    await db.insert(templateQuestions).values(
      tpl.questions.map((questionText, index) => ({
        templateId,
        questionText,
        orderIndex: index,
      })),
    )

    console.log(
      `  Created "${tpl.name}" with ${tpl.questions.length} questions`,
    )
  }

  console.log('Done.')
  process.exit(0)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
