import { normalizeTargetForIntent } from './parserLanguage';
import type { ParserCascadeEnvelope, ParserContext, ParserToolAction } from './parserTypes';
import type { TextAssetManager } from '../core/TextAssetManager';

const NLP_CONFIDENCE_THRESHOLD = 0.58;
const NLP_MODEL_CACHE_PREFIX = 'quest:nlp:model:v1:';

type SupportedIntent = 'look' | 'examine' | 'take' | 'goTo' | 'showInventory';

type NlpProcessResult = {
  intent?: string;
  score?: number;
};

export type NlpCascadeDebugInfo = {
  input: string;
  normalizedInput: string;
  rawIntent: string;
  score: number;
  matched: boolean;
  reason?:
    | 'not_initialized'
    | 'none_intent'
    | 'low_confidence'
    | 'unsupported_intent'
    | 'no_actions';
  target?: string | null;
};

export class NlpCascade {
  private getTextAssets: () => TextAssetManager | undefined;
  private manager: any = null;
  private initPromise: Promise<void> | null = null;
  private ready = false;
  private lastDebugInfo: NlpCascadeDebugInfo | null = null;

  constructor(getTextAssets: () => TextAssetManager | undefined) {
    this.getTextAssets = getTextAssets;
  }

  getLastDebugInfo(): NlpCascadeDebugInfo | null {
    return this.lastDebugInfo;
  }

  clearLastDebugInfo(): void {
    this.lastDebugInfo = null;
  }

  initialize(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const textAssets = this.getTextAssets();
      if (!textAssets) {
        throw new Error('Parser language assets are not available');
      }
      const trainingData = await textAssets.readParserTrainingAsset();
      const [coreModule, { Nlp }, { LangEn }] = await Promise.all([
        import('@nlpjs/core'),
        import('@nlpjs/nlp'),
        import('@nlpjs/lang-en-min'),
      ]);
      const { ArrToObj, Container, Normalizer, Stemmer, Stopwords, Tokenizer } = coreModule as any;

      const container = new Container();
      container.use(ArrToObj);
      container.use(Normalizer);
      container.use(Tokenizer);
      container.use(Stopwords);
      container.use(Stemmer);
      container.use(LangEn);

      this.manager = new Nlp(
        {
          autoSave: false,
          autoLoad: false,
          forceNER: false,
          languages: ['en'],
          nlu: { useNoneFeature: true },
        },
        container
      );

      const cacheKey = this.getModelCacheKey(trainingData);
      const cachedModel = this.readCachedModel(cacheKey);
      if (cachedModel) {
        try {
          this.manager.import(cachedModel);
          this.ready = true;
          return;
        } catch {
          this.removeCachedModel(cacheKey);
        }
      }

      for (const [intent, utterances] of Object.entries(trainingData)) {
        for (const utterance of utterances) {
          this.manager.addDocument('en', utterance, intent);
        }
      }
      await this.manager.train();
      this.writeCachedModel(cacheKey, this.manager.export(true));
      this.ready = true;
    })();

    return this.initPromise;
  }

  async parse(input: string, _context: ParserContext): Promise<ParserCascadeEnvelope | null> {
    await this.initialize();
    const normalizedInput = input.replace(/[?.!,]+$/g, '').trim();
    if (!this.manager) {
      this.lastDebugInfo = {
        input,
        normalizedInput,
        rawIntent: '',
        score: 0,
        matched: false,
        reason: 'not_initialized',
      };
      return null;
    }
    const result = (await this.manager.process('en', normalizedInput)) as NlpProcessResult;
    const rawIntent = (result.intent || '').trim();
    const score = Number(result.score || 0);

    if (!rawIntent || rawIntent === 'None') {
      this.lastDebugInfo = {
        input,
        normalizedInput,
        rawIntent,
        score,
        matched: false,
        reason: 'none_intent',
      };
      return null;
    }

    if (score < NLP_CONFIDENCE_THRESHOLD) {
      this.lastDebugInfo = {
        input,
        normalizedInput,
        rawIntent,
        score,
        matched: false,
        reason: 'low_confidence',
      };
      return null;
    }

    const intent = rawIntent as SupportedIntent;
    if (!this.shouldAcceptIntent(intent, normalizedInput)) {
      this.lastDebugInfo = {
        input,
        normalizedInput,
        rawIntent,
        score,
        matched: false,
        reason: 'unsupported_intent',
      };
      return null;
    }

    const textAssets = this.getTextAssets();
    if (!textAssets) {
      this.lastDebugInfo = {
        input,
        normalizedInput,
        rawIntent,
        score,
        matched: false,
        reason: 'not_initialized',
      };
      return null;
    }

    const target = normalizeTargetForIntent(input, intent, textAssets.getParserLexicon());
    const actions = this.buildActions(intent, target);
    if (!actions) {
      this.lastDebugInfo = {
        input,
        normalizedInput,
        rawIntent,
        score,
        matched: false,
        reason: 'no_actions',
        target,
      };
      return null;
    }

    this.lastDebugInfo = {
      input,
      normalizedInput,
      rawIntent,
      score,
      matched: true,
      target,
    };

    return {
      stage: 'nlp-v2',
      output: {
        kind: 'plan',
        actions,
      },
      debug: {
        rawInput: input,
        normalizedInput: normalizedInput.toUpperCase(),
        verb: intent.toUpperCase(),
        noun: target || '',
        intent,
        score,
        source: 'nlpjs',
      },
    };
  }

  private buildActions(intent: SupportedIntent, target: string | null): ParserToolAction[] | null {
    switch (intent) {
      case 'look':
        return target ? [{ type: 'lookTarget', target }] : [{ type: 'lookScene' }];
      case 'examine':
        return [{ type: 'examineTarget', target }];
      case 'take':
        return [{ type: 'takeTarget', target }];
      case 'goTo':
        return [{ type: 'goToTarget', target }];
      case 'showInventory':
        return [{ type: 'showInventory' }];
      default:
        return null;
    }
  }

  private shouldAcceptIntent(intent: SupportedIntent, normalizedInput: string): boolean {
    if (intent !== 'showInventory') {
      return true;
    }

    const lowered = normalizedInput.toLowerCase();
    return (
      /\binventory\b/.test(lowered) ||
      /\binv\b/.test(lowered) ||
      /\bitems?\b/.test(lowered) ||
      /\bcarrying\b/.test(lowered) ||
      /\bcarry\b/.test(lowered) ||
      /\bhave\b/.test(lowered)
    );
  }

  private getStorage(): Storage | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  }

  private getModelCacheKey(trainingData: Record<string, string[]>): string {
    return `${NLP_MODEL_CACHE_PREFIX}${this.hashString(JSON.stringify(trainingData))}`;
  }

  private readCachedModel(cacheKey: string): string | null {
    try {
      return this.getStorage()?.getItem(cacheKey) || null;
    } catch {
      return null;
    }
  }

  private writeCachedModel(cacheKey: string, data: string): void {
    try {
      this.getStorage()?.setItem(cacheKey, data);
    } catch {
      // Ignore storage quota/privacy mode failures and keep runtime behavior unchanged.
    }
  }

  private removeCachedModel(cacheKey: string): void {
    try {
      this.getStorage()?.removeItem(cacheKey);
    } catch {
      // Ignore storage failures.
    }
  }

  private hashString(value: string): string {
    let hash = 5381;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 33) ^ value.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
  }
}
