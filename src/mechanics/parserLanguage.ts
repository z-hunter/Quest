import type { ParserRelationType } from './parserTypes';

export type ParserIntentId =
  | 'look'
  | 'examine'
  | 'take'
  | 'put'
  | 'open'
  | 'close'
  | 'goTo'
  | 'showInventory';

export type ParserLexiconAsset = {
  stage1Aliases: Record<ParserIntentId, string[]>;
  normalizationPrefixes: Record<ParserIntentId, string[]>;
  politePrefixes: string[];
  articles: string[];
  lookSceneWords: string[];
  relationMarkers: Record<ParserRelationType, string[]>;
};

export type ParserTrainingAsset = Record<ParserIntentId, string[]>;

type Stage1Match = {
  intent: ParserIntentId;
  matchedAlias: string;
  remainder: string;
};

function sortByLengthDesc(values: string[]): string[] {
  return [...values].sort((a, b) => b.length - a.length);
}

function startsWithPhrase(input: string, phrase: string): boolean {
  if (input === phrase) return true;
  return input.startsWith(`${phrase} `);
}

function stripLeadingPhrase(input: string, phrase: string): string {
  if (input === phrase) return '';
  return input.slice(phrase.length).trimStart();
}

function stripFromList(input: string, phrases: string[]): string {
  let value = input.trim();
  for (const phrase of sortByLengthDesc(phrases.map((item) => item.trim()).filter(Boolean))) {
    if (startsWithPhrase(value.toLowerCase(), phrase.toLowerCase())) {
      value = stripLeadingPhrase(value, value.slice(0, phrase.length));
      break;
    }
  }
  return value.trim();
}

function findLeadingRelation(
  input: string,
  relationMarkers: Record<ParserRelationType, string[]>
): { relation: ParserRelationType; marker: string } | null {
  const lowered = input.trim().toLowerCase();
  const candidates: Array<{ relation: ParserRelationType; marker: string }> = [];

  for (const relation of Object.keys(relationMarkers) as ParserRelationType[]) {
    for (const marker of relationMarkers[relation] || []) {
      const normalized = marker.trim();
      if (!normalized) continue;
      candidates.push({ relation, marker: normalized });
    }
  }

  for (const candidate of candidates.sort((a, b) => b.marker.length - a.marker.length)) {
    if (startsWithPhrase(lowered, candidate.marker.toLowerCase())) {
      return candidate;
    }
  }

  return null;
}

export function matchStage1Intent(input: string, lexicon: ParserLexiconAsset): Stage1Match | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();

  const intents: ParserIntentId[] = [
    'look',
    'examine',
    'take',
    'put',
    'open',
    'close',
    'showInventory',
    'goTo',
  ];
  for (const intent of intents) {
    const aliases = sortByLengthDesc(lexicon.stage1Aliases[intent] || []);
    for (const alias of aliases) {
      const normalizedAlias = alias.trim().toLowerCase();
      if (!normalizedAlias) continue;
      if (startsWithPhrase(lowered, normalizedAlias)) {
        const remainder = trimmed.slice(alias.length).trim();
        return {
          intent,
          matchedAlias: alias,
          remainder,
        };
      }
    }
  }

  return null;
}

export function getStage1CommandWords(lexicon: ParserLexiconAsset): Set<string> {
  const words = new Set<string>();
  for (const aliases of Object.values(lexicon.stage1Aliases)) {
    for (const alias of aliases) {
      const firstWord = alias.trim().split(/\s+/)[0];
      if (firstWord) words.add(firstWord.toUpperCase());
    }
  }
  return words;
}

export function isLookSceneWord(target: string, lexicon: ParserLexiconAsset): boolean {
  const normalized = String(target || '')
    .trim()
    .toLowerCase();
  return (
    !!normalized && (lexicon.lookSceneWords || []).some((word) => word.toLowerCase() === normalized)
  );
}

export function normalizeTargetForIntent(
  input: string,
  intent: ParserIntentId,
  lexicon: ParserLexiconAsset
): string | null {
  let value = input.replace(/[?.!,]+$/g, '').trim();
  if (!value) return null;

  value = stripFromList(value, lexicon.politePrefixes || []);
  value = stripFromList(value, lexicon.normalizationPrefixes[intent] || []);
  value = stripFromList(value, lexicon.articles || []);

  return value.trim() || null;
}

