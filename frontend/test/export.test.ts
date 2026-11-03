import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Editor } from '@tiptap/core'

vi.mock('../src/editor/docio', () => ({ docToMarkdown: () => '# md' }))

document.head.insertAdjacentHTML('beforeend', '<meta name="docuteach-token" content="tok">')

const { httpApi } = await import('../src/api/http')
const { ApiError } = await import('../src/api/types')
const { useApp } = await import('../src/state/store')
const { runExport } = await import('../src/files/exportActions')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('httpApi.exports.plan', () => {
  it('POSTs to /api/export/plan and returns parsed parts', async () => {
    const parts = [{ part: 1, targets: ['student_pdf'], label: 'Lesson' }]
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(parts), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpApi.exports.plan('# x', 'T')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/export/plan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ markdown: '# x', title: 'T' })
      })
    )
    expect(result).toEqual(parts)
  })
})

describe('httpApi.exports.download', () => {
  const cdHeader = 'attachment; filename="a.pdf"; filename*=UTF-8\'\'T%20-%20Lesson%20-%20student.pdf'
  const warningsHeader = encodeURIComponent(JSON.stringify([{ code: 'fonts_not_embedded', message: 'm' }]))

  it('returns filename, warnings, and blob from full headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('PDF', {
        status: 200,
        headers: {
          'Content-Disposition': cdHeader,
          'X-DocuTeach-Warnings': warningsHeader
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpApi.exports.download('# x', 'T', 'student_pdf', 1)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/export',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ markdown: '# x', title: 'T', target: 'student_pdf', part: 1 })
      })
    )
    expect(result.filename).toBe('T - Lesson - student.pdf')
    expect(result.warnings).toEqual([{ code: 'fonts_not_embedded', message: 'm' }])
    expect(result.blob.size).toBe(3)
  })

  it('falls back to plain filename when no star header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('PDF', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="a.pdf"' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpApi.exports.download('# x', 'T', 'student_pdf', 1)
    expect(result.filename).toBe('a.pdf')
  })

  it('falls back to export when no Content-Disposition header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('PDF', { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpApi.exports.download('# x', 'T', 'student_pdf', 1)
    expect(result.filename).toBe('export')
  })

  it('returns empty warnings array for garbage header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('PDF', {
        status: 200,
        headers: { 'X-DocuTeach-Warnings': 'garbage{{{not-json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await httpApi.exports.download('# x', 'T', 'student_pdf', 1)
    expect(result.warnings).toEqual([])
  })
})

describe('httpApi.exports.download error handling', () => {
  it('rejects with ApiError on 422', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'bad_split', message: 'Pages overlap' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const err = await httpApi.exports.download('# x', 'T', 'student_pdf', 1).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('bad_split')
    expect(err.status).toBe(422)
  })
})

describe('runExport', () => {
  beforeEach(() => {
    useApp.setState({
      editor: {} as unknown as Editor,
      lessonTitle: 'T',
      fileName: '',
      showToast: (msg: string) => { useApp.setState({ toast: msg }) },
      toast: ''
    })
  })

  it('downloads all targets in order and shows combined toast with warnings', async () => {
    const cdHeader = 'attachment; filename="a.pdf"; filename*=UTF-8\'\'T%20-%20Lesson%20-%20student.pdf'
    const warningsHeader = encodeURIComponent(JSON.stringify([{ code: 'fonts_not_embedded', message: 'm' }]))

    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response('PDF', {
        status: 200,
        headers: {
          'Content-Disposition': cdHeader,
          'X-DocuTeach-Warnings': warningsHeader
        }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await runExport({ part: 1, label: 'Lesson', filename: 'x', targets: ['student_pdf', 'teacher_docx'] })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(clickSpy).toHaveBeenCalledTimes(2)

    const toast = useApp.getState().toast as string
    expect(toast).toContain('Exported 2 files')
    expect((toast.match(/m/g) || []).length).toBe(1)
  })

  it('downloads single target when only is specified', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response('PDF', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="a.pdf"' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await runExport({ part: 1, label: 'Lesson', filename: 'x', targets: ['student_pdf', 'teacher_docx'] }, 'teacher_docx')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).target).toBe('teacher_docx')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })
})
