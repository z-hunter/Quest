export {};

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };
    __TAURI_INTERNALS__?: {
      invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}
