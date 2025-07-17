'use server'

import * as k8s from '@kubernetes/client-node'

const HOST_BLOCKLIST = new Set(['auth', 'edge'])
const CACHE_TTL = 30 * 1000 // 30 seconds
const NAMESPACE_PREFIX = 'lilnas-'

interface CacheEntry {
  hosts: string[]
  timestamp: number
}

interface NamespaceCacheEntry {
  namespaces: string[]
  timestamp: number
}

let cache: CacheEntry | null = null
let namespaceCache: NamespaceCacheEntry | null = null

function isValidHost(host: string): boolean {
  return (
    host.endsWith('.lilnas.io') &&
    !HOST_BLOCKLIST.has(host.replace('.lilnas.io', ''))
  )
}

async function fetchNamespacesFromKubernetes(
  kc: k8s.KubeConfig,
): Promise<string[]> {
  const now = Date.now()

  // Return cached namespaces if valid
  if (namespaceCache && now - namespaceCache.timestamp < CACHE_TTL) {
    return namespaceCache.namespaces
  }

  try {
    const coreApi = kc.makeApiClient(k8s.CoreV1Api)
    const { body } = await coreApi.listNamespace()

    const namespaces = body.items
      .map(ns => ns.metadata?.name)
      .filter(
        (name): name is string => !!name && name.startsWith(NAMESPACE_PREFIX),
      )
      .sort()

    // Update namespace cache
    namespaceCache = {
      namespaces,
      timestamp: now,
    }

    return namespaces
  } catch (error) {
    console.error('Failed to fetch namespaces:', error)

    // Return cached namespaces if available, even if expired
    if (namespaceCache) {
      return namespaceCache.namespaces
    }

    // Return empty array as last resort
    return []
  }
}

async function fetchHostsFromKubernetes(): Promise<string[]> {
  const kc = new k8s.KubeConfig()

  // Try in-cluster config first, fall back to default kubeconfig
  try {
    kc.loadFromCluster()
  } catch {
    kc.loadFromDefault()
  }

  // First, get all lilnas-* namespaces dynamically
  const namespaces = await fetchNamespacesFromKubernetes(kc)

  if (namespaces.length === 0) {
    console.warn('No lilnas-* namespaces found')
    return []
  }

  const k8sApi = kc.makeApiClient(k8s.NetworkingV1Api)
  const hosts = new Set<string>()

  for (const namespace of namespaces) {
    try {
      const { body } = await k8sApi.listNamespacedIngress(namespace)

      for (const ingress of body.items) {
        if (ingress.spec?.rules) {
          for (const rule of ingress.spec.rules) {
            if (rule.host && isValidHost(rule.host)) {
              hosts.add(rule.host)
            }
          }
        }
      }
    } catch (error) {
      // Log error but continue with other namespaces
      console.error(
        `Failed to fetch ingresses from namespace ${namespace}:`,
        error,
      )
    }
  }

  return Array.from(hosts).sort((a, b) => a.localeCompare(b))
}

export async function getAppHosts(): Promise<string[]> {
  const now = Date.now()

  // Return cached result if valid
  if (cache && now - cache.timestamp < CACHE_TTL) {
    return cache.hosts
  }

  try {
    const hosts = await fetchHostsFromKubernetes()

    // Update cache with new results
    cache = {
      hosts,
      timestamp: now,
    }

    return hosts
  } catch (error) {
    console.error('Failed to fetch hosts from Kubernetes:', error)

    // Return cached results if available, even if expired
    if (cache) {
      return cache.hosts
    }

    // Return empty array as last resort
    return []
  }
}
