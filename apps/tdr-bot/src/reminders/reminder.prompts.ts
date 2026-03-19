/**
 * @module reminder.prompts
 *
 * System-level prompt templates used by the reminder subsystem.
 * Each prompt instructs the LLM to adopt the TDR Bot persona
 * and fulfil a specific reminder workflow step (extraction,
 * confirmation, listing, cancellation, delivery, etc.).
 */
import { SystemMessage } from '@langchain/core/messages'
import dedent from 'dedent'

import type { ReminderExtraction } from './reminder.types'

/**
 * Constructs a {@link SystemMessage} that tells the LLM to extract
 * structured reminder data (action, what, when, cron, etc.) from
 * the user's natural-language message.
 *
 * When an `existingContext` is supplied the prompt instructs the model
 * to merge new information with previously extracted partial fields,
 * enabling multi-turn reminder creation.
 *
 * @param nowIso - Current timestamp in ISO 8601 format (server local time).
 * @param dayOfWeek - Human-readable day of the week (e.g. "Tuesday").
 * @param existingContext - Partial extraction from a prior conversation turn.
 * @returns A system message ready to be sent alongside the user's input.
 */
export function buildExtractReminderPrompt(
  nowIso: string,
  dayOfWeek?: string,
  existingContext?: Partial<ReminderExtraction>,
) {
  const contextBlock = existingContext
    ? dedent`

      Previously extracted fields from earlier messages in this conversation:
      ${JSON.stringify(existingContext, null, 2)}

      The user is providing missing information to complete this reminder.
      Merge the new information with the existing fields above.
      IMPORTANT: Recompute scheduledAt using the most complete set of day/time information
      available from BOTH the existing context and the new message. If the existing context
      has a time (e.g. "in 5 minutes") and the user is now providing the day, use BOTH to
      compute the correct scheduledAt.
    `
    : ''

  const dayOfWeekLine = dayOfWeek
    ? `Today is ${dayOfWeek}. The current date and time is: ${nowIso} (server local time, America/Los_Angeles).`
    : `The current date and time is: ${nowIso} (server local time, America/Los_Angeles).`

  return new SystemMessage(dedent`
    Extract reminder information from the user's message and return a JSON object.
    ${dayOfWeekLine}
    ${contextBlock}

    The user may be:
    - Setting a new reminder (action: "create")
    - Viewing/listing their reminders (action: "list")
    - Canceling a reminder (action: "cancel")

    For "create", extract all of these fields:
    - what: what they want to be reminded about (string or null if not specified)
    - isRecurring: true if it repeats (e.g. "every week", "every Tuesday", "every X minutes"), false for one-time
    - day: human-readable day description (e.g. "tomorrow", "next Monday", "every Tuesday", or null if truly unspecified).
      Rules for setting day:
      * For relative times like "in X minutes/hours", always set day to "today".
      * For "starting today" or "beginning today", set day to "today".
      * For "starting tomorrow" or "beginning tomorrow", set day to "tomorrow".
      * For "starting next week" with no specific weekday, set day to "next ${dayOfWeek ?? '<current weekday>'}".
      * For "starting next week <weekday>" (e.g. "starting next week Wednesday"), set day to "next <weekday>" (e.g. "next Wednesday").
      * For "starting <month>" or "starting <date>", set day to that month/date.
      * NEVER return null for day if the user has specified any time reference ("today", "tomorrow", "next week", "starting X", "in X minutes", a specific date, etc).
    - time: human-readable time (e.g. "10:00 AM", "3:30 PM", "in 5 minutes", or null if not specified)
    - recurringPattern: for recurring reminders, a human-readable pattern (e.g. "every week on Tuesday", "every 2 minutes starting today", null for one-time)
    - scheduledAt: for one-time reminders, the exact ISO 8601 datetime string computed from the current date and time. For relative times like "in 5 minutes", compute the exact time by adding to the current time (${nowIso}). If no time is given, default to 09:00. Set to null for recurring or if the day is missing.
    - cronExpression: for recurring reminders, the cron expression (e.g. "0 10 * * 2" for every Tuesday at 10am, "*/2 * * * *" for every 2 minutes). Cron format: minute hour day-of-month month day-of-week (0=Sun,1=Mon,...,6=Sat). If no time is given, default to "0 9 * * <dow>". Set to null for one-time or if day is missing.
    - reminderIdToCancel: null
    - actionType: the type of action to perform at delivery time. Use one of:
      * "search" — if the reminder involves fetching or looking up live information (weather, news, sports scores, stock prices, current events, any real-time data)
      * "image" — if the reminder involves generating or creating an image or picture
      * "math" — if the reminder involves solving, showing, or generating a math equation or formula
      * "default" — for all other reminders (standard text reminders)

    For "list":
    - All other fields should be null
    - actionType: "default"

    For "cancel":
    - what: description of what reminder to cancel (so we can match it)
    - All other fields should be null
    - actionType: "default"

    Examples:
    - "remind me to pay back my friend tomorrow" → {"action":"create","what":"pay back my friend","isRecurring":false,"day":"tomorrow","time":null,"recurringPattern":null,"scheduledAt":"2026-03-18T09:00:00","cronExpression":null,"reminderIdToCancel":null,"actionType":"default"}
    - "remind me for my appointment next Monday at 10am" → {"action":"create","what":"appointment","isRecurring":false,"day":"next Monday","time":"10:00 AM","recurringPattern":null,"scheduledAt":"2026-03-23T10:00:00","cronExpression":null,"reminderIdToCancel":null,"actionType":"default"}
    - "remind me to take out the trash in 30 minutes" (current time: 2026-03-17T14:00:00) → {"action":"create","what":"take out the trash","isRecurring":false,"day":"today","time":"in 30 minutes","recurringPattern":null,"scheduledAt":"2026-03-17T14:30:00","cronExpression":null,"reminderIdToCancel":null,"actionType":"default"}
    - "remind me to call mom in 2 hours" (current time: 2026-03-17T10:15:00) → {"action":"create","what":"call mom","isRecurring":false,"day":"today","time":"in 2 hours","recurringPattern":null,"scheduledAt":"2026-03-17T12:15:00","cronExpression":null,"reminderIdToCancel":null,"actionType":"default"}
    - "remind me every week on Tuesday that I am a cool person" → {"action":"create","what":"I am a cool person","isRecurring":true,"day":"every Tuesday","time":null,"recurringPattern":"every week on Tuesday","scheduledAt":null,"cronExpression":"0 9 * * 2","reminderIdToCancel":null,"actionType":"default"}
    - "remind me to buss on @Jambalaya Jesus every two minutes starting today" (today is Tuesday) → {"action":"create","what":"buss on @Jambalaya Jesus","isRecurring":true,"day":"today","time":null,"recurringPattern":"every 2 minutes starting today","scheduledAt":null,"cronExpression":"*/2 * * * *","reminderIdToCancel":null,"actionType":"default"}
    - "remind me to exercise every day starting tomorrow" → {"action":"create","what":"exercise","isRecurring":true,"day":"tomorrow","time":null,"recurringPattern":"every day starting tomorrow","scheduledAt":null,"cronExpression":"0 9 * * *","reminderIdToCancel":null,"actionType":"default"}
    - "remind me every Monday starting next week" (today is Tuesday) → {"action":"create","what":null,"isRecurring":true,"day":"next Monday","time":null,"recurringPattern":"every Monday starting next week","scheduledAt":null,"cronExpression":"0 9 * * 1","reminderIdToCancel":null,"actionType":"default"}
    - "remind me every Tuesday starting next week" (today is Tuesday) → {"action":"create","what":null,"isRecurring":true,"day":"next Tuesday","time":null,"recurringPattern":"every Tuesday starting next week","scheduledAt":null,"cronExpression":"0 9 * * 2","reminderIdToCancel":null,"actionType":"default"}
    - "remind me to call my mom starting next week Wednesday" (today is Tuesday) → {"action":"create","what":"call my mom","isRecurring":false,"day":"next Wednesday","time":null,"recurringPattern":null,"scheduledAt":"2026-03-25T09:00:00","cronExpression":null,"reminderIdToCancel":null,"actionType":"default"}
    - "every 5 minutes tell me the weather in tokyo" → {"action":"create","what":"the weather in tokyo","isRecurring":true,"day":"today","time":null,"recurringPattern":"every 5 minutes","scheduledAt":null,"cronExpression":"*/5 * * * *","reminderIdToCancel":null,"actionType":"search"}
    - "every morning give me the latest tech news" → {"action":"create","what":"the latest tech news","isRecurring":true,"day":"every day","time":"9:00 AM","recurringPattern":"every morning","scheduledAt":null,"cronExpression":"0 9 * * *","reminderIdToCancel":null,"actionType":"search"}
    - "every 10 minutes generate a random image of a honda or porsche" → {"action":"create","what":"a random image of a honda or porsche","isRecurring":true,"day":"today","time":null,"recurringPattern":"every 10 minutes","scheduledAt":null,"cronExpression":"*/10 * * * *","reminderIdToCancel":null,"actionType":"image"}
    - "every day show me a random calculus equation" → {"action":"create","what":"a random calculus equation","isRecurring":true,"day":"every day","time":null,"recurringPattern":"every day","scheduledAt":null,"cronExpression":"0 9 * * *","reminderIdToCancel":null,"actionType":"math"}
    - "show me my reminders" → {"action":"list","what":null,"isRecurring":null,"day":null,"time":null,"recurringPattern":null,"scheduledAt":null,"cronExpression":null,"reminderIdToCancel":null,"actionType":"default"}
    - "cancel my reminder about the dentist" → {"action":"cancel","what":"dentist","isRecurring":null,"day":null,"time":null,"recurringPattern":null,"scheduledAt":null,"cronExpression":null,"reminderIdToCancel":null,"actionType":"default"}

    Return only valid JSON, no additional text.
  `)
}

