import type { NpcActorContext } from '../npcTypes';
import { SlmInputAdapter } from './SlmInputAdapter';
import { SlmOutputAdapter, type SlmDecodeResult } from './SlmOutputAdapter';

export class SlmInferenceEngine {
  private static session: any = null;
  private static ortModule: any = null;
  private static isLoading = false;
  private static modelPath = '/models/slm_routine_v1.onnx';
  private static isEnabled = true;

  static setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  static isReady(): boolean {
    return !!this.session && this.isEnabled;
  }

  static async init(modelUrl?: string): Promise<boolean> {
    if (modelUrl) this.modelPath = modelUrl;
    if (this.session || this.isLoading) return !!this.session;

    this.isLoading = true;
    try {
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
