export function compactRecord<T extends Record<string, unknown>>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    if (Array.isArray(entry)) {
      if (!entry.length) continue;
      result[key] = entry;
      continue;
    }
    if (typeof entry === 'object') {
      const nested = compactRecord(entry as Record<string, unknown>);
      if (!Object.keys(nested).length) continue;
      result[key] = nested;
      continue;
    }
    result[key] = entry;
  }
  return result as T;
}
