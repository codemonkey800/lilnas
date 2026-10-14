'use server'

import { getBrowserStatus, startBrowser, stopBrowser } from 'src/utils/browser'

export async function fetchBrowserStatus() {
  return getBrowserStatus()
}

export async function powerOnBrowser() {
  await startBrowser()
  return getBrowserStatus()
}

export async function powerOffBrowser() {
  await stopBrowser()
  return getBrowserStatus()
}
