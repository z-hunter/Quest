import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SOUND_ENV,
  DRY_ONLY_DISTANCE_MIN_LEVEL,
  REVERB_DISTANCE_MIN_LEVEL,
  REVERB_WET_OUTPUT_GAIN,
  SoundManager,
} from '../../src/systems/SoundManager';

class FakeAudioParam {
  value: number;

  constructor(value = 0) {
    this.value = value;
  }

  setTargetAtTime(value: number) {
    this.value = value;
  }

  cancelScheduledValues() {}

  setValueAtTime(value: number) {
    this.value = value;
  }
}

class FakeAudioNode {
  connections = new Set<FakeAudioNode>();

  connect(node: FakeAudioNode) {
    this.connections.add(node);
    return node;
  }

  disconnect(node?: FakeAudioNode) {
    if (node) this.connections.delete(node);
    else this.connections.clear();
  }
}

class FakeGainNode extends FakeAudioNode {
  gain = new FakeAudioParam(1);
}

class FakeConvolverNode extends FakeAudioNode {
  buffer: unknown;
  normalize = true;
}

class FakeBiquadFilterNode extends FakeAudioNode {
  gain = new FakeAudioParam(0);
}

class FakeAudioContext {
  currentTime = 1;

  createGain() {
    return new FakeGainNode();
  }

  createConvolver() {
    return new FakeConvolverNode();
  }
}

function resetSoundManager() {
  const manager = SoundManager.getInstance() as unknown as {
    ctx: FakeAudioContext | null;
    masterGain: FakeGainNode | null;
    activeNodes: Map<number, unknown>;
    env: typeof DEFAULT_SOUND_ENV;
    loadReverbIR: (url: string) => Promise<unknown>;
  };

  manager.ctx = new FakeAudioContext();
  manager.masterGain = new FakeGainNode();
  manager.activeNodes = new Map();
  manager.env = { ...DEFAULT_SOUND_ENV };
  manager.loadReverbIR = vi.fn(async (url: string) => ({ url }));

  return manager;
}

function createDefaultIRSound(manager: ReturnType<typeof resetSoundManager>) {
  const gain = new FakeGainNode();
  const dryGain = new FakeGainNode();
  gain.connect(dryGain);
  const active = {
    source: new FakeAudioNode(),
    gain,
    dryGain,
    eqNode: new FakeBiquadFilterNode(),
    baseReverbAmount: 1,
    usingDefaultIR: true,
    reverbRequestId: 0,
  };
  manager.activeNodes.set(1, active);
  return active;
}

