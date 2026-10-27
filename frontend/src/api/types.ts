export interface ModelInfo { id: string; label: string; sizeGb: number }
export interface ModelState { id: string; status: 'loading' | 'ready' | 'failed'; error?: string }
export interface SkillInfo {
  command: string
  name: string
  description: string
  status: 'active' | 'planned'
  insertAs?: 'teacherNote' | 'blanks' | 'text'
}
export interface ChatMessage { role: 'user' | 'assistant'; content: string; stopped?: boolean }
export interface ChatRequest {
  chatId: string; model: string; skill?: string
  messages: ChatMessage[]; selection?: string; refs?: { name: string; text: string }[]
}
export type StreamEvent =
  | { type: 'status'; status: 'swapping' | 'generating' }
  | { type: 'token'; text: string }
  | { type: 'structured'; kind: NonNullable<SkillInfo['insertAs']>; markdown: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
export interface DocRecord { id: string; markdown: string; updatedAt: string }
export interface Checkpoint { id: string; name: string; createdAt: string; markdown: string }
export interface ChatRecord {
  id: string; name: string; model: string
  messages: ChatMessage[]; refs: { name: string; text: string }[]
}
export interface DocuTeachApi {
  models: { list(): Promise<ModelInfo[]>; current(): Promise<string | null>
            select(id: string, signal?: AbortSignal): Promise<ModelState> }
  chat:   { stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> }
  chats:  { load(docId: string): Promise<ChatRecord[]>; save(docId: string, chats: ChatRecord[]): Promise<void>
            release(chatId: string): Promise<void> }
  skills: { list(): Promise<SkillInfo[]> }
  docs:   { load(id: string): Promise<DocRecord | null>
            save(id: string, markdown: string): Promise<DocRecord>
            checkpoints: { list(id: string): Promise<Checkpoint[]>
                           create(id: string, name: string, markdown: string): Promise<Checkpoint>
                           remove(id: string, checkpointId: string): Promise<void> } }
}
