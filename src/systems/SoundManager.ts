export const AUDIO_MAX_DISTANCE = 10000;
export const PARALLAX_TO_Z_MULTIPLIER = 400; // Parallax 1 will be at Z=400

export interface SoundOptions {
  volume?: number;
  loop?: boolean;
  position?: [number, number, number]; // [x, y, z] for 3D panning
  reverbAmount?: number; // 0 to 1 (wet mix for reverb)
  delayAmount?: number; // 0 to 1 (wet mix for delay)
  delayTime?: number; // seconds for delay
  delayFeedback?: number; // 0 to 1 for delay feedback
  offset?: number; // Start time offset in seconds
  startTime?: number; // Absolute time to start playing (AudioContext time)
}

interface AttachedSound {
  entityId: string;
  useProximityEQ: boolean;
}

interface ActiveSoundNode {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner?: PannerNode;
  eqNode?: BiquadFilterNode;
  reverbWetGain?: GainNode;
  delayWetGain?: GainNode;
  delayNode?: DelayNode;
  delayFeedback?: GainNode;
  dryGain: GainNode;
  attached?: AttachedSound;
  baseReverbAmount?: number;
}

export class SoundManager {
  private static instance: SoundManager;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Cache
  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private reverbBuffer: AudioBuffer | null = null;

  // Playback state
  private nextPlaybackId = 1;
  private activeNodes: Map<number, ActiveSoundNode> = new Map();

  private constructor() {
    // Singleton pattern
  }

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public init() {
    if (this.ctx) return;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('Web Audio API is not supported in this browser');
      return;
    }

