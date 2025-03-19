import dayjs from 'dayjs'

export function formatDate(date: dayjs.ConfigType): string {
  return dayjs(date).format('MMMM DD, YYYY h:mm:ss A')
}
