import bcrypt from 'bcryptjs'
import { and, eq } from 'drizzle-orm'

import { db } from './index'
import {
  checkInTemplates,
  partnerships,
  profiles,
  templateQuestions,
  users,
} from './schema'

// ---------------------------------------------------------------------------
// Stable IDs so relationships stay consistent across re-seeds
// ---------------------------------------------------------------------------

const IDS = {
  jeremy: 'd701c0da-0e0f-4c56-b6ca-f832abdc3ec6',
  monica: '0fe9ac4a-3145-4ec7-81ba-2ba0ed17d9dc',
  jeremyProfile: 'b38b3b72-e807-4de9-be54-203bad104da2',
  monicaProfile: '6692db5a-7b83-43a9-b586-01246650d667',
  partnership: '3ecd6627-0fb9-40af-8ffe-b0b1843a6178',
} as const

// Default dev password for all seeded users
const DEV_PASSWORD = 'password'

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

interface SeedUser {
  id: string
  email: string
}

const SEED_USERS: SeedUser[] = [
  { id: IDS.jeremy, email: 'jeremyasuncion808@gmail.com' },
  { id: IDS.monica, email: 'jeremyasuncion808+monica@gmail.com' },
]

interface SeedProfile {
  id: string
  userId: string
  displayName: string
  birthday: string
  pronouns: string
  loveLang: string
  interests: string[]
  goals: string[]
}

const SEED_PROFILES: SeedProfile[] = [
  {
    id: IDS.jeremyProfile,
    userId: IDS.jeremy,
    displayName: 'Jeremy',
    birthday: '1996-04-30',
    pronouns: 'he/him',
    loveLang: 'words-of-affirmation',
    interests: ['Cooking', 'Hiking', 'Movies'],
    goals: [
      'Date night ideas',
      'Better communication',
      'Conflict resolution',
      'Fun activities together',
      'Deepening emotional connection',
      'Understanding each other better',
    ],
  },
  {
    id: IDS.monicaProfile,
    userId: IDS.monica,
    displayName: 'Monica',
    birthday: '2001-08-06',
    pronouns: 'she/her',
    loveLang: 'receiving-gifts',
    interests: ['Cooking', 'Hiking', 'Art', 'Fitness'],
    goals: [
      'Date night ideas',
      'Better communication',
      'Gift inspiration',
      'Conflict resolution',
      'Understanding each other better',
      'Fun activities together',
    ],
  },
]

interface SeedTemplate {
  name: string
  description: string
  isSystem: boolean
  partnershipId: string | null
  createdById: string | null
  questions: string[]
}

const SEED_TEMPLATES: SeedTemplate[] = [
  // ---- System templates ----
  {
    name: 'Weekly Check-in',
    description:
      'A quick weekly reflection to stay connected and address anything on your mind.',
    isSystem: true,
    partnershipId: null,
    createdById: null,
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
    isSystem: true,
    partnershipId: null,
    createdById: null,
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
    isSystem: true,
    partnershipId: null,
    createdById: null,
    questions: [
      "One word to describe how you're feeling right now?",
      'Anything you need from me today?',
      'How connected do you feel to me right now?',
    ],
  },
  // ---- User-created templates ----
  {
    name: 'Our check In',
    description: '12 questions for us to check in on',
    isSystem: false,
    partnershipId: IDS.partnership,
    createdById: IDS.jeremy,
    questions: [
      'Is there something you want to take responsibility for this week?',
      'Is there something I did that you want an apology/repair for?',
      "What's one pattern we slipped into — and what's one small change we can try next week?",
      'Did you feel wanted and chosen by me this week? What made you feel that?',
      'Is there a task or responsibility we should rebalance next week?',
      'What would make intimacy feel safer/better next week?',
      "Any dates or activities you'd like to do?",
      "What's something I did this week that made you feel loved or appreciated?",
      'How are we balancing our time together vs. individual time?',
      "What's something you want more of in our relationship?",
      "What's a way we could prioritize quality time this week?",
      'Goals or intentions for the coming week, individually or together?',
    ],
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertUser(user: SeedUser, passwordHash: string) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1)

  if (existing.length > 0) {
    console.log(`  User "${user.email}" already exists, updating password...`)
    await db.update(users).set({ passwordHash }).where(eq(users.id, user.id))
    return
  }

  await db.insert(users).values({
    id: user.id,
    email: user.email,
    passwordHash,
  })
  console.log(`  Created user "${user.email}"`)
}

