import type { ParserCommandSpec } from './parserTypes';

export type ParserCommandMatch = {
  command: ParserCommandSpec;
  matchedPhrase: string;
  remainder: string;
  argumentValues: Record<string, string | null>;
};

function sortByLengthDesc(values: string[]): string[] {
  return [...values].sort((a, b) => b.length - a.length);
}

function startsWithPhrase(input: string, phrase: string): boolean {
  if (input === phrase) return true;
  return input.startsWith(`${phrase} `);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findSeparatorMatch(
  input: string,
  separators: string[]
): { index: number; separator: string } | null {
  const lowered = input.toLowerCase();
  let bestMatch: { index: number; separator: string } | null = null;

  for (const separator of separators) {
    const normalized = separator.trim().toLowerCase();
    if (!normalized) continue;
    const pattern = new RegExp(`\\s+${escapeRegex(normalized)}\\s+`, 'i');
    const match = pattern.exec(lowered);
    if (!match || match.index < 0) continue;

    if (!bestMatch || match.index < bestMatch.index) {
      bestMatch = { index: match.index, separator: separator.trim() };
    }
  }

  return bestMatch;
}

function extractArgumentValues(
  command: ParserCommandSpec,
  remainder: string
): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  const args = command.arguments || [];

  if (!args.length) {
    return values;
  }

  let cursor = remainder.trim();

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    const next = args[index + 1];

    if (!next) {
      values[current.name] = cursor || null;
      continue;
    }

    const separators = (next.separatorsBefore || []).map((item) => item.trim()).filter(Boolean);
    if (!separators.length) {
      values[current.name] = cursor || null;
      cursor = '';
      continue;
    }

    const separatorMatch = findSeparatorMatch(cursor, separators);
    if (!separatorMatch) {
      values[current.name] = cursor || null;
      cursor = '';
      continue;
    }

    values[current.name] = cursor.slice(0, separatorMatch.index).trim() || null;

    const loweredCursor = cursor.toLowerCase();
    const separatorPattern = new RegExp(
      `\\s+${escapeRegex(separatorMatch.separator.toLowerCase())}\\s+`,
      'i'
    );
    const fullMatch = separatorPattern.exec(loweredCursor);
    cursor = fullMatch ? cursor.slice(fullMatch.index + fullMatch[0].length).trim() : '';
  }

  return values;
}

export function matchParserCommandSpec(
  input: string,
  commands: ParserCommandSpec[]
): ParserCommandMatch | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();

  for (const command of commands) {
    const phrases = sortByLengthDesc(
      (command.phrases || []).map((item) => item.trim()).filter(Boolean)
    );
    for (const phrase of phrases) {
      const normalizedPhrase = phrase.toLowerCase();
      if (!startsWithPhrase(lowered, normalizedPhrase)) continue;
      return {
        command,
        matchedPhrase: phrase,
        remainder: trimmed.slice(phrase.length).trim(),
        argumentValues: extractArgumentValues(command, trimmed.slice(phrase.length).trim()),
      };
    }
  }

  return null;
}
