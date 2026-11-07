let currentHandle: FileSystemFileHandle | null = null;

export function hasFsAccess(): boolean {
  return 'showOpenFilePicker' in window;
}

export interface OpenedFile {
  name: string;
  text: string;
}

export async function openFile(): Promise<OpenedFile | null> {
  if (hasFsAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker!({
        types: [
          {
            accept: {
              'text/markdown': ['.md', '.markdown'],
              'text/plain': ['.txt'],
            },
          },
        ],
      });
      currentHandle = handle;
      const file = await handle.getFile();
      const text = await file.text();
      return { name: handle.name, text };
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  // Fallback: hidden <input type="file">
  return new Promise<OpenedFile | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.style.display = 'none';
    document.body.appendChild(input);

    let settled = false;

    function cleanup() {
      document.body.removeChild(input);
    }

    input.addEventListener('change', async () => {
      if (settled) return;
      const file = input.files?.[0];
      if (!file) {
        settled = true;
        cleanup();
        resolve(null);
        return;
      }
      const text = await file.text();
      settled = true;
      cleanup();
      resolve({ name: file.name, text });
    });

    input.addEventListener('cancel', () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    });

    input.click();
  });
}

export async function saveFile(
  text: string,
  suggestedName: string,
  forceAs = false,
): Promise<string | null> {
  // Reuse existing handle unless forceAs
  if (currentHandle && !forceAs) {
    try {
      const writable = await currentHandle.createWritable();
      await writable.write(text);
      await writable.close();
      return currentHandle.name;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  // Try showSaveFilePicker
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName,
        types: [
          {
            accept: {
              'text/markdown': ['.md', '.markdown'],
            },
          },
        ],
      });
      currentHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return handle.name;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      throw e;
    }
  }

  // Fallback: download via Blob URL
  const blob = new Blob([text], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return suggestedName;
}

export function resetFileHandle(): void {
  currentHandle = null;
}
