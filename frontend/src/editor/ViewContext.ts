import { createContext, useContext } from 'react'

export type ViewMode = 'edit' | 'teacher' | 'student'

export const ViewContext = createContext<ViewMode>('edit')

export const useViewMode = (): ViewMode => useContext(ViewContext)
