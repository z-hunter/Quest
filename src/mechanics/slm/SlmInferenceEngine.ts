import type { NpcActorContext } from '../npcTypes';
import { SlmInputAdapter } from './SlmInputAdapter';
import { SlmOutputAdapter, type SlmDecodeResult } from './SlmOutputAdapter';
import { SLM_VOCABULARY_SHA256, SLM_VOCABULARY_VERSION } from './SlmVocabulary';

export type SlmCompatibilityManifest = {
  schemaVersion: number;
  modelId: string;
  vocabularyVersion: string;
  vocabularySha256: string;
  modelSha256: string;
  onnxOpset: number;
  maxDynamicEntities: number;
  inputs: Array<{ name: string; dtype: string; shape: Array<string | number> }>;
  outputs: Array<{ name: string; dtype: string; shape: Array<string | number> }>;
};

export function validateSlmCompatibilityManifest(value: unknown): SlmCompatibilityManifest {
  const manifest = value as Partial<SlmCompatibilityManifest> | null;
  if (!manifest || typeof manifest !== 'object') throw new Error('SLM manifest must be an object');
  if (manifest.schemaVersion !== 1)
    throw new Error(`Unsupported SLM manifest schema: ${manifest.schemaVersion}`);
  if (
    manifest.vocabularyVersion !== SLM_VOCABULARY_VERSION ||
    manifest.vocabularySha256 !== SLM_VOCABULARY_SHA256
  ) {
    throw new Error('SLM vocabulary is incompatible with this engine build');
  }
  if (typeof manifest.modelSha256 !== 'string' || !manifest.modelSha256.trim()) {
    throw new Error('SLM manifest modelSha256 is missing or invalid');
  }
  if (
    !Number.isInteger(manifest.onnxOpset) ||
    Number(manifest.onnxOpset) < 13 ||
    Number(manifest.onnxOpset) > 21
  )
    throw new Error(`Unsupported ONNX opset: ${manifest.onnxOpset}`);
  if (!Number.isInteger(manifest.maxDynamicEntities) || Number(manifest.maxDynamicEntities) < 1)
    throw new Error('SLM dynamic entity capacity is missing');

  const input = manifest.inputs?.[0];
  const output = manifest.outputs?.[0];
  if (!input || input.name !== 'input_ids' || input.dtype !== 'int32')
    throw new Error('SLM input tensor contract is incompatible');
  if (!output || output.name !== 'output_ids' || output.dtype !== 'int32')
    throw new Error('SLM output tensor contract is incompatible');

  if (
    !Array.isArray(input.shape) ||
    input.shape.length !== 2 ||
    input.shape[0] !== 'batch' ||
    typeof input.shape[1] !== 'number' ||
    input.shape[1] <= 0
  ) {
    throw new Error('SLM input tensor contract is incompatible');
  }

  if (
    !Array.isArray(output.shape) ||
    output.shape.length !== 2 ||
    output.shape[0] !== 'batch' ||
    typeof output.shape[1] !== 'number' ||
    output.shape[1] <= 0
  ) {
    throw new Error('SLM output tensor contract is incompatible');
  }

  return manifest as SlmCompatibilityManifest;
}

export class SlmInferenceEngine {
  private static session: any = null;
  private static ortModule: any = null;
  private static isLoading = false;
  private static modelPath = '/models/slm_routine_v1.onnx';
  private static manifestPath = '/models/slm_routine_v1.manifest.json';
  private static manifest: SlmCompatibilityManifest | null = null;
  private static isEnabled = true;

  static setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  static isReady(): boolean {
    return !!this.session && this.isEnabled;
  }

  static async init(modelUrl?: string): Promise<boolean> {
    if (modelUrl) {
      if ((this.session || this.isLoading) && modelUrl !== this.modelPath) {
        console.warn(
          `[SlmInferenceEngine] Rejecting initialization with different modelUrl: ${modelUrl}`
        );
        return !!this.session;
      }
      this.modelPath = modelUrl;
      this.manifestPath = modelUrl.replace(/\.onnx(?:\?.*)?$/, '.manifest.json');
    }
    if (this.session || this.isLoading) return !!this.session;

    this.isLoading = true;
    try {
      const manifestResponse = await fetch(this.manifestPath, { cache: 'no-store' });
      if (!manifestResponse.ok)
        throw new Error(`SLM compatibility manifest HTTP ${manifestResponse.status}`);
      this.manifest = validateSlmCompatibilityManifest(await manifestResponse.json());

      const modelResponse = await fetch(this.modelPath);
      if (!modelResponse.ok) throw new Error(`Failed to fetch model: ${modelResponse.status}`);
      const arrayBuffer = await modelResponse.arrayBuffer();

      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      if (hashHex !== this.manifest.modelSha256) {
        throw new Error(
          `SLM model SHA-256 mismatch: expected ${this.manifest.modelSha256}, got ${hashHex}`
        );
      }

      this.ortModule = await import('onnxruntime-web');

      const uint8Array = new Uint8Array(arrayBuffer);
      this.session = await this.ortModule.InferenceSession.create(uint8Array, {
        executionProviders: ['wasm'],
      });
      console.log('[SlmInferenceEngine] Successfully loaded ONNX model from:', this.modelPath);
      return true;
    } catch (err) {
      console.warn('[SlmInferenceEngine] Could not load ONNX model (fallback to LLM active):', err);
      this.session = null;
      this.manifest = null;
      return false;
    } finally {
      this.isLoading = false;
    }
  }

  static async infer(context: NpcActorContext): Promise<SlmDecodeResult> {
    if (!this.isEnabled) {
      return { kind: 'escalate', reason: 'SLM engine disabled' };
    }

    if (!this.session || !this.ortModule) {
      const loaded = await this.init();
      if (!loaded || !this.session) {
        return { kind: 'escalate', reason: 'ONNX session not initialized or model file missing' };
      }
    }

    try {
      const { tokens, mapping } = SlmInputAdapter.encode(context);
      const maxInput = Number(this.manifest?.inputs[0]?.shape[1]);
      if (Number.isFinite(maxInput) && tokens.length > maxInput)
        return {
          kind: 'escalate',
          reason: `SLM input length ${tokens.length} exceeds ${maxInput}`,
        };
      if (mapping.idToIndex.size > Number(this.manifest?.maxDynamicEntities || 0))
        return { kind: 'escalate', reason: 'SLM dynamic entity capacity exceeded' };

      const inputTokens = [...tokens];
      if (Number.isFinite(maxInput) && inputTokens.length < maxInput) {
        const paddingLength = maxInput - inputTokens.length;
        inputTokens.push(...new Array(paddingLength).fill(0));
      }

      const inputTensor = new this.ortModule.Tensor('int32', Int32Array.from(inputTokens), [
        1,
        maxInput,
      ]);

      const feeds: Record<string, any> = { input_ids: inputTensor };
      const results = await this.session.run(feeds);

      const outputKey = Object.keys(results)[0];
      const outputTensor = results[outputKey];

      if (!outputTensor || !outputTensor.data) {
        return { kind: 'escalate', reason: 'ONNX inference produced no output data' };
      }

      const outputData = outputTensor.data as Int32Array | Uint8Array | Float32Array;
      const outputTokens: number[] = [];
      for (let i = 0; i < outputData.length; i++) {
        outputTokens.push(Math.round(outputData[i]));
      }

      return SlmOutputAdapter.decode(outputTokens, mapping, context.id);
    } catch (err) {
      console.error('[SlmInferenceEngine] Inference error:', err);
      return { kind: 'escalate', reason: `Inference exception: ${String(err)}` };
    }
  }
}
