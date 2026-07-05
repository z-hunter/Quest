import { listen } from '@tauri-apps/api/event';

export type FileListItem = {
  name: string;
  isDir: boolean;
  createdTime?: number;
  modifiedTime?: number;
};

type JsonHeaders = {
  'Content-Type': 'application/json';
};

type TauriCoreLike = {
  invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
};

type TauriWindowLike = Window & {
  __TAURI__?: {
    core?: TauriCoreLike;
  };
  __TAURI_INTERNALS__?: TauriCoreLike;
};

const JSON_HEADERS: JsonHeaders = {
  'Content-Type': 'application/json',
};

function getTauriInvoker():
  | ((command: string, args?: Record<string, unknown>) => Promise<unknown>)
  | null {
  if (typeof window === 'undefined') return null;

  const tauriWindow = window as TauriWindowLike;
  const invoke =
    tauriWindow.__TAURI__?.core?.invoke || tauriWindow.__TAURI_INTERNALS__?.invoke || null;

  return typeof invoke === 'function' ? invoke.bind(tauriWindow.__TAURI__?.core) : null;
}

export function isTauriRuntime(): boolean {
  return !!getTauriInvoker();
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = getTauriInvoker();
  if (!invoke) {
    throw new Error(`Tauri runtime is unavailable for command '${command}'.`);
  }
  return (await invoke(command, args)) as T;
}

async function postJson<T>(url: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    if (!text.trim()) {
      return undefined as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }

  return (await response.json()) as T;
}

export function validateSafePath(path: string): void {
  if (path.includes('..') || path.includes('\0')) {
    throw new Error(`Security Error: Path traversal is not allowed (${path})`);
  }
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) {
    throw new Error(`Security Error: Absolute paths are not allowed (${path})`);
  }
}

export async function listProjectFiles(path: string): Promise<FileListItem[]> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    return await invokeTauri<FileListItem[]>('list_project_files', { path });
  }

  const result = await postJson<{ files?: FileListItem[] }>('/api/list', { path });
  return Array.isArray(result?.files) ? result.files : [];
}

export async function ensureProjectFile(path: string, content: string): Promise<void> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    await invokeTauri('ensure_project_file', { path, content });
    return;
  }

  await postJson('/api/ensure-file', { path, content });
}

export async function saveProjectFile(path: string, content: string): Promise<void> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    await invokeTauri('save_project_file', { path, content });
    return;
  }

  await postJson('/api/save', { path, content });
}

export async function readProjectFile(path: string, content: string): Promise<string> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    return await invokeTauri<string>('read_project_file', { path, content });
  }

  const result = await postJson<{ content?: string }>('/api/read-file', { path, content });
  return typeof result?.content === 'string' ? result.content : '';
}

export async function readProjectFileExisting(path: string): Promise<string> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    return await invokeTauri<string>('read_project_file_existing', { path });
  }
  const result = await postJson<{ content?: string }>('/api/read-file', { path, content: '' }); // fallback
  return typeof result?.content === 'string' ? result.content : '';
}

export async function readProjectFileBase64(path: string): Promise<string> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    return await invokeTauri<string>('read_project_file_base64', { path });
  }
  // Not supported via POST in dev usually
  return '';
}

export async function openProjectFile(path: string, content: string): Promise<void> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    await invokeTauri('open_project_file', { path, content });
    return;
  }

  await postJson('/api/open-file', { path, content });
}

export async function deleteProjectFile(path: string): Promise<void> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    await invokeTauri('delete_project_file', { path });
    return;
  }

  await postJson('/api/delete-file', { path });
}

export async function openProjectFolder(path: string): Promise<void> {
  validateSafePath(path);
  if (isTauriRuntime()) {
    await invokeTauri('open_project_folder', { path });
    return;
  }

  await postJson('/api/open-folder', { path });
}

export type FileEventCallback = (eventType: string, path: string, modifiedTime: number) => void;

class FileEventEmitter {
  private listeners: Set<FileEventCallback> = new Set();

  subscribe(cb: FileEventCallback) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  emit(eventType: string, path: string, modifiedTime: number) {
    this.listeners.forEach((cb) => cb(eventType, path, modifiedTime));
  }
}

export const fileEvents = new FileEventEmitter();

let watcherInitialized = false;

export async function initFileWatcher() {
  if (watcherInitialized) return;
  watcherInitialized = true;

  if (isTauriRuntime()) {
    try {
      await listen<{ eventType: string; path: string; modifiedTime?: number }>(
        'file-event',
        (event) => {
          fileEvents.emit(
            event.payload.eventType,
            event.payload.path,
            event.payload.modifiedTime || Date.now()
          );
        }
      );
    } catch (err) {
      console.warn('Failed to listen to Tauri file-event', err);
    }
  } else {
    // Vite HMR
    if (import.meta.hot) {
      import.meta.hot.on(
        'file-event',
        (payload: { eventType: string; path: string; modifiedTime: number }) => {
          fileEvents.emit(payload.eventType, payload.path, payload.modifiedTime);
        }
      );
    }
  }
}

// Initialize eagerly so events are caught early
initFileWatcher().catch(console.error);
