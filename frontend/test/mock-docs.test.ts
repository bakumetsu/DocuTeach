import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockDocs } from '../src/api/mock/docs'

describe('mockDocs', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('saves and loads a document round trip', async () => {
    await mockDocs.save('doc-1', '# Hello')

    const record = await mockDocs.load('doc-1')

    expect(record).not.toBeNull()
    expect(record?.id).toBe('doc-1')
    expect(record?.markdown).toBe('# Hello')
    expect(typeof record?.updatedAt).toBe('string')
  })

  it('returns null for an unknown document id', async () => {
    const record = await mockDocs.load('missing')
    expect(record).toBeNull()
  })

  it('creates, lists, and removes checkpoints', async () => {
    const cp = await mockDocs.checkpoints.create('doc-1', 'First', 'content')

    let list = await mockDocs.checkpoints.list('doc-1')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(cp.id)
    expect(list[0].name).toBe('First')
    expect(list[0].markdown).toBe('content')

    await mockDocs.checkpoints.remove('doc-1', cp.id)
    list = await mockDocs.checkpoints.list('doc-1')
    expect(list).toHaveLength(0)
  })

  it('lists checkpoints newest first', async () => {
    await mockDocs.checkpoints.create('doc-1', 'first', '1')
    await mockDocs.checkpoints.create('doc-1', 'second', '2')
    await mockDocs.checkpoints.create('doc-1', 'third', '3')

    const list = await mockDocs.checkpoints.list('doc-1')
    expect(list.map((c) => c.name)).toEqual(['third', 'second', 'first'])
  })

  it('caps checkpoints at 50 and prunes the oldest', async () => {
    for (let i = 0; i < 52; i += 1) {
      await mockDocs.checkpoints.create('doc-1', `cp-${i}`, `m-${i}`)
    }

    const list = await mockDocs.checkpoints.list('doc-1')
    expect(list).toHaveLength(50)
    expect(list[0].name).toBe('cp-51')
    expect(list[49].name).toBe('cp-2')
    expect(list.map((c) => c.name)).not.toContain('cp-0')
    expect(list.map((c) => c.name)).not.toContain('cp-1')
  })

  it('keeps the newest Before open checkpoint even when it is the oldest', async () => {
    await mockDocs.checkpoints.create('doc-1', 'Before open', 'before')
    for (let i = 0; i < 50; i += 1) {
      await mockDocs.checkpoints.create('doc-1', `other-${i}`, `m-${i}`)
    }

    const list = await mockDocs.checkpoints.list('doc-1')
    expect(list).toHaveLength(50)
    expect(list[49].name).toBe('Before open')
    expect(list[0].name).toBe('other-49')
    expect(list.map((c) => c.name)).not.toContain('other-0')
  })

  it('prunes older Before open checkpoints while keeping the newest one', async () => {
    await mockDocs.checkpoints.create('doc-1', 'Before open', 'old-before')
    for (let i = 0; i < 30; i += 1) {
      await mockDocs.checkpoints.create('doc-1', `filler-${i}`, `m-${i}`)
    }
    await mockDocs.checkpoints.create('doc-1', 'Before open', 'new-before')

    for (let i = 0; i < 22; i += 1) {
      await mockDocs.checkpoints.create('doc-1', `more-${i}`, `m-${i}`)
    }

    const list = await mockDocs.checkpoints.list('doc-1')
    expect(list).toHaveLength(50)
    expect(list.filter((c) => c.name === 'Before open')).toHaveLength(1)
    expect(list[0].name).toBe('more-21')
  })

  it('rejects save when localStorage.setItem throws', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    await expect(mockDocs.save('doc-1', 'content')).rejects.toThrow('quota exceeded')
  })
})
