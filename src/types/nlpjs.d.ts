declare module '@nlpjs/core' {
  export class Container {
    constructor(hasPreffix?: boolean);
    use(item: any, name?: string, isSingleton?: boolean, onlyIfNotExists?: boolean): string;
  }
}

declare module '@nlpjs/nlp' {
  export class Nlp {
    constructor(settings?: any, container?: any);
    addDocument(locale: string, utterance: string, intent: string): void;
    train(): Promise<void>;
    process(locale: string, utterance: string): Promise<any>;
  }
}

declare module '@nlpjs/lang-en-min' {
  export class LangEn {
    register(container: any): void;
  }
}