describe('SoundManager default scene reverb IR', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps attached sounds subscribed when the scene default IR changes repeatedly', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);

    await SoundManager.getInstance().setEnvironment({ defaultReverbIR: '/sounds/ir/a.wav' });
    const firstReverb = active.reverbNode as FakeConvolverNode;

    expect(active.usingDefaultIR).toBe(true);
    expect(active.gain.connections.has(active.dryGain)).toBe(true);
    expect(active.gain.connections.has(firstReverb)).toBe(true);

    await SoundManager.getInstance().setEnvironment({ defaultReverbIR: '/sounds/ir/b.wav' });
    const secondReverb = active.reverbNode as FakeConvolverNode;

    expect(active.usingDefaultIR).toBe(true);
    expect(secondReverb).not.toBe(firstReverb);
    expect(secondReverb.normalize).toBe(false);
    expect(active.gain.connections.has(active.dryGain)).toBe(true);
    expect(active.gain.connections.has(firstReverb)).toBe(false);
    expect(active.gain.connections.has(secondReverb)).toBe(true);
    expect(active.reverbIR).toBe('/sounds/ir/b.wav');
  });

  it('resolves bare IR filenames to the public sounds/ir folder', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);

    await SoundManager.getInstance().setEnvironment({ defaultReverbIR: '/room_drum_medium.wav' });

    expect(manager.loadReverbIR).toHaveBeenCalledWith('/sounds/ir/room_drum_medium.wav');
    expect(active.reverbIR).toBe('/sounds/ir/room_drum_medium.wav');
  });

  it('enables scene default wet level for sounds that started before an IR was selected', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);
    active.baseReverbAmount = 0;

    await SoundManager.getInstance().setEnvironment({ defaultReverbIR: '/sounds/ir/a.wav' });

    expect(active.baseReverbAmount).toBe(1);
    SoundManager.getInstance().setProximityEQ(1, 0, 0, 1.1, 1, 0);
    expect(active.dryGain.gain.value).toBeCloseTo(0.8);
    expect(active.reverbWetGain?.gain.value).toBeCloseTo(0.2 * REVERB_WET_OUTPUT_GAIN);
  });

  it('crossfades dry and wet reverb according to scene distance settings', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);

    await SoundManager.getInstance().setEnvironment({
      defaultReverbIR: '/sounds/ir/a.wav',
      reverbMaxDist: 1000,
      reverbMinPercent: 0.25,
    });

    SoundManager.getInstance().setProximityEQ(1, 0, 0, 1.1, 1, 0);
    expect(active.reverbWetGain?.gain.value).toBeCloseTo(0.25 * REVERB_WET_OUTPUT_GAIN);
    expect(active.dryGain.gain.value).toBeCloseTo(0.75);

    SoundManager.getInstance().setProximityEQ(1, 0, 0, 1.1, 1, 1000);
    expect(active.reverbWetGain?.gain.value).toBeCloseTo(
      REVERB_WET_OUTPUT_GAIN * REVERB_DISTANCE_MIN_LEVEL
    );
    expect(active.dryGain.gain.value).toBeCloseTo(0);
  });

  it('keeps zero reverb at the listener when Reverb Min Percent is zero', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);

    await SoundManager.getInstance().setEnvironment({
      defaultReverbIR: '/sounds/ir/a.wav',
      reverbMaxDist: 1000,
      reverbMinPercent: 0,
    });

    SoundManager.getInstance().setProximityEQ(1, 0, 0, 1.1, 1, 0);
    expect(active.reverbWetGain?.gain.value).toBe(0);
    expect(active.dryGain.gain.value).toBe(1);
  });

  it('removes the wet branch and restores dry output when the scene default IR is cleared', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);

    await SoundManager.getInstance().setEnvironment({ defaultReverbIR: '/sounds/ir/a.wav' });
    await SoundManager.getInstance().setEnvironment({ defaultReverbIR: '' });

    expect(active.usingDefaultIR).toBe(true);
    expect(active.reverbNode).toBeUndefined();
    expect(active.reverbWetGain).toBeUndefined();
    expect(active.reverbIR).toBeUndefined();
    expect(active.gain.connections.has(active.dryGain)).toBe(true);
    expect(active.dryGain.gain.value).toBe(1);

    SoundManager.getInstance().setProximityEQ(1, 0, 0, 1.1, 1, 0);
    expect(active.dryGain.gain.value).toBe(1);
  });

  it('attenuates dry-only attached sounds with distance when no reverb branch exists', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);

    await SoundManager.getInstance().setEnvironment({
      reverbMaxDist: 1000,
    });

    SoundManager.getInstance().setProximityEQ(1, 0, 0, 1.1, 1, 0);
    expect(active.dryGain.gain.value).toBeCloseTo(1);

    SoundManager.getInstance().setProximityEQ(1, 0, 0, 1.1, 1, 1000);
    expect(active.dryGain.gain.value).toBeCloseTo(DRY_ONLY_DISTANCE_MIN_LEVEL);
  });

  it('ignores stale IR loads after the scene default IR is cleared', async () => {
    const manager = resetSoundManager();
    const active = createDefaultIRSound(manager);
    let resolveLoad: (buffer: unknown) => void = () => {};
    manager.loadReverbIR = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        })
    );

    const pendingSet = SoundManager.getInstance().setEnvironment({
      defaultReverbIR: '/sounds/ir/a.wav',
    });
    await SoundManager.getInstance().setEnvironment({ defaultReverbIR: '' });
    resolveLoad({ url: '/sounds/ir/a.wav' });
    await pendingSet;

    expect(active.reverbNode).toBeUndefined();
    expect(active.reverbWetGain).toBeUndefined();
    expect(active.reverbIR).toBeUndefined();
    expect(active.dryGain.gain.value).toBe(1);
  });
});
