import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockLessons, mockStatus } from '../src/api/mock/lessons'
import { mockDocs } from '../src/api/mock/docs'

describe('mockLessons', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('create returns a LessonInfo and writes a doc "# <title>\\n" loadable via mockDocs.load', async () => {
    const lesson = await mockLessons.create('My Lesson')

    expect(lesson.title).toBe('My Lesson')
    expect(typeof lesson.id).toBe('string')
    expect(typeof lesson.createdAt).toBe('string')
    expect(typeof lesson.updatedAt).toBe('string')

    const doc = await mockDocs.load(lesson.id)
    expect(doc).not.toBeNull()
    expect(doc?.markdown).toBe('# My Lesson\n')
  })

  it('create() without title uses "New lesson"', async () => {
    const lesson = await mockLessons.create()
    expect(lesson.title).toBe('New lesson')
  })

  it('list sorts newest updatedAt first', async () => {
    vi.useFakeTimers()

    const a = await mockLessons.create('A')
    vi.setSystemTime(new Date(Date.now() + 1000))
    const b = await mockLessons.create('B')
    vi.setSystemTime(new Date(Date.now() + 1000))
    const c = await mockLessons.create('C')

    const list = await mockLessons.list()
    expect(list.map((l) => l.id)).toEqual([c.id, b.id, a.id])
    vi.useRealTimers()
  })

  it('rename updates the title', async () => {
    const lesson = await mockLessons.create('Old')
    await mockLessons.rename(lesson.id, 'New Title')

    const list = await mockLessons.list()
    const updated = list.find((l) => l.id === lesson.id)
    expect(updated?.title).toBe('New Title')
  })

  it('rename throws ApiError code lesson_not_found for an unknown id', async () => {
    await expect(mockLessons.rename('unknown', 'X')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'lesson_not_found',
    })
  })

  it('remove drops it from list and restore brings it back with the same id', async () => {
    const lesson = await mockLessons.create('Temp')
    await mockLessons.remove(lesson.id)

    let list = await mockLessons.list()
    expect(list.find((l) => l.id === lesson.id)).toBeUndefined()

    await mockLessons.restore(lesson.id)
    list = await mockLessons.list()
    expect(list.find((l) => l.id === lesson.id)).toBeDefined()
  })

  it('restore of an id not in the trash rejects', async () => {
    await expect(mockLessons.restore('never-existed')).rejects.toThrow()
  })

  it('mockDocs.checkpoints.create with {auto:true} stores auto:true', async () => {
    const lesson = await mockLessons.create('Doc')
    const cp = await mockDocs.checkpoints.create(lesson.id, 'Auto CP', 'content', { auto: true })
    expect(cp.auto).toBe(true)
  })

  it('checkpoint remove then restore brings the checkpoint back in list', async () => {
    const lesson = await mockLessons.create('Doc')
    const cp = await mockDocs.checkpoints.create(lesson.id, 'CP1', 'm')

    await mockDocs.checkpoints.remove(lesson.id, cp.id)
    let list = await mockDocs.checkpoints.list(lesson.id)
    expect(list).toHaveLength(0)

    await mockDocs.checkpoints.restore(lesson.id, cp.id)
    list = await mockDocs.checkpoints.list(lesson.id)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(cp.id)
  })

  it('checkpoint restore of an unknown id rejects with checkpoint_not_found', async () => {
    const lesson = await mockLessons.create('Doc')
    await expect(mockDocs.checkpoints.restore(lesson.id, 'ghost')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'checkpoint_not_found',
    })
  })

  it('mockStatus() returns llm "online"', async () => {
    const status = await mockStatus()
    expect(status.llm).toBe('online')
  })
})