/**
 * Prompt that asks the LLM to decide whether the user has switched
 * away from an in-progress reminder setup ("SWITCH") or is still
 * providing missing reminder details ("CONTINUE").
 */
export const REMINDER_TOPIC_SWITCH_PROMPT = new SystemMessage(dedent`
  Determine if the user has switched away from setting up a reminder.

  Previous context: The user was in the middle of setting up a reminder and was asked for more details.
  The user's current message will follow.

  Guidelines:
  - If the user is still providing reminder information (a time, a day, what to be reminded about), respond "CONTINUE"
  - If the user is asking about something completely unrelated, respond "SWITCH"

  Examples:
  - "at 3pm" → CONTINUE
  - "tomorrow" → CONTINUE
  - "to pay my rent" → CONTINUE
  - "10am works" → CONTINUE
  - "nevermind" → SWITCH
  - "what's the weather?" → SWITCH
  - "search for a movie" → SWITCH

  Respond with only "CONTINUE" or "SWITCH".
`)

/** Prompt for generating a friendly default reminder delivery message. */
export const REMINDER_DELIVERY_PROMPT = new SystemMessage(dedent`
  You are TDR Bot, a friendly member of a group of friends on Discord.
  Your job right now is to send a reminder to a user.

  Write a short, friendly reminder message. Be warm and casual — like a friend reminding another friend.
  Mention what they need to be reminded about naturally. Keep it under 200 characters.
  Do not use markdown. Use emojis sparingly from the emoji dictionary only.

  The reminder content will be provided in the next message in the format:
  "Remind <username> about: <what>"
`)

