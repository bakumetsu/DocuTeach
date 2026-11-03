import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRequest, StreamEvent } from '../src/api/types';

// The client reads the token at module-evaluation time, so the meta tag
// must exist before we import the module.
const meta = document.createElement('meta');
meta.setAttribute('name', 'docuteach-token');
meta.setAttribute('content', 'tok123');
document.head.appendChild(meta);

const { httpApi } = await import('../src/api/http');

function ndjsonResponse(chunks: string[]): Response {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks) {
          c.enqueue(new TextEncoder().encode(chunk));
        }
        c.close();
      },
    }),
    { status: 200 },
  );
}

function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const req: ChatRequest = { chatId: 'c', model: 'm', messages: [{ role: 'user', content: 'hi' }] };

async function collectEvents(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const ev of iterable) {
    events.push(ev);
  }
  return events;
}

type ErrEvent = Extract<StreamEvent, { type: 'error' }>;

describe('http stream', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('events split across chunk boundaries are all delivered in order', async () => {
    const chunks = [
      '{"type":"status","status":"gene',
      'rating"}\n{"type":"token","text":"He',
      'llo"}\n{"type":"token","text":" wor',
      'ld"}\n{"type":"done"}\n',
    ];
    fetchMock.mockResolvedValue(ndjsonResponse(chunks));

    const events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));

    expect(events).toEqual([
      { type: 'status', status: 'generating' },
      { type: 'token', text: 'Hello' },
      { type: 'token', text: ' world' },
      { type: 'done' },
    ]);
  });

  it('non-JSON line and a line with unknown type are skipped', async () => {
    const chunks = [
      'this is not json\n',
      '{"type":"unknown_thing","data":"x"}\n',
      '{"type":"token","text":"ok"}\n',
      '{"type":"done"}\n',
    ];
    fetchMock.mockResolvedValue(ndjsonResponse(chunks));

    const events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));

    expect(events).toEqual([
      { type: 'token', text: 'ok' },
      { type: 'done' },
    ]);
  });

  it('body ending without done or error yields a final error event', async () => {
    const chunks = [
      '{"type":"status","status":"generating"}\n',
      '{"type":"token","text":"partial"}\n',
    ];
    fetchMock.mockResolvedValue(ndjsonResponse(chunks));

    const events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));

    const last = events[events.length - 1] as { type: string; message: string };
    expect(last).toEqual({ type: 'error', message: 'The model stopped unexpectedly' });
  });

  it('HTTP error responses yield a single error event with the correct code', async () => {
    // 409
    fetchMock.mockResolvedValue(jsonReply(409, { code: 'chat_busy' }));
    let events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));
    expect(events).toHaveLength(1);
    expect((events[0] as ErrEvent).type).toBe('error');
    expect((events[0] as ErrEvent).code).toBe('chat_busy');

    // 503
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonReply(503, { code: 'llm_offline' }));
    events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));
    expect(events).toHaveLength(1);
    expect((events[0] as ErrEvent).type).toBe('error');
    expect((events[0] as ErrEvent).code).toBe('llm_offline');

    // 429
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonReply(429, { code: 'llm_busy' }));
    events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));
    expect(events).toHaveLength(1);
    expect((events[0] as ErrEvent).type).toBe('error');
    expect((events[0] as ErrEvent).code).toBe('llm_busy');

    // 413 — message from body, no code
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      jsonReply(413, { code: 'prompt_too_long', message: 'Too long: keep it under about 18000 characters' }),
    );
    events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));
    expect(events).toHaveLength(1);
    expect((events[0] as ErrEvent).type).toBe('error');
    expect((events[0] as ErrEvent).message).toBe('Too long: keep it under about 18000 characters');
    expect((events[0] as ErrEvent).code).toBeUndefined();

    // TypeError (network failure)
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));
    expect(events).toHaveLength(1);
    expect((events[0] as ErrEvent).type).toBe('error');
    expect((events[0] as ErrEvent).code).toBe('llm_offline');
  });

  it('request has correct URL, method, header, body, and signal', async () => {
    fetchMock.mockResolvedValue(ndjsonResponse(['{"type":"done"}\n']));
    const controller = new AbortController();
    await collectEvents(httpApi.chat.stream(req, controller.signal));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chat/stream');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-DocuTeach-Token']).toBe('tok123');
    expect(init.body).toBe(JSON.stringify(req));
    expect(init.signal).toBe(controller.signal);
  });

  it('breaking out of the loop after the first event cancels the reader', async () => {
    const cancelSpy = vi.fn();
    const resp = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"type":"status","status":"generating"}\n'));
          c.enqueue(new TextEncoder().encode('{"type":"token","text":"x"}\n'));
        },
        cancel: cancelSpy,
      }),
      { status: 200 },
    );
    fetchMock.mockResolvedValue(resp);

    const events: unknown[] = [];
    for await (const ev of httpApi.chat.stream(req, new AbortController().signal)) {
      events.push(ev);
      if (events.length === 1) break;
    }

    expect(events).toHaveLength(1);
    expect(cancelSpy).toHaveBeenCalled();
  });

  it('structured event with bad kind is dropped; valid structured and done pass through', async () => {
    const chunks = [
      '{"type":"structured","kind":"badKind","markdown":"x"}\n',
      '{"type":"structured","kind":"teacherNote","markdown":"x"}\n',
      '{"type":"done","fallback":"text"}\n',
    ];
    fetchMock.mockResolvedValue(ndjsonResponse(chunks));

    const events = await collectEvents(httpApi.chat.stream(req, new AbortController().signal));

    expect(events).toEqual([
      { type: 'structured', kind: 'teacherNote', markdown: 'x' },
      { type: 'done', fallback: 'text' },
    ]);
  });

  it('chats.release POSTs to /api/chats/<id>/release and does not throw on rejection', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await httpApi.chats.release('a b');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/chats/a%20b/release');
    expect(init.method).toBe('POST');

    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(httpApi.chats.release('a b')).resolves.toBeUndefined();
  });
});
