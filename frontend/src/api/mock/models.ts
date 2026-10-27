import type { DocuTeachApi, ModelInfo, ModelState } from '../types'
import { mockConfig, sleep } from './config'

let currentModel: string | null = null

export function setCurrentModel(id: string | null): void {
  currentModel = id
}

export function getCurrentModel(): string | null {
  return currentModel
}

export const mockModels: DocuTeachApi['models'] = {
  list(): Promise<ModelInfo[]> {
    return Promise.resolve([
      { id: 'qwen-27b', label: 'Qwen 27B', sizeGb: 14.9 },
      { id: 'gemma-12b', label: 'Gemma 12B', sizeGb: 8.1 },
      { id: 'broken-model', label: 'Broken model', sizeGb: 6 },
    ])
  },
  current(): Promise<string | null> {
    return Promise.resolve(currentModel)
  },
  async select(id: string, signal?: AbortSignal): Promise<ModelState> {
    if (id === currentModel) {
      return { id, status: 'ready' }
    }
    if (id === 'broken-model') {
      await sleep(mockConfig.loadMs, signal)
      return { id, status: 'failed', error: 'Could not load' }
    }
    await sleep(mockConfig.loadMs, signal)
    currentModel = id
    return { id, status: 'ready' }
  },
}
