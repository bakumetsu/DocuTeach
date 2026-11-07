import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveFile, openFile, resetFileHandle } from '../src/files/fileio';

type FsWindow = { showSaveFilePicker?: unknown; showOpenFilePicker?: unknown };

describe('fileio', () => {
  beforeEach(() => {
    resetFileHandle();
    vi.restoreAllMocks();
    // Ensure no FS access APIs by default
    const w = window as unknown as FsWindow;
    delete w.showOpenFilePicker;
    delete w.showSaveFilePicker;
  });

  afterEach(() => {
    const w = window as unknown as FsWindow;
    delete w.showOpenFilePicker;
    delete w.showSaveFilePicker;
  });

  describe('saveFile – fallback (no showSaveFilePicker)', () => {
    it('creates an anchor with download=suggestedName and a Blob', async () => {
      const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake-url');
      const revokeObjectURL = vi.fn();
      const origCreate = URL.createObjectURL;
      const origRevoke = URL.revokeObjectURL;
      URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
      URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      const name = await saveFile('hi', 'a.md');

      expect(name).toBe('a.md');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blobArg = createObjectURL.mock.calls[0]?.[0];
      expect(blobArg).toBeInstanceOf(Blob);
      expect(blobArg?.type).toBe('text/markdown');
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');

      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    });
  });

  describe('saveFile – with showSaveFilePicker', () => {
    it('writes text via createWritable and reuses handle on second call', async () => {
      const writes: string[] = [];
      const fakeHandle = {
        name: 'test.md',
        createWritable: vi.fn(async () => ({
          write: vi.fn(async (data: string) => {
            writes.push(data);
          }),
          close: vi.fn(async () => {}),
        })),
      };
      const showSaveFilePicker = vi.fn(async () => fakeHandle);
      const w = window as unknown as FsWindow;
      w.showSaveFilePicker = showSaveFilePicker;

      const name1 = await saveFile('hello', 'test.md');
      expect(name1).toBe('test.md');
      expect(writes).toEqual(['hello']);

      const name2 = await saveFile('world', 'test.md');
      expect(name2).toBe('test.md');
      expect(writes).toEqual(['hello', 'world']);
      expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
    });

    it('forceAs calls the picker again', async () => {
      const writes: string[] = [];
      const makeHandle = (name: string) => ({
        name,
        createWritable: vi.fn(async () => ({
          write: vi.fn(async (data: string) => {
            writes.push(data);
          }),
          close: vi.fn(async () => {}),
        })),
      });
      const showSaveFilePicker = vi
        .fn()
        .mockResolvedValueOnce(makeHandle('first.md'))
        .mockResolvedValueOnce(makeHandle('second.md'));
      const w = window as unknown as FsWindow;
      w.showSaveFilePicker = showSaveFilePicker;

      await saveFile('a', 'first.md');
      await saveFile('b', 'second.md', true);

      expect(showSaveFilePicker).toHaveBeenCalledTimes(2);
      expect(writes).toEqual(['a', 'b']);
    });
  });

  describe('openFile – with showOpenFilePicker', () => {
    it('returns the file text and name', async () => {
      const fakeFile = { text: async () => '# Hello World' };
      const fakeHandle = {
        name: 'doc.md',
        getFile: vi.fn(async () => fakeFile),
        createWritable: vi.fn(),
      };
      const showOpenFilePicker = vi.fn(async () => [fakeHandle]);
      const w = window as unknown as FsWindow;
      w.showOpenFilePicker = showOpenFilePicker;

      const result = await openFile();

      expect(result).toEqual({ name: 'doc.md', text: '# Hello World' });
      expect(showOpenFilePicker).toHaveBeenCalledTimes(1);
    });
  });
});
