import type { NpcActorContext } from '../npcTypes';
import { SlmInputAdapter } from './SlmInputAdapter';
import { SlmOutputAdapter, type SlmDecodeResult } from './SlmOutputAdapter';
import { SLM_VOCABULARY_SHA256, SLM_VOCABULARY_VERSION } from './SlmVocabulary';

export type SlmCompatibilityManifest = {
  schemaVersion: number;
  modelId: string;
  vocabularyVersion: string;
  vocabularySha256: string;
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
  if (
    !Number.isInteger(manifest.onnxOpset) ||
    Number(manifest.onnxOpset) < 13 ||
    Number(manifest.onnxOpset) > 21
  )
    throw new Error(`Unsupported ONNX opset: ${manifest.onnxOpset}`);
  if (manifest.inputs?.[0]?.name !== 'input_ids' || manifest.inputs[0].dtype !== 'int32')
    throw new Error('SLM input tensor contract is incompatible');
  if (manifest.outputs?.[0]?.name !== 'output_ids' || manifest.outputs[0].dtype !== 'int32')
    throw new Error('SLM output tensor contract is incompatible');
  if (!Number.isInteger(manifest.maxDynamicEntities) || Number(manifest.maxDynamicEntities) < 1)
    throw new Error('SLM dynamic entity capacity is missing');
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
      // Dynamically import onnxruntime-web to avoid bundling WASM on startup
      // and ensure unit tests run smoothly without web worker dependencies.
      this.ortModule = await import('onnxruntime-web');

      this.session = await this.ortModule.InferenceSession.create(this.modelPath, {
        executionProviders: ['wasm'],
      });
      console.log('[SlmInferenceEngine] Successfully loaded ONNX model from:', this.modelPath);
      return true;
    } catch (err) {
      // Normal during Phase 1 (Data Collection) when model hasn't been trained/placed yet
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

      // Prepare tensor input: shape [1, sequence_length]
      const inputTensor = new this.ortModule.Tensor('int32', tokens, [1, tokens.length]);

      // Run inference
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