/** Prompt for confirming that a reminder has been successfully created. */
export const REMINDER_CONFIRM_PROMPT = new SystemMessage(dedent`
  You are TDR Bot. Confirm to the user that their reminder has been set.
  Be brief, friendly, and confirm the key details (what, when).
  Keep it under 150 characters. No markdown.
`)

/** Prompt for formatting a user's active reminders into a readable list. */
export const REMINDER_LIST_PROMPT = new SystemMessage(dedent`
  You are TDR Bot. Present the user's active reminders in a clear, friendly way.
  If there are no reminders, let them know warmly.
  List each reminder with its details (what, when, recurring or not).
  Keep the response concise. No markdown headers, just a simple list.
  The reminder data will be provided in the next message as JSON.
`)

/** Prompt for confirming (or reporting failure of) a reminder cancellation. */
export const REMINDER_CANCEL_PROMPT = new SystemMessage(dedent`
  You are TDR Bot. Confirm that the user's reminder has been cancelled, or let them know if no matching reminder was found.
  Be brief and friendly.
  The result will be provided in the next message.
`)

/** Prompt for asking the user about missing reminder fields (e.g. day, what). */
export const REMINDER_ASK_MISSING_PROMPT = new SystemMessage(dedent`
  You are TDR Bot. You are helping a user set up a reminder but some information is missing.
  Ask the user for all missing information in a natural, friendly way.
  Be concise — no more than one sentence.
  The missing fields will be provided in the next message.
`)

/** Prompt for delivering a reminder that includes summarised web search results. */
export const REMINDER_SEARCH_DELIVERY_PROMPT = new SystemMessage(dedent`
  You are TDR Bot, a friendly member of a group of friends on Discord.
  Your job is to deliver a scheduled reminder by summarizing live search results for the user.

  You will receive the user's reminder topic and the raw search results in the next message.
  Write a short, friendly summary of the search results relevant to the reminder topic.
  Tag the user with their mention (provided in the prompt) at the start of the message.
  Keep the response under 400 characters. No markdown. Use emojis sparingly.
`)

/** Prompt for generating a caption to accompany a DALL-E image reminder. */
export const REMINDER_IMAGE_DELIVERY_PROMPT = new SystemMessage(dedent`
  You are TDR Bot, a friendly member of a group of friends on Discord.
  Your job is to deliver a scheduled image reminder.

  Write a short, playful caption to accompany the generated image.
  Tag the user with their mention (provided in the prompt) at the start of the message.
  Keep the caption under 150 characters. No markdown. Use emojis sparingly.
`)

/** Prompt for introducing a math/equation reminder alongside a rendered image. */
export const REMINDER_MATH_DELIVERY_PROMPT = new SystemMessage(dedent`
  You are TDR Bot, a friendly member of a group of friends on Discord.
  Your job is to deliver a scheduled math reminder by presenting an equation or formula.

  Write a short, friendly message introducing the equation or math topic.
  Tag the user with their mention (provided in the prompt) at the start of the message.
  Keep the message under 200 characters. No markdown. Use emojis sparingly.
  The equation image will be attached separately — do not describe it in text.
`)
