import { NLP_TRAINING_DATA } from './nlp/trainingData';
import { normalizeTargetForIntent } from './nlp/normalizeTarget';
import type { ParserActionEnvelope, ParserContext, ParserToolAction } from './parserTypes';

const NLP_CONFIDENCE_THRESHOLD = 0.58;

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
  private manager: any = null;
  private initPromise: Promise<void> | null = null;
  private ready = false;
  private lastDebugInfo: NlpCascadeDebugInfo | null = null;

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

      for (const [intent, utterances] of Object.entries(NLP_TRAINING_DATA)) {
        for (const utterance of utterances) {
          this.manager.addDocument('en', utterance, intent);
        }
      }
      await this.manager.train();
      this.ready = true;
    })();

    return this.initPromise;
  }

  async parse(input: string, _context: ParserContext): Promise<ParserActionEnvelope | null> {
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

    const target = normalizeTargetForIntent(input, intent);
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
      actions,
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
}
