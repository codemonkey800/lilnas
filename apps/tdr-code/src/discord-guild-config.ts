// necord's NecordModule.forRoot({ development }) only skips its guild-scoped
// registration override when `development` is falsy — an empty-but-present
// array (e.g. ['']) still triggers it, which pins every command to guild ''
// and permanently skips global command registration. Returning `undefined`
// for a blank guild id (production) is what makes commands register/update
// globally instead.
export function resolveDevelopmentGuilds(
  guildId: string,
): string[] | undefined {
  return guildId ? [guildId] : undefined
}
