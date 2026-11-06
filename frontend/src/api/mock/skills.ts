import { ApiError } from '../types'
import type { DocuTeachApi, SkillInfo, SkillDetail, SkillDraft, SkillImportPreview, SkillInsertAs } from '../types'

const SEEDS: SkillDetail[] = [
  { command: '/ccq', name: 'CCQ', description: 'Concept-check questions as a teacher note', insertAs: 'teacherNote', tag: '', body: 'Ask: What is the main idea? Who is it about? What happens next?', source: 'builtin', hidden: false, reason: '', code: '' },
  { command: '/drills', name: '5 Drills', description: 'Five numbered practice sentences with blanks', insertAs: 'blanks', tag: '', body: '1. She ___ to school every day.\n2. He ___ his homework.\n3. They ___ in the garden.\n4. We ___ a new book.\n5. I ___ at the park.', source: 'builtin', hidden: false, reason: '', code: '' },
  { command: '/pitfalls', name: 'Pitfalls', description: 'Common mistakes as a teacher note', insertAs: 'teacherNote', tag: '', body: 'Common errors: confusing "affect" and "effect"; missing subject in imperatives.', source: 'builtin', hidden: false, reason: '', code: '' },
  { command: '/homework', name: 'Homework', description: 'A homework set', insertAs: '', tag: '', body: 'Complete the exercises and read page 42 for class.', source: 'builtin', hidden: false, reason: '', code: '' },
  { command: '/transform', name: 'Transform', description: 'Sentence transformations', insertAs: '', tag: '', body: 'Rewrite: She went to the store. → She went to the store yesterday.', source: 'builtin', hidden: false, reason: '', code: '' },
  { command: '/errors', name: 'Errors', description: 'Find and fix the error', insertAs: '', tag: '', body: 'Find the mistake: "He don\'t like apples." → "He doesn\'t like apples."', source: 'builtin', hidden: false, reason: '', code: '' },
]

const store = new Map<string, SkillDetail>(SEEDS.map(d => [d.command, { ...d }]))
const trash = new Map<string, SkillDetail>()
let trashCounter = 0

function parseImport(text: string): { command: string; name: string; description: string; insertAs: SkillInsertAs; body: string; tag: string } {
  let command = ''
  let name = ''
  let description = ''
  let insertAs: SkillInsertAs = 'text'
  const bodyLines: string[] = []

  for (const line of text.split('\n')) {
    if (line.startsWith('command:')) {
      command = line.slice(8).trim()
    } else if (line.startsWith('name:')) {
      name = line.slice(5).trim()
    } else if (line.startsWith('description:')) {
      description = line.slice(12).trim()
    } else if (line.startsWith('insertAs:')) {
      insertAs = line.slice(9).trim() as SkillInsertAs
    } else {
      bodyLines.push(line)
    }
  }

  return { command, name, description, insertAs, body: bodyLines.join('\n').trim(), tag: '' }
}

function toInfo(d: SkillDetail): SkillInfo {
  const status: 'active' | 'planned' = d.insertAs ? 'active' : 'planned'
  const info: SkillInfo = { command: d.command, name: d.name, description: d.description, status }
  if (d.insertAs) info.insertAs = d.insertAs as SkillInsertAs
  if (d.source !== 'broken') info.source = d.source
  return info
}

