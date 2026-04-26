export function normalizeGroupIdList(
  value: unknown,
  options: { preserveEmptyTokens?: boolean } = {}
): string {
  const raw = String(value ?? '');
  const tokens = raw
    .split(',')
    .map((token) => token.trim())
    .map((token) => {
      if (!token) return '';
      return token.startsWith('#') ? token : `#${token}`;
    });

  return (options.preserveEmptyTokens ? tokens : tokens.filter(Boolean)).join(',');
}
