import type { DocuTeachApi, SkillInfo } from '../types'

export const mockSkills: DocuTeachApi['skills'] = {
  list(): Promise<SkillInfo[]> {
    return Promise.resolve([
      {
        command: '/ccq',
        name: 'CCQ',
        description: 'Concept-check questions as a teacher note',
        status: 'active',
        insertAs: 'teacherNote',
      },
      {
        command: '/drills',
        name: '5 Drills',
        description: 'Five numbered practice sentences with blanks',
        status: 'active',
        insertAs: 'blanks',
      },
      {
        command: '/pitfalls',
        name: 'Pitfalls',
        description: 'Common mistakes as a teacher note',
        status: 'active',
        insertAs: 'teacherNote',
      },
      {
        command: '/homework',
        name: 'Homework',
        description: 'A homework set',
        status: 'planned',
      },
      {
        command: '/transform',
        name: 'Transform',
        description: 'Sentence transformations',
        status: 'planned',
      },
      {
        command: '/errors',
        name: 'Errors',
        description: 'Find and fix the error',
        status: 'planned',
      },
    ])
  },
}
