import { describe, expect, it, vi } from 'vitest';

const backendUrl = process.env.DOCUTEACH_BACKEND_URL;
const token = process.env.DOCUTEACH_TEST_TOKEN;

// The client reads the token at module-evaluation time, so the meta tag
// must exist before we import the module.
const meta = document.createElement('meta');
meta.setAttribute('name', 'docuteach-token');
meta.setAttribute('content', token ?? '');
document.head.appendChild(meta);

// Wrap fetch so that relative '/api/...' URLs are prefixed with the
// backend URL before being forwarded to the real fetch.
const originalFetch = globalThis.fetch.bind(globalThis);
vi.stubGlobal(
  'fetch',
  ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const target = raw.startsWith('/api/') ? `${backendUrl}${raw}` : raw;
    return originalFetch(target, init);
  }) as typeof globalThis.fetch,
);

const { httpApi } = await import('../src/api/http');

describe.skipIf(!backendUrl)('httpApi integration (real backend)', () => {
  let lessonId: string;
  let cp1Id: string;

  it('lessons.create("L1") returns an id and title', async () => {
    const lesson = await httpApi.lessons.create('L1');
    expect(lesson.id).toBeTruthy();
    expect(lesson.title).toBe('L1');
    lessonId = lesson.id;
  });

  it('lessons.list contains the created lesson', async () => {
    const list = await httpApi.lessons.list();
    expect(list.some((l) => l.id === lessonId)).toBe(true);
  });

  it('docs.save then docs.load round-trips markdown', async () => {
    await httpApi.docs.save(lessonId, '# Hello\n');
    const doc = await httpApi.docs.load(lessonId);
    expect(doc).not.toBeNull();
    expect(doc!.markdown).toBe('# Hello\n');
  });

  it('docs.load of an unknown id resolves null', async () => {
    const doc = await httpApi.docs.load('nope');
    expect(doc).toBeNull();
  });

  it('lessons.rename changes the title to L2', async () => {
    await httpApi.lessons.rename(lessonId, 'L2');
    const list = await httpApi.lessons.list();
    const lesson = list.find((l) => l.id === lessonId);
    expect(lesson).toBeDefined();
    expect(lesson!.title).toBe('L2');
  });

  it('checkpoints.create adds two checkpoints and list shows both newest first', async () => {
    const cp1 = await httpApi.docs.checkpoints.create(lessonId, 'cp1', '# Hello\n');
    cp1Id = cp1.id;
    const cp2 = await httpApi.docs.checkpoints.create(lessonId, 'auto1', '# x\n', {
      auto: true,
    });
    expect(cp2.id).not.toBe(cp1.id);

    const cps = await httpApi.docs.checkpoints.list(lessonId);
    expect(cps.length).toBeGreaterThanOrEqual(2);
    expect(cps[0].id).toBe(cp2.id);
    expect(cps[1].id).toBe(cp1.id);
  });

  it('checkpoints.remove removes cp1', async () => {
    await httpApi.docs.checkpoints.remove(lessonId, cp1Id);
    const cps = await httpApi.docs.checkpoints.list(lessonId);
    expect(cps.some((c) => c.id === cp1Id)).toBe(false);
  });

  it('checkpoints.restore brings cp1 back', async () => {
    await httpApi.docs.checkpoints.restore(lessonId, cp1Id);
    const cps = await httpApi.docs.checkpoints.list(lessonId);
    expect(cps.some((c) => c.id === cp1Id)).toBe(true);
  });

  it('chats.save then chats.load round-trips the array', async () => {
    const chats = [{ id: 'c1', name: 'Chat 1', model: 'm', messages: [], refs: [] }];
    await httpApi.chats.save(lessonId, chats);
    const loaded = await httpApi.chats.load(lessonId);
    expect(loaded).toEqual(chats);
  });

  it('lessons.remove deletes the lesson and docs.load returns null or rejects', async () => {
    await httpApi.lessons.remove(lessonId);
    const list = await httpApi.lessons.list();
    expect(list.some((l) => l.id === lessonId)).toBe(false);

    try {
      const doc = await httpApi.docs.load(lessonId);
      expect(doc).toBeNull();
    } catch {
      // rejecting is also acceptable
    }
  });

  it('lessons.restore brings the lesson back with title L2', async () => {
    const restored = await httpApi.lessons.restore(lessonId);
    expect(restored.title).toBe('L2');
    const list = await httpApi.lessons.list();
    expect(list.some((l) => l.id === lessonId)).toBe(true);
  });

  it('status() returns llm "online"/"offline" and a string version', async () => {
    const s = await httpApi.status();
    expect(['online', 'offline']).toContain(s.llm);
    expect(typeof s.version).toBe('string');
  });
});
