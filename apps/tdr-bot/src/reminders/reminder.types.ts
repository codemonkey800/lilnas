/**
 * Determines the side-effect performed when a reminder fires.
 *
 * - `Default` — plain text reminder
 * - `Search`  — run a Tavily web search and summarise results
 * - `Math`    — render a LaTeX equation via the equations service
 */
export enum ReminderActionType {
  Default = 'default',
  Search = 'search',
  Math = 'math',
}
