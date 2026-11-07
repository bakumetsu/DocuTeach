import { ApiError, type DocuTeachApi } from '../types'

export const mockExports: DocuTeachApi['exports'] = {
  plan: async () => {
    return [
      { part: 1, label: 'Lesson', filename: 'Lesson.pdf', targets: ['student_pdf', 'teacher_docx'] }
    ]
  },
  download: async () => {
    throw new ApiError('needs_backend', 0, 'Export needs the DocuTeach app')
  }
}
