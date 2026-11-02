import type { DocuTeachApi } from './types'
import { mockApi } from './mock'
import { hasToken } from './http/client'
import { httpApi } from './http'

export const api: DocuTeachApi = hasToken() ? httpApi : mockApi