    this.ctx = new AudioContextClass();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  public async unlock() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public async loadSound(id: string, url: string): Promise<void> {
    if (!this.ctx) this.init();
    if (this.audioBuffers.has(id)) return;

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
      this.audioBuffers.set(id, audioBuffer);
    } catch (err) {
      console.error(`Failed to load sound: ${id} from ${url}`, err);
    }
  }

  public async loadReverbIR(url: string): Promise<void> {
    if (!this.ctx) this.init();
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      this.reverbBuffer = await this.ctx!.decodeAudioData(arrayBuffer);
    } catch (err) {
      console.error(`Failed to load Reverb IR from ${url}`, err);
    }
  }

  public play(id: string, options: SoundOptions = {}): number {
    if (!this.ctx || !this.masterGain) {
      console.warn('SoundManager is not initialized or unlocked properly.');
      return -1;
    }

    // Ensure AudioContext is resumed if suspended
    this.unlock().catch(console.error);

    const buffer = this.audioBuffers.get(id);
    if (!buffer) {
      console.warn(`Sound ${id} not found. Call loadSound first.`);
      return -1;
    }

    const playbackId = this.nextPlaybackId++;

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = !!options.loop;

    // Base EQ for proximity (Peaking at 250Hz, default flat)
    const eqNode = this.ctx.createBiquadFilter();
    eqNode.type = 'peaking';
    eqNode.frequency.value = 250;
    eqNode.gain.value = 0; // Flat by default
    eqNode.Q.value = 1.0;

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = options.volume !== undefined ? options.volume : 1;

    let currentNode: AudioNode = source;
    currentNode.connect(eqNode);
    currentNode = eqNode;

    let pannerNode: PannerNode | undefined;
    if (options.position) {
      pannerNode = this.ctx.createPanner();
      pannerNode.panningModel = 'HRTF';
      pannerNode.distanceModel = 'exponential';
      pannerNode.refDistance = 1000;
      pannerNode.maxDistance = AUDIO_MAX_DISTANCE;
      pannerNode.rolloffFactor = 1.5;

      pannerNode.positionX.value = options.position[0];
      pannerNode.positionY.value = options.position[1];
      pannerNode.positionZ.value = options.position[2];

      currentNode.connect(pannerNode);
      currentNode = pannerNode;
    }

    currentNode.connect(gainNode);

    const dryGain = this.ctx.createGain();
    dryGain.gain.value = 1;
    gainNode.connect(dryGain);
    dryGain.connect(this.masterGain);

    let delayNode: DelayNode | undefined;
    let delayFeedback: GainNode | undefined;
    let delayWetGain: GainNode | undefined;

    if (options.delayAmount && options.delayAmount > 0) {
      delayNode = this.ctx.createDelay(5.0); // max delay 5 seconds
      delayNode.delayTime.value = options.delayTime || 0.3;

      delayFeedback = this.ctx.createGain();
      delayFeedback.gain.value = options.delayFeedback || 0.3;

      delayWetGain = this.ctx.createGain();
      delayWetGain.gain.value = options.delayAmount;

      gainNode.connect(delayNode);
      delayNode.connect(delayFeedback);
      delayFeedback.connect(delayNode);

      delayNode.connect(delayWetGain);
      delayWetGain.connect(this.masterGain);
    }

    let reverbWetGain: GainNode | undefined;

    if (options.reverbAmount && options.reverbAmount > 0 && this.reverbBuffer) {
      const convolverNode = this.ctx.createConvolver();
      convolverNode.buffer = this.reverbBuffer;

      reverbWetGain = this.ctx.createGain();
      reverbWetGain.gain.value = options.reverbAmount;

      gainNode.connect(convolverNode);
      convolverNode.connect(reverbWetGain);
      reverbWetGain.connect(this.masterGain);

      dryGain.gain.value = Math.max(0, 1 - options.reverbAmount * 0.5);
    }

    source.onended = () => {
      this.activeNodes.delete(playbackId);
    };

    const when = options.startTime || 0;
    const offset = options.offset || 0;
    source.start(when, offset);

    this.activeNodes.set(playbackId, {
      source,
      gain: gainNode,
      panner: pannerNode,
      eqNode,
      dryGain,
      reverbWetGain,
      delayWetGain,
      delayNode,
      delayFeedback,
      baseReverbAmount: options.reverbAmount,
    });

    return playbackId;
  }

  public attachSound(playbackId: number, entityId: string, useProximityEQ: boolean = false) {
    const active = this.activeNodes.get(playbackId);
    if (active) {
      active.attached = { entityId, useProximityEQ };
      // Ensure panner exists if we are attaching it
      if (!active.panner && this.ctx) {
        active.panner = this.ctx.createPanner();
        active.panner.panningModel = 'HRTF';
        active.panner.distanceModel = 'exponential';
        active.panner.refDistance = 1000;
        active.panner.maxDistance = AUDIO_MAX_DISTANCE;
        active.panner.rolloffFactor = 1.5;

        // Re-route to include panner
        active.eqNode!.disconnect();
        active.eqNode!.connect(active.panner);
        active.panner.connect(active.gain);
      }
    }
  }

  public setEffects(
    playbackId: number,
    effects: {
      reverbAmount?: number;
      delayAmount?: number;
      delayTime?: number;
      delayFeedback?: number;
    }
  ) {
    const active = this.activeNodes.get(playbackId);
    if (!active || !this.ctx) return;
    const now = this.ctx.currentTime;

    if (effects.reverbAmount !== undefined && active.reverbWetGain) {
      active.baseReverbAmount = effects.reverbAmount;
      if (!active.attached || !active.attached.useProximityEQ) {
        active.reverbWetGain.gain.setTargetAtTime(effects.reverbAmount, now, 0.05);
        active.dryGain.gain.setTargetAtTime(Math.max(0, 1 - effects.reverbAmount * 0.5), now, 0.05);
      }
    }

    if (effects.delayAmount !== undefined && active.delayWetGain) {
      active.delayWetGain.gain.setTargetAtTime(effects.delayAmount, now, 0.05);
    }

    if (effects.delayTime !== undefined && active.delayNode) {
      active.delayNode.delayTime.setTargetAtTime(effects.delayTime, now, 0.05);
    }

    if (effects.delayFeedback !== undefined && active.delayFeedback) {
      active.delayFeedback.gain.setTargetAtTime(effects.delayFeedback, now, 0.05);
    }
  }

  public setProximityEQ(playbackId: number, distance: number) {
    const active = this.activeNodes.get(playbackId);
    if (!active || !this.ctx || !active.eqNode) return;

    const now = this.ctx.currentTime;
    // Map distance (0 to MAX) to EQ params
    // Closer (dist -> 0) = louder 250Hz (+6dB), wider stereo (handled by panner distance naturally, but we can tweak)
    // Less reverb, more pre-delay.

    const normalizedDist = Math.min(distance / AUDIO_MAX_DISTANCE, 1.0); // 0 = exactly at listener, 1 = far

    // 250Hz Boost: +6dB when close, 0dB when far
    const eqBoost = (1.0 - normalizedDist) * 6.0;
    active.eqNode.gain.setTargetAtTime(eqBoost, now, 0.1);

    // Reverb decrease when close, increase when far
    if (active.reverbWetGain && active.baseReverbAmount !== undefined) {
      // Far distance = more wet, less dry.
      // Use an exponential curve (power of 1.5) to keep the sound drier for a wider radius
      // before the reverb aggressively takes over at great distances.
      const expDist = Math.pow(normalizedDist, 1.5);

      const wetMultiplier = 0.2 + expDist * 0.8;
      const actualWet = Math.min(1.0, active.baseReverbAmount * wetMultiplier);

      const dryMultiplier = 0.8 * Math.max(0, 1.0 - expDist);
      const actualDry = Math.max(0, 1.0 - active.baseReverbAmount * 0.5) * dryMultiplier;

      active.reverbWetGain.gain.setTargetAtTime(actualWet, now, 0.1);
      active.dryGain.gain.setTargetAtTime(actualDry, now, 0.1);
    }
  }

  public updateAttachedSounds(
    cameraX: number,
    cameraY: number,
    cameraZoom: number,
    getEntityData: (id: string) => { x: number; y: number; parallax: number } | null
  ) {
    this.activeNodes.forEach((active, playbackId) => {
      if (active.attached && active.panner) {
        const data = getEntityData(active.attached.entityId);
        if (data) {
          const safeZoom = Math.max(0.01, cameraZoom);

          // The Listener (Camera) is always at Z = 0 in this model.
          // Parallax 0 is at head level (Z = 0).
          // Parallax 1 is in front of the listener (-Z in Web Audio).
          // Parallax -1 is behind the listener (+Z in Web Audio).
          const lz = 0;
          const lx = cameraX;
          const ly = cameraY;

          if (this.ctx) {
            const listener = this.ctx.listener;
            if (listener.positionX) {
              listener.positionX.setTargetAtTime(lx, this.ctx.currentTime, 0.1);
              listener.positionY.setTargetAtTime(ly, this.ctx.currentTime, 0.1);
              listener.positionZ.setTargetAtTime(lz, this.ctx.currentTime, 0.1);
            } else {
              listener.setPosition(lx, ly, lz); // Legacy fallback
            }
          }

          // Panner node world position.
          // Negative Z is 'in front' for default Web Audio listener.
          const px = data.x;
          const py = data.y;
          const parallax = data.parallax !== undefined ? data.parallax : 1;

          let pzWorld = 0;
          if (parallax === 1.1) {
            pzWorld = 0; // Head level
          } else if (parallax > 0 && parallax < 1.1) {
            // Map 1.1 -> 0, 1.0 -> -400, 0 -> -Infinity
            const f = 4000;
            pzWorld = -f * (1.1 / parallax - 1);
          } else if (parallax >= 1.1) {
            // Moving faster than camera -> goes behind listener (+Z)
            pzWorld = (parallax - 1.1) * 4000;
          } else if (parallax <= 0) {
            if (parallax === 0) {
              pzWorld = -AUDIO_MAX_DISTANCE; // Infinity in front
            } else {
              // Negative parallax: infinity behind listener (+Z)
              // Map -2 to AUDIO_MAX_DISTANCE
              pzWorld = Math.abs(parallax) * (AUDIO_MAX_DISTANCE / 2);
            }
          }

          const pz = pzWorld / safeZoom;

          active.panner.positionX.setTargetAtTime(px, this.ctx!.currentTime, 0.1);
          active.panner.positionY.setTargetAtTime(py, this.ctx!.currentTime, 0.1);
          active.panner.positionZ.setTargetAtTime(pz, this.ctx!.currentTime, 0.1);

          if (active.attached.useProximityEQ) {
            // Calculate 3D distance
            const dx = px - lx;
            const dy = py - ly;
            const dz = pz - lz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            this.setProximityEQ(playbackId, dist);
          }
        } else {
          // Object no longer exists, stop the sound
          this.stop(playbackId);
        }
      }
    });
  }

  public setPosition(playbackId: number, x: number, y: number, z: number) {
    const active = this.activeNodes.get(playbackId);
    if (active && active.panner && this.ctx) {
      active.panner.positionX.setTargetAtTime(x, this.ctx.currentTime, 0.1);
      active.panner.positionY.setTargetAtTime(y, this.ctx.currentTime, 0.1);
      active.panner.positionZ.setTargetAtTime(z, this.ctx.currentTime, 0.1);
    }
  }

  public setVolume(playbackId: number, volume: number) {
    const active = this.activeNodes.get(playbackId);
    if (active && this.ctx) {
      active.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }
  }

  public setMasterVolume(volume: number) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.05);
    }
  }

  public stop(playbackId: number) {
    const active = this.activeNodes.get(playbackId);
    if (active) {
      active.source.stop();
      this.activeNodes.delete(playbackId);
    }
  }

  public stopAll() {
    this.activeNodes.forEach((active) => active.source.stop());
    this.activeNodes.clear();
  }
}
