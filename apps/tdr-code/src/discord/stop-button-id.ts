export const STOP_ID_PREFIX = 'stop'

export const stopButtonId = (channelId: string, turnId: number): string =>
  `${STOP_ID_PREFIX}/${channelId}/${turnId}`
