import { ApiError } from '../types'
import type {
  ContextInfo,
  DocuTeachApi,
  ManagedModel,
  ModelForm,
  ModelInfo,
  ModelManageList,
  ModelState,
} from '../types'
import { mockConfig, sleep } from './config'

let currentModel: string | null = null

export function setCurrentModel(id: string | null): void {
  currentModel = id
}

export function getCurrentModel(): string | null {
  return currentModel
}

const store: ManagedModel[] = [
  { id: 'qwen-27b', label: 'Qwen 27B', sizeGb: 14.9, state: 'unloaded', isDefault: true, source: 'default' },
  { id: 'gemma-12b', label: 'Gemma 12B', sizeGb: 8.1, state: 'unloaded', isDefault: false, source: 'default' },
  { id: 'broken-model', label: 'Broken model', sizeGb: 6, state: 'unloaded', isDefault: false, source: 'default' },
]

const forms = new Map<string, ModelForm>()
let undo: { models: ManagedModel[]; forms: Map<string, ModelForm> } | null = null
const overlayError: string | null = null

function snapshot(): void {
  const f = new Map<string, ModelForm>()
  for (const [k, v] of forms) f.set(k, { ...v })
  undo = {
    models: store.map((m) => ({ ...m })),
    forms: f,
  }
}

export const mockModels: DocuTeachApi['models'] = {
  list(): Promise<ModelInfo[]> {
    return Promise.resolve(store.map((m) => ({ id: m.id, label: m.label, sizeGb: m.sizeGb })))
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
  context(): Promise<ContextInfo> {
    return Promise.resolve({ nCtx: 8192, promptCapChars: 18432, estimated: true })
  },
  manage(): Promise<ModelManageList> {
    const models: ManagedModel[] = store.map((m) => ({
      ...m,
      state: m.id === currentModel ? 'loaded' : 'unloaded',
    }))
    return Promise.resolve({ models, overlayError })
  },
  async setDefault(id: string): Promise<void> {
    for (const m of store) m.isDefault = m.id === id
    return
  },
  async unload(id?: string): Promise<void> {
    if (id === undefined || id === currentModel) {
      setCurrentModel(null)
    }
    return
  },
  customPreview(form: ModelForm): Promise<{ yaml: string }> {
    const yaml = Object.entries(form)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
    return Promise.resolve({ yaml })
  },
  async customAdd(form: ModelForm): Promise<void> {
    if (store.some((m) => m.id === form.id)) {
      throw new ApiError('model_exists', 409, `Model "${form.id}" already exists`)
    }
    snapshot()
    store.push({ id: form.id, label: form.id, sizeGb: 0, state: 'unloaded', isDefault: false, source: 'added' })
    forms.set(form.id, { ...form })
    return
  },
  customGet(id: string): Promise<ModelForm> {
    const f = forms.get(id)
    if (!f) return Promise.reject(new ApiError('not_found', 404, `Added model "${id}" not found`))
    return Promise.resolve({ ...f })
  },
  async customEdit(id: string, form: ModelForm): Promise<void> {
    const model = store.find((m) => m.id === id)
    if (!model || model.source !== 'added') {
      throw new ApiError('not_found', 404, `Added model "${id}" not found`)
    }
    snapshot()
    forms.set(id, { ...form })
    return
  },
  async customRemove(id: string): Promise<void> {
    const model = store.find((m) => m.id === id)
    if (!model || model.source !== 'added') {
      throw new ApiError('not_found', 404, `Added model "${id}" not found`)
    }
    snapshot()
    store.splice(store.indexOf(model), 1)
    forms.delete(id)
    if (currentModel === id) setCurrentModel(null)
    return
  },
  async customUndo(): Promise<void> {
    if (!undo) {
      throw new ApiError('undo_invalid', 409, 'No operation to undo')
    }
    store.length = 0
    for (const m of undo.models) store.push({ ...m })
    forms.clear()
    for (const [k, v] of undo.forms) forms.set(k, { ...v })
    undo = null
    return
  },
  async setServerPath(path: string): Promise<void> {
    if (!path) {
      throw new ApiError('llama_server_missing', 400, 'LLM server path is required')
    }
    // path accepted; the mock keeps nothing
    return
  },
}
