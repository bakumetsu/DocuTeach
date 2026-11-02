import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The client reads the token at module-evaluation time, so the meta tag
// must exist before we import the module.
const meta = document.createElement('meta')
meta.setAttribute('name', 'docuteach-token')
meta.setAttribute('content', 'tok123')
document.head.appendChild(meta)

const { httpApi } = await import('../src/api/http')

function reply(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), { status })
}

describe('http client', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends every call to /api/... with X-DocuTeach-Token header', async () => {
    fetchMock.mockResolvedValue(reply(200, []))
    await httpApi.lessons.list()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons')
    expect(init.headers['X-DocuTeach-Token']).toBe('tok123')
  })

  it('lessons.list -> GET /api/lessons returns the parsed array', async () => {
    const data = [{ id: '1', title: 'A', createdAt: 'c', updatedAt: 'u' }]
    fetchMock.mockResolvedValue(reply(200, data))

    const result = await httpApi.lessons.list()

    expect(result).toEqual(data)
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })

  it('lessons.create("A") POSTs JSON {title:"A"} with Content-Type application/json (200)', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: '1', title: 'A', createdAt: '', updatedAt: '' }))
    await httpApi.lessons.create('A')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ title: 'A' }))
  })

  it('lessons.create("A") accepts a 201 reply', async () => {
    fetchMock.mockResolvedValue(reply(201, { id: '1', title: 'A', createdAt: '', updatedAt: '' }))
    const result = await httpApi.lessons.create('A')
    expect(result.title).toBe('A')
  })

  it('lessons.rename -> PATCH /api/lessons/<id> body {title}', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'x', title: 'New', createdAt: '', updatedAt: '' }))
    await httpApi.lessons.rename('x', 'New')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons/x')
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe(JSON.stringify({ title: 'New' }))
  })

  it('lessons.remove -> DELETE and resolves undefined for an empty or {id} body', async () => {
    fetchMock.mockResolvedValue(reply(200))
    const r1 = await httpApi.lessons.remove('doc-1')
    expect(r1).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(reply(200, { id: 'doc-1' }))
    await httpApi.lessons.remove('doc-1')
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('lessons.restore -> POST /api/lessons/<id>/restore', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'x', title: 'T', createdAt: '', updatedAt: '' }))
    await httpApi.lessons.restore('x')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons/x/restore')
    expect(init.method).toBe('POST')
  })

  it('ids are URL-encoded ("a b" becomes "a%20b")', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'a b', title: 'T', createdAt: '', updatedAt: '' }))
    await httpApi.lessons.rename('a b', 'T')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/lessons/a%20b')
  })

  it('docs.load returns null on a 404 reply and the record on 200', async () => {
    fetchMock.mockResolvedValue(reply(404, { code: 'not_found', message: 'Not found' }))
    const nullRes = await httpApi.docs.load('missing')
    expect(nullRes).toBeNull()

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(reply(200, { id: 'd', markdown: '# Hi', updatedAt: '' }))
    const record = await httpApi.docs.load('d')
    expect(record).toEqual({ id: 'd', markdown: '# Hi', updatedAt: '' })
  })

  it('docs.save PUTs {markdown}', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'd', markdown: '# Hi', updatedAt: '' }))
    await httpApi.docs.save('d', '# Hi')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons/d/doc')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(JSON.stringify({ markdown: '# Hi' }))
  })

  it('docs.checkpoints.create posts {name, markdown, auto:false} by default', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'cp', name: 'F', createdAt: '', markdown: 'm' }))
    await httpApi.docs.checkpoints.create('doc-1', 'F', 'm')

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ name: 'F', markdown: 'm', auto: false })
  })

  it('docs.checkpoints.create posts auto:true with opts {auto:true}', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'cp', name: 'A', createdAt: '', markdown: 'm', auto: true }))
    await httpApi.docs.checkpoints.create('doc-1', 'A', 'm', { auto: true })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({ name: 'A', markdown: 'm', auto: true })
  })

  it('docs.checkpoints.restore posts to /api/lessons/<id>/checkpoints/<cid>/restore', async () => {
    fetchMock.mockResolvedValue(reply(200, { id: 'cp', name: 'F', createdAt: '', markdown: 'm' }))
    await httpApi.docs.checkpoints.restore('doc-1', 'cp')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons/doc-1/checkpoints/cp/restore')
    expect(init.method).toBe('POST')
  })

  it('docs.checkpoints.remove uses DELETE', async () => {
    fetchMock.mockResolvedValue(reply(200))
    await httpApi.docs.checkpoints.remove('doc-1', 'cp')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons/doc-1/checkpoints/cp')
    expect(init.method).toBe('DELETE')
  })

  it('chats.save PUTs the array to /api/lessons/<id>/chats', async () => {
    const chats = [{ id: 'c1', name: 'Chat', model: 'gpt', messages: [], refs: [] }]
    fetchMock.mockResolvedValue(reply(200))
    await httpApi.chats.save('doc-1', chats)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/lessons/doc-1/chats')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(JSON.stringify(chats))
  })

  it('error reply with code rejects with ApiError carrying code, status, message', async () => {
    fetchMock.mockResolvedValue(
      reply(404, { code: 'lesson_not_found', message: 'Lesson not found' }),
    )

    await expect(httpApi.lessons.rename('x', 'y')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'lesson_not_found',
      status: 404,
      message: 'Lesson not found',
    })
  })

  it('fetch rejecting with TypeError becomes ApiError code "network" status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(httpApi.lessons.list()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'network',
      status: 0,
    })
  })

  it('AbortError is rethrown unchanged', async () => {
    const abortErr = new Error('Aborted')
    abortErr.name = 'AbortError'
    fetchMock.mockRejectedValue(abortErr)

    await expect(httpApi.lessons.list()).rejects.toBe(abortErr)
  })

  it('status() returns the reply on success', async () => {
    const status = { llm: 'online' as const, model: 'gpt', version: '1.0' }
    fetchMock.mockResolvedValue(reply(200, status))

    const result = await httpApi.status()
    expect(result).toEqual(status)
  })

  it('status() returns offline fallback when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))

    const result = await httpApi.status()
    expect(result).toEqual({ llm: 'offline', model: null, version: '' })
  })

  it('status() returns offline fallback when reply is 500', async () => {
    fetchMock.mockResolvedValue(reply(500, { code: 'server_error', message: 'Internal' }))

    const result = await httpApi.status()
    expect(result).toEqual({ llm: 'offline', model: null, version: '' })
  })

  it('a 200 reply with a non-JSON body rejects with ApiError bad_response', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))

    await expect(httpApi.lessons.list()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'bad_response',
    })
  })
})
