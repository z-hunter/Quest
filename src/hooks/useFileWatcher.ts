import { useEffect } from 'react';
import { fileEvents } from '../platform/fileApi';

export function useFileWatcher(
  targetPath: string | null | undefined,
  callback: (eventType: string, path: string, modifiedTime: number) => void
) {
  useEffect(() => {
    if (!targetPath) return;

    // Normalize targetPath for comparison
    const normalizedTarget = targetPath.replace(/\\/g, '/');

    const unsubscribe = fileEvents.subscribe((eventType, path, modifiedTime) => {
      // also normalize the incoming path just in case
      const incomingPath = path.replace(/\\/g, '/');
      if (
        incomingPath === normalizedTarget ||
        incomingPath.endsWith('/' + normalizedTarget) ||
        normalizedTarget.endsWith('/' + incomingPath)
      ) {
        callback(eventType, incomingPath, modifiedTime);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [targetPath, callback]);
}