export const mockSkills: DocuTeachApi['skills'] = {
  list(): Promise<SkillInfo[]> {
    const out: SkillInfo[] = []
    for (const d of store.values()) {
      if (!d.hidden) out.push(toInfo(d))
    }
    return Promise.resolve(out)
  },

  manage(): Promise<SkillDetail[]> {
    return Promise.resolve(Array.from(store.values()).map(d => ({ ...d })))
  },

  save(draft: SkillDraft): Promise<SkillDetail> {
    if (!draft.command.startsWith('/')) {
      throw new ApiError('bad_command', 400, 'Command must start with /')
    }
    const existing = store.get(draft.command)
    if (existing && !draft.replace) {
      throw new ApiError('skill_exists', 409, `Skill ${draft.command} already exists`)
    }
    const source = existing && existing.source === 'builtin' ? 'customized' : 'custom'
    const detail: SkillDetail = {
      command: draft.command,
      name: draft.name,
      description: draft.description,
      insertAs: draft.insertAs,
      tag: draft.tag ?? '',
      body: draft.body,
      source,
      hidden: false,
      reason: '',
      code: '',
    }
    store.set(draft.command, detail)
    return Promise.resolve({ ...detail })
  },

  importPreview(text: string): Promise<SkillImportPreview> {
    const p = parseImport(text)
    let clash: null | 'builtin' | 'custom' = null
    const existing = store.get(p.command)
    if (existing) {
      clash = (existing.source === 'builtin' || existing.source === 'customized') ? 'builtin' : 'custom'
    }
    return Promise.resolve({
      skill: { command: p.command, name: p.name, description: p.description, insertAs: p.insertAs, tag: p.tag, body: p.body },
      warnings: [],
      clash,
    })
  },

  importCommit(text: string, onClash?: 'rename' | 'replace', command?: string): Promise<SkillDetail> {
    const p = parseImport(text)
    let cmd = command ?? p.command
    if (!cmd.startsWith('/')) {
      throw new ApiError('bad_command', 400, 'Command must start with /')
    }
    const existing = store.get(cmd)
    if (existing) {
      if (!onClash) {
        throw new ApiError('skill_exists', 409, `Skill ${cmd} already exists`)
      }
      if (onClash === 'rename') {
        cmd += '-2'
      }
    }
    const finalExisting = store.get(cmd)
    const source = finalExisting && finalExisting.source === 'builtin' ? 'customized' : 'custom'
    const detail: SkillDetail = {
      command: cmd,
      name: p.name,
      description: p.description,
      insertAs: p.insertAs,
      tag: p.tag,
      body: p.body,
      source,
      hidden: false,
      reason: '',
      code: '',
    }
    store.set(cmd, detail)
    return Promise.resolve({ ...detail })
  },

  remove(command: string): Promise<{ trashId: string }> {
    const detail = store.get(command)
    if (!detail) {
      throw new ApiError('not_found', 404, `Skill ${command} not found`)
    }
    if (detail.source === 'builtin') {
      detail.hidden = true
    } else {
      store.delete(command)
    }
    trashCounter++
    const trashId = `t${trashCounter}`
    trash.set(trashId, { ...detail })
    return Promise.resolve({ trashId })
  },

  restore(trashId: string): Promise<SkillDetail> {
    const detail = trash.get(trashId)
    if (!detail) {
      throw new ApiError('not_found', 404, `Trash item ${trashId} not found`)
    }
    trash.delete(trashId)
    detail.hidden = false
    store.set(detail.command, { ...detail })
    return Promise.resolve({ ...detail })
  },

  reset(command: string): Promise<void> {
    const seed = SEEDS.find(s => s.command === command)
    if (!seed) {
      throw new ApiError('not_found', 404, `Builtin skill ${command} not found`)
    }
    store.set(command, { ...seed })
    return Promise.resolve()
  },

  restoreDefaults(): Promise<void> {
    for (const seed of SEEDS) {
      store.set(seed.command, { ...seed })
    }
    return Promise.resolve()
  },

  exportFile(command: string): Promise<{ blob: Blob; filename: string }> {
    const detail = store.get(command)
    if (!detail) {
      throw new ApiError('not_found', 404, `Skill ${command} not found`)
    }
    const text = `command: ${detail.command}\nname: ${detail.name}\ndescription: ${detail.description}\ninsertAs: ${detail.insertAs}\n\n${detail.body}`
    const blob = new Blob([text])
    const filename = command.slice(1) + '.md'
    return Promise.resolve({ blob, filename })
  },
}