export function extractRelationTargetForIntent(
  input: string,
  intent: ParserIntentId,
  lexicon: ParserLexiconAsset
): { relation: ParserRelationType; anchor: string | null } | null {
  if (intent !== 'look' && intent !== 'examine') {
    return null;
  }

  let value = input.replace(/[?.!,]+$/g, '').trim();
  if (!value) return null;

  value = stripFromList(value, lexicon.politePrefixes || []);
  value = stripFromList(value, lexicon.normalizationPrefixes[intent] || []);
  if (!value) return null;

  const relationMatch = findLeadingRelation(value, lexicon.relationMarkers || ({} as any));
  if (!relationMatch) {
    return null;
  }

  const marker = relationMatch.marker;
  const anchor = stripFromList(stripLeadingPhrase(value, value.slice(0, marker.length)), [
    ...(lexicon.articles || []),
  ]);

  return {
    relation: relationMatch.relation,
    anchor: anchor || null,
  };
}

export function extractPutCommand(
  input: string,
  lexicon: ParserLexiconAsset
): { item: string | null; target: string | null; relation: ParserRelationType | null } {
  let value = input.replace(/[?.!,]+$/g, '').trim();
  if (!value) {
    return { item: null, target: null, relation: null };
  }

  value = stripFromList(value, lexicon.politePrefixes || []);
  value = stripFromList(value, lexicon.normalizationPrefixes.put || []);
  if (!value) {
    return { item: null, target: null, relation: null };
  }

  const relationCandidates: Array<{ relation: ParserRelationType; marker: string }> = [];
  for (const relation of ['in', 'on', 'under', 'behind'] as ParserRelationType[]) {
    for (const marker of lexicon.relationMarkers?.[relation] || []) {
      if (marker.trim()) {
        relationCandidates.push({ relation, marker: marker.trim() });
      }
    }
  }

  relationCandidates.sort((left, right) => right.marker.length - left.marker.length);

  for (const candidate of relationCandidates) {
    const pattern = new RegExp(
      `\\s+${candidate.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`,
      'i'
    );
    const match = pattern.exec(value);
    if (!match?.index) continue;

    const item = stripFromList(value.slice(0, match.index).trim(), lexicon.articles || []);
    const target = stripFromList(
      value.slice(match.index + match[0].length).trim(),
      lexicon.articles || []
    );

    return {
      item: item || null,
      target: target || null,
      relation: candidate.relation,
    };
  }

  return {
    item: stripFromList(value, lexicon.articles || []) || null,
    target: null,
    relation: null,
  };
}

export function extractTakeCommand(
  input: string,
  lexicon: ParserLexiconAsset
): { item: string | null; target: string | null; relation: ParserRelationType | null } {
  let value = input.replace(/[?.!,]+$/g, '').trim();
  if (!value) {
    return { item: null, target: null, relation: null };
  }

  value = stripFromList(value, lexicon.politePrefixes || []);
  value = stripFromList(value, lexicon.normalizationPrefixes.take || []);
  if (!value) {
    return { item: null, target: null, relation: null };
  }

  const relationCandidates: Array<{ relation: ParserRelationType; marker: string }> = [
    { relation: 'in', marker: 'from' },
  ];
  for (const relation of ['in', 'on', 'under', 'behind'] as ParserRelationType[]) {
    for (const marker of lexicon.relationMarkers?.[relation] || []) {
      if (marker.trim()) {
        relationCandidates.push({ relation, marker: marker.trim() });
      }
    }
  }

  relationCandidates.sort((left, right) => right.marker.length - left.marker.length);

  for (const candidate of relationCandidates) {
    const pattern = new RegExp(
      `\\s+${candidate.marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`,
      'i'
    );
    const match = pattern.exec(value);
    if (!match?.index) continue;

    const item = stripFromList(value.slice(0, match.index).trim(), lexicon.articles || []);
    const target = stripFromList(
      value.slice(match.index + match[0].length).trim(),
      lexicon.articles || []
    );

    return {
      item: item || null,
      target: target || null,
      relation: candidate.relation,
    };
  }

  return {
    item: stripFromList(value, lexicon.articles || []) || null,
    target: null,
    relation: null,
  };
}
