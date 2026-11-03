import type { DocuTeachApi } from '../types'
import { mockDocs } from './docs'
import { mockModels } from './models'
import { mockChat, mockChats } from './chat'
import { mockSkills } from './skills'
import { mockLessons, mockStatus } from './lessons'
import { mockExports } from './exports'

export const mockApi: DocuTeachApi = {
  models: mockModels,
  chat: mockChat,
  chats: mockChats,
  skills: mockSkills,
  lessons: mockLessons,
  status: mockStatus,
  docs: mockDocs,
  exports: mockExports,
}