async function upsertProfile(profile: SeedProfile) {
  const existing = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, profile.userId))
    .limit(1)

  const values = {
    id: profile.id,
    userId: profile.userId,
    displayName: profile.displayName,
    birthday: profile.birthday,
    pronouns: profile.pronouns,
    loveLang: profile.loveLang,
    interests: JSON.stringify(profile.interests),
    goals: JSON.stringify(profile.goals),
    onboardingCompleted: true,
  }

  if (existing.length > 0) {
    console.log(
      `  Profile for "${profile.displayName}" already exists, updating...`,
    )
    await db
      .update(profiles)
      .set(values)
      .where(eq(profiles.userId, profile.userId))
    return
  }

  await db.insert(profiles).values(values)
  console.log(`  Created profile for "${profile.displayName}"`)
}

async function upsertPartnership() {
  const existing = await db
    .select({ id: partnerships.id })
    .from(partnerships)
    .where(eq(partnerships.id, IDS.partnership))
    .limit(1)

  if (existing.length > 0) {
    console.log('  Partnership already exists, updating status...')
    await db
      .update(partnerships)
      .set({ status: 'accepted' })
      .where(eq(partnerships.id, IDS.partnership))
    return
  }

  await db.insert(partnerships).values({
    id: IDS.partnership,
    inviterId: IDS.jeremy,
    inviteeId: IDS.monica,
    status: 'accepted',
  })
  console.log('  Created partnership (Jeremy <-> Monica)')
}

async function upsertTemplate(tpl: SeedTemplate) {
  const existing = await db
    .select({ id: checkInTemplates.id })
    .from(checkInTemplates)
    .where(
      and(
        eq(checkInTemplates.name, tpl.name),
        tpl.isSystem
          ? eq(checkInTemplates.isSystem, true)
          : eq(checkInTemplates.isSystem, false),
      ),
    )
    .limit(1)

  let templateId: string

  if (existing.length > 0) {
    templateId = existing[0]!.id
    console.log(
      `  Template "${tpl.name}" already exists, replacing questions...`,
    )

    // Delete old questions and re-insert
    await db
      .delete(templateQuestions)
      .where(eq(templateQuestions.templateId, templateId))
  } else {
    const rows = await db
      .insert(checkInTemplates)
      .values({
        name: tpl.name,
        description: tpl.description,
        isSystem: tpl.isSystem,
        partnershipId: tpl.partnershipId,
        createdById: tpl.createdById,
      })
      .returning({ id: checkInTemplates.id })

    templateId = rows[0]!.id
    console.log(`  Created template "${tpl.name}"`)
  }

  // Insert questions
  await db.insert(templateQuestions).values(
    tpl.questions.map((questionText, index) => ({
      templateId,
      questionText,
      orderIndex: index,
    })),
  )
  console.log(`    -> ${tpl.questions.length} questions`)
}

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------

async function seed() {
  console.log('=== Seeding dev database ===\n')

  // 1. Users
  console.log('Users:')
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 12)
  for (const user of SEED_USERS) {
    await upsertUser(user, passwordHash)
  }

  // 2. Profiles
  console.log('\nProfiles:')
  for (const profile of SEED_PROFILES) {
    await upsertProfile(profile)
  }

  // 3. Partnership
  console.log('\nPartnership:')
  await upsertPartnership()

  // 4. Templates + questions
  console.log('\nTemplates:')
  for (const tpl of SEED_TEMPLATES) {
    await upsertTemplate(tpl)
  }

  console.log('\n=== Seed complete ===')
  console.log(`\nDev login credentials:`)
  console.log(`  Jeremy: jeremyasuncion808@gmail.com / ${DEV_PASSWORD}`)
  console.log(`  Monica: jeremyasuncion808+monica@gmail.com / ${DEV_PASSWORD}`)

  process.exit(0)
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
