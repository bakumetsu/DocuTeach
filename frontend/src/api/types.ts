export interface ModelInfo { id: string; label: string; sizeGb: number }
export interface ContextInfo { nCtx: number | null; promptCapChars: number; estimated: boolean }
export interface ModelState { id: string; status: 'loading' | 'ready' | 'failed' | 'unloaded'; error?: string }
export interface SkillInfo {
  command: string
  name: string
  description: string
  status: 'active' | 'planned'
  insertAs?: 'teacherNote' | 'blanks' | 'text'
  source?: 'builtin' | 'custom' | 'customized'
}
export type SkillInsertAs = 'teacherNote' | 'blanks' | 'text'
export interface SkillDraft { command: string; name: string; description: string; insertAs: SkillInsertAs; tag?: string | null; body: string; replace?: boolean }
export interface SkillDetail { command: string; name: string; description: string; insertAs: SkillInsertAs | ''; tag: string; body: string; source: 'builtin' | 'custom' | 'customized' | 'broken'; hidden: boolean; reason: string; code: string }
export interface SkillImportPreview { skill: { command: string; name: string; description: string; insertAs: SkillInsertAs; tag: string; body: string }; warnings: string[]; clash: null | 'builtin' | 'custom' }
export interface ManagedModel { id: string; label: string; sizeGb: number; state: 'loaded' | 'unloaded' | 'loading' | 'missing' | 'unknown'; isDefault: boolean; source: 'default' | 'added' }
export interface ModelManageList { models: ManagedModel[]; overlayError: string | null; overlayDir: string }
export interface ModelForm { id: string; model_path: string; parallel: number; ctx_per_chat: number; reasoning: boolean; temperature: number; top_p: number; top_k: number; min_p: number; ttl: number }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; stopped?: boolean; stats?: { in: number; out: number; tps: number | null } }
export type EditScope = 'selection' | 'section' | 'lesson'
export interface EditBlock { id: string; kind: string; md: string; role: 'edit' | 'context' }
export interface EditPayload { instruction: string; scope: EditScope; allowProtected: boolean; part?: { k: number; n: number; outline: string[] }; blocks: EditBlock[] }
export interface EditOp { opId: string; kind: 'replace' | 'insert' | 'delete' | 'move'; targets: string[]; anchor?: string; side?: 'before' | 'after'; markdown?: string; flags: string[] }
export interface ChatRequest {
  chatId: string; model: string; skill?: string
  messages: ChatMessage[]; selection?: string; refs?: { name: string; text: string }[]
  mode?: 'edit'; edit?: EditPayload
}
export type StreamEvent =
  | { type: 'status'; status: 'swapping' | 'generating' | 'thinking' }
  | { type: 'token'; text: string }
  | { type: 'structured'; kind: NonNullable<SkillInfo['insertAs']>; markdown: string }
  | { type: 'edit'; opId: string; kind: 'replace' | 'insert' | 'delete' | 'move'; targets: string[]; anchor?: string; side?: 'before' | 'after'; markdown?: string; flags: string[] }
  | { type: 'edit_skipped'; code: string; header: string }
  | { type: 'stats'; in: number; out: number; tps: number | null }
  | { type: 'done'; fallback?: 'text'; edits?: number; skipped?: number; noChange?: number }
  | { type: 'error'; message: string; code?: 'llm_offline' | 'llm_busy' | 'llm_timeout' | 'chat_busy' }
export interface DocRecord { id: string; markdown: string; updatedAt: string }
export interface Checkpoint { id: string; name: string; createdAt: string; markdown: string; auto?: boolean }
export interface ChatRecord {
  id: string; name: string; model: string
  messages: ChatMessage[]; refs: { name: string; text: string }[]
}
export interface LessonInfo { id: string; title: string; createdAt: string; updatedAt: string }
export interface ApiStatus { llm: 'online' | 'offline'; model: string | null; version: string }
export type ExportTarget = 'student_pdf' | 'teacher_docx'
export interface ExportPart { part: number; label: string; filename: string; targets: ExportTarget[] }
export interface ExportWarning { code: string; message: string }
export interface ExportResult { blob: Blob; filename: string; warnings: ExportWarning[] }
export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}
export interface DocuTeachApi {
  models:  { list(): Promise<ModelInfo[]>; current(): Promise<string | null>
             select(id: string, signal?: AbortSignal): Promise<ModelState>
             context(id: string): Promise<ContextInfo>
             manage(): Promise<ModelManageList>
             setDefault(id: string): Promise<void>
             unload(id?: string): Promise<void>
             customGet(id: string): Promise<ModelForm>
             customPreview(form: ModelForm): Promise<{ yaml: string }>
             customAdd(form: ModelForm): Promise<void>
             customEdit(id: string, form: ModelForm): Promise<void>
             customRemove(id: string): Promise<void>
             customUndo(): Promise<void>
             setServerPath(path: string): Promise<void>
             setOverlayDir(path: string): Promise<void> }
  chat:    { stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> }
  chats:   { load(docId: string): Promise<ChatRecord[]>; save(docId: string, chats: ChatRecord[]): Promise<void>
             release(chatId: string): Promise<void> }
  skills:  { list(): Promise<SkillInfo[]>
             manage(): Promise<SkillDetail[]>
             save(draft: SkillDraft): Promise<SkillDetail>
             importPreview(text: string): Promise<SkillImportPreview>
             importCommit(text: string, onClash?: 'rename' | 'replace', command?: string): Promise<SkillDetail>
             remove(command: string): Promise<{ trashId: string }>
             restore(trashId: string): Promise<SkillDetail>
             reset(command: string): Promise<void>
             restoreDefaults(): Promise<void>
             exportFile(command: string): Promise<{ blob: Blob; filename: string }> }
  lessons: { list(): Promise<LessonInfo[]>; create(title?: string): Promise<LessonInfo>
             rename(id: string, title: string): Promise<LessonInfo>
             remove(id: string): Promise<void>
             restore(id: string): Promise<LessonInfo> }
  status:  () => Promise<ApiStatus>
  fonts:   { openFolder(): Promise<void> }
  exports: { plan(markdown: string, title: string): Promise<ExportPart[]>
             download(markdown: string, title: string, target: ExportTarget, part: number): Promise<ExportResult> }
  docs:    { load(id: string): Promise<DocRecord | null>
             save(id: string, markdown: string): Promise<DocRecord>
             checkpoints: { list(id: string): Promise<Checkpoint[]>
                            create(id: string, name: string, markdown: string, opts?: { auto?: boolean }): Promise<Checkpoint>
                            restore(id: string, checkpointId: string): Promise<Checkpoint>
                            remove(id: string, checkpointId: string): Promise<void> } }
}
