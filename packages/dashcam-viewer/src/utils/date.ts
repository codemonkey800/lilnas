import dayjs from 'dayjs'

export function getVideoDate(fileName: string) {
  const [rawDate, rawTime] = fileName.split('_')
  return dayjs(`${rawDate}${rawTime}`, 'YYYYMMDDHHmmss')
}
