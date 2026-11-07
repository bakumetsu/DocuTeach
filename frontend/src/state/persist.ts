import { kvGet, kvSet } from '../api/kv'

const PREFIX = 'docuteach:v1:'

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = kvGet(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    kvSet(PREFIX + key, JSON.stringify(value))
  } catch {
    // storage full or unavailable – silently ignore
  }
}
