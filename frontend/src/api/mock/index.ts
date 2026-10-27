import type { DocuTeachApi } from '../types'
import { mockDocs } from './docs'
import { mockModels } from './models'
import { mockChat, mockChats } from './chat'
import { mockSkills } from './skills'

export const mockApi: DocuTeachApi = {
  models: mockModels,
  chat: mockChat,
  chats: mockChats,
  skills: mockSkills,
  docs: mockDocs,
}
