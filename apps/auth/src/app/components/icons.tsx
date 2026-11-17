// The icon set now lives in @lilnas/ui. auth's own names all exist there
// except the two it spelled differently (`arrowRight` → `arrow`,
// `chevronDown` → `chevron`); nothing here used either, so this is a plain
// re-export rather than a name-compat shim.
export type { IconName } from '@lilnas/ui'
export { Icon } from '@lilnas/ui'
