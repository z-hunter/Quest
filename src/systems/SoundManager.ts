export type PanningModelType = 'HRTF' | 'equalpower';
export type DistanceModelType = 'linear' | 'inverse' | 'exponential';

export interface SceneSoundEnv {
  audioMaxDistance: number;
  reverbMaxDist: number;
  reverbMinPercent: number;
  zoomSensitivity: number;
  pannerRefDistance: number;
  pannerRolloffFactor: number;
  panningModel: PanningModelType;
  distanceModel: DistanceModelType;
  defaultReverbIR?: string;
}

export const DEFAULT_SOUND_ENV: SceneSoundEnv = {
  audioMaxDistance: 10000,
  reverbMaxDist: 1750,
  reverbMinPercent: 0.2,
  zoomSensitivity: 0.7,
  pannerRefDistance: 100,
  pannerRolloffFactor: 0.7,
  panningModel: 'HRTF',
  distanceModel: 'linear',
  defaultReverbIR: '',
};

export const AUDIO_MAX_DISTANCE = 10000;
export const PARALLAX_TO_Z_MULTIPLIER = 400;
export const REVERB_WET_OUTPUT_GAIN = 0.025;
export const REVERB_DISTANCE_EXPONENT = 1.5;
export const REVERB_WET_FADE_IN_SECONDS = 0.12;
export const REVERB_DISTANCE_MIN_LEVEL = 0.3;
export const DRY_ONLY_DISTANCE_MIN_LEVEL = 0.3;

export interface SoundOptions {
  volume?: number;
  loop?: boolean;
  position?: [number, number, number];
  reverbAmount?: number;
  reverbIR?: string;
  delayAmount?: number;
  delayTime?: number;
  delayFeedback?: number;
  offset?: number;
  startTime?: number;
  bypassSceneReverb?: boolean;
}

interface AttachedSound {
  entityId: string;
  useProximityEQ: boolean;
  bypassSceneReverb?: boolean;
}

interface ActiveSoundNode {
  source: AudioBufferSourceNode;
  gain: GainNode; // Main volume gain
  panner?: PannerNode;
  eqNode?: BiquadFilterNode;
  dryGain: GainNode; // Branch gain for dry signal
  reverbNode?: ConvolverNode;
  reverbWetGain?: GainNode; // Branch gain for reverb signal
  delayNode?: DelayNode;
  delayFeedback?: GainNode;
  delayWetGain?: GainNode; // Branch gain for delay signal
  attached?: AttachedSound;
  baseVolume: number;
  baseReverbAmount: number; // Configured wet level (0..1)
  usingDefaultIR: boolean; // True if using scene-wide default
  reverbIR?: string;
  reverbRequestId: number;
}

export class SoundManager {
  private static instance: SoundManager;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  private audioBuffers: Map<string, AudioBuffer> = new Map();
  private reverbBuffers: Map<string, AudioBuffer> = new Map();

  private nextPlaybackId = 1;
  private activeNodes: Map<number, ActiveSoundNode> = new Map();
  private env: SceneSoundEnv = { ...DEFAULT_SOUND_ENV };
  private attachedVolume = 1;

  private constructor() {}

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
  }

  public async unlock() {
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  public async setEnvironment(env?: Partial<SceneSoundEnv>) {
    const oldIR = this.env.defaultReverbIR;
    this.env = this.sanitizeEnv({ ...DEFAULT_SOUND_ENV, ...(env || {}) });
    const irChanged = oldIR !== this.env.defaultReverbIR;

    if (this.ctx) {
      const updates: Promise<void>[] = [];
      this.activeNodes.forEach((node, playbackId) => {
        if (node.panner) {
          node.panner.panningModel = this.env.panningModel;
          node.panner.distanceModel = this.env.distanceModel;
          node.panner.refDistance = this.env.pannerRefDistance;
          node.panner.maxDistance = this.env.audioMaxDistance;
          node.panner.rolloffFactor = this.env.pannerRolloffFactor;
        }

        this.applyAttachedVolume(node);

        if (irChanged && node.usingDefaultIR) {
          updates.push(this.setEffects(playbackId, {}, true));
        }
      });
      if (updates.length > 0) await Promise.all(updates);
    }
  }

  private sanitizeEnv(env: SceneSoundEnv): SceneSoundEnv {
    const isF = (v: any) => typeof v === 'number' && Number.isFinite(v);
    return {
      audioMaxDistance: isF(env.audioMaxDistance)
        ? env.audioMaxDistance
        : DEFAULT_SOUND_ENV.audioMaxDistance,
      reverbMaxDist: isF(env.reverbMaxDist) ? env.reverbMaxDist : DEFAULT_SOUND_ENV.reverbMaxDist,
      reverbMinPercent: isF(env.reverbMinPercent)
        ? Math.max(0, Math.min(1, env.reverbMinPercent))
        : DEFAULT_SOUND_ENV.reverbMinPercent,
      zoomSensitivity: isF(env.zoomSensitivity)
        ? env.zoomSensitivity
        : DEFAULT_SOUND_ENV.zoomSensitivity,
      pannerRefDistance: isF(env.pannerRefDistance)
        ? env.pannerRefDistance
        : DEFAULT_SOUND_ENV.pannerRefDistance,
      pannerRolloffFactor: isF(env.pannerRolloffFactor)
        ? env.pannerRolloffFactor
        : DEFAULT_SOUND_ENV.pannerRolloffFactor,
      panningModel: env.panningModel || DEFAULT_SOUND_ENV.panningModel,
      distanceModel: env.distanceModel || DEFAULT_SOUND_ENV.distanceModel,
      defaultReverbIR: this.normalizeReverbIRUrl(
        env.defaultReverbIR ?? DEFAULT_SOUND_ENV.defaultReverbIR ?? ''
      ),
    };
  }

  public async loadSound(id: string, url: string): Promise<void> {
    if (!this.ctx) this.init();
    if (this.audioBuffers.has(id)) return;
    try {
      const res = await fetch(url);
      const ab = await res.arrayBuffer();
      const buffer = await this.ctx!.decodeAudioData(ab);
      this.audioBuffers.set(id, buffer);
    } catch (err) {
      console.error(`SoundManager: Failed to load sound ${id} from ${url}`, err);
    }
  }

  public async loadReverbIR(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) this.init();
    const normalizedUrl = this.normalizeReverbIRUrl(url);
    if (!normalizedUrl) return null;
    if (this.reverbBuffers.has(normalizedUrl)) return this.reverbBuffers.get(normalizedUrl)!;
    try {
      const res = await fetch(normalizedUrl);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || contentType.toLowerCase().includes('text/html')) {
        console.error(
          `SoundManager: Failed to load Reverb IR from ${normalizedUrl} (HTTP ${res.status}, ${contentType || 'unknown content type'})`
        );
        return null;
      }
      const ab = await res.arrayBuffer();
      const buffer = await this.ctx!.decodeAudioData(ab);
      this.reverbBuffers.set(normalizedUrl, buffer);
      return buffer;
    } catch (err) {
      console.error(`SoundManager: Failed to load Reverb IR from ${normalizedUrl}`, err);
      return null;
    }
  }

  public play(id: string, options: SoundOptions = {}): number {
    if (!this.ctx || !this.masterGain) return -1;
    this.unlock().catch(console.error);

    const buffer = this.audioBuffers.get(id);
    if (!buffer) {
      console.warn(`SoundManager: Sound ${id} not found.`);
      return -1;
    }

    const playbackId = this.nextPlaybackId++;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = !!options.loop;

    const eqNode = this.ctx.createBiquadFilter();
    eqNode.type = 'peaking';
    eqNode.frequency.value = 250;
    eqNode.gain.value = 0;

    const baseVolume = options.volume ?? 1;
    const gainNode = this.ctx.createGain();
    gainNode.gain.value = baseVolume;

    const dryGain = this.ctx.createGain();
    dryGain.gain.value = 1.0;

    source.connect(eqNode);

    let mixerInput: AudioNode = eqNode;
    let panner: PannerNode | undefined;
    if (options.position) {
      panner = this.ctx.createPanner();
      panner.panningModel = this.env.panningModel;
      panner.distanceModel = this.env.distanceModel;
      panner.refDistance = this.env.pannerRefDistance;
      panner.maxDistance = this.env.audioMaxDistance;
      panner.rolloffFactor = this.env.pannerRolloffFactor;
      panner.positionX.value = options.position[0];
      panner.positionY.value = options.position[1];
      panner.positionZ.value = options.position[2];
      eqNode.connect(panner);
      mixerInput = panner;
    }

    mixerInput.connect(gainNode);
    gainNode.connect(dryGain);
    dryGain.connect(this.masterGain);

    const activeNode: ActiveSoundNode = {
      source,
      gain: gainNode,
      panner,
      eqNode,
      dryGain,
      baseVolume,
      baseReverbAmount: options.reverbAmount ?? 0,
      usingDefaultIR: false,
      reverbRequestId: 0,
    };
    this.activeNodes.set(playbackId, activeNode);

    source.onended = () => this.activeNodes.delete(playbackId);
    source.start(options.startTime || 0, options.offset || 0);

    // Initial Effects
    this.setEffects(playbackId, {
      reverbAmount: options.reverbAmount,
      reverbIR: options.reverbIR,
      delayAmount: options.delayAmount,
      delayTime: options.delayTime,
      delayFeedback: options.delayFeedback,
    });

    return playbackId;
  }

  public attachSound(
    playbackId: number,
    entityId: string,
    options: { useProximityEQ?: boolean; bypassSceneReverb?: boolean } = {}
  ) {
    const active = this.activeNodes.get(playbackId);
    if (!active || !this.ctx) return;

    active.attached = {
      entityId,
      useProximityEQ: !!options.useProximityEQ,
      bypassSceneReverb: !!options.bypassSceneReverb,
    };

    if (!active.panner) {
      active.panner = this.ctx.createPanner();
      active.panner.panningModel = this.env.panningModel;
      active.panner.distanceModel = this.env.distanceModel;
      active.panner.refDistance = this.env.pannerRefDistance;
      active.panner.maxDistance = this.env.audioMaxDistance;
      active.panner.rolloffFactor = this.env.pannerRolloffFactor;

      active.eqNode!.disconnect();
      active.eqNode!.connect(active.panner);
      active.panner.connect(active.gain);
    }

    this.applyAttachedVolume(active);

    if (options.useProximityEQ && !options.bypassSceneReverb) {
      active.usingDefaultIR = true;
      if (this.env.defaultReverbIR) {
        this.setEffects(playbackId, { reverbAmount: 1.0 });
      }
    }
  }

  public async setEffects(
    playbackId: number,
    effects: {
      reverbAmount?: number;
      reverbIR?: string;
      delayAmount?: number;
      delayTime?: number;
      delayFeedback?: number;
    },
    irChanged: boolean = false
  ) {
    const active = this.activeNodes.get(playbackId);
    if (!active || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Handle Reverb
    if (effects.reverbAmount !== undefined || effects.reverbIR !== undefined || irChanged) {
      const isCustom = effects.reverbIR !== undefined;
      const irUrl = this.normalizeReverbIRUrl(
        isCustom ? effects.reverbIR : active.usingDefaultIR ? this.env.defaultReverbIR : undefined
      );

      if (irUrl) {
        if (isCustom) active.usingDefaultIR = false;

        if (!active.reverbNode || active.reverbIR !== irUrl || irChanged) {
          const requestId = ++active.reverbRequestId;
          const buffer = await this.loadReverbIR(irUrl);
          if (active.reverbRequestId !== requestId) return;
          if (active.usingDefaultIR && this.env.defaultReverbIR !== irUrl) return;
          if (!buffer) {
            this.removeReverb(active, now);
          } else {
            const nextReverb = this.ctx.createConvolver();
            const wetGain = active.reverbWetGain ?? this.ctx.createGain();
            nextReverb.normalize = false;
            nextReverb.buffer = buffer;

            if (active.reverbNode) this.disconnect(active.gain, active.reverbNode);
            this.disconnect(active.reverbNode);
            this.disconnect(wetGain);
            this.muteAudioParam(wetGain.gain, now);

            active.gain.connect(nextReverb);
            nextReverb.connect(wetGain);
            wetGain.connect(this.masterGain!);

            active.reverbNode = nextReverb;
            active.reverbWetGain = wetGain;
            active.reverbIR = irUrl;
          }
        }

        if (effects.reverbAmount !== undefined) {
          active.baseReverbAmount = effects.reverbAmount;
        } else if (irChanged && active.usingDefaultIR && active.baseReverbAmount <= 0) {
          active.baseReverbAmount = 1.0;
        }

        // Initial sync of volumes
        if (active.reverbWetGain) {
          const amt = active.baseReverbAmount;
          if (!active.attached || !active.attached.useProximityEQ) {
            active.reverbWetGain.gain.setTargetAtTime(
              amt * REVERB_WET_OUTPUT_GAIN,
              now,
              REVERB_WET_FADE_IN_SECONDS
            );
            active.dryGain.gain.setTargetAtTime(Math.max(0, 1 - amt), now, 0.05);
          }
        }
      } else if (irChanged || isCustom) {
        if (isCustom) active.usingDefaultIR = false;
        active.reverbRequestId++;
        this.removeReverb(active, now);
      }
    }

    // Handle Delay (Simplified for brevity but consistent)
    if (
      effects.delayAmount !== undefined ||
      effects.delayTime !== undefined ||
      effects.delayFeedback !== undefined
    ) {
      if (!active.delayNode) {
        active.delayNode = this.ctx.createDelay(5.0);
        active.delayFeedback = this.ctx.createGain();
        active.delayWetGain = this.ctx.createGain();
        active.gain.connect(active.delayNode);
        active.delayNode.connect(active.delayFeedback);
        active.delayFeedback.connect(active.delayNode);
        active.delayNode.connect(active.delayWetGain);
        active.delayWetGain.connect(this.masterGain!);
      }
      if (effects.delayAmount !== undefined)
        active.delayWetGain!.gain.setTargetAtTime(effects.delayAmount, now, 0.05);
      if (effects.delayTime !== undefined)
        active.delayNode!.delayTime.setTargetAtTime(effects.delayTime, now, 0.05);
      if (effects.delayFeedback !== undefined)
        active.delayFeedback!.gain.setTargetAtTime(effects.delayFeedback, now, 0.05);
    }
  }

  public setProximityEQ(
    playbackId: number,
    dx: number,
    dy: number,
    parallax: number,
    zoom: number,
    totalDist: number
  ) {
    const active = this.activeNodes.get(playbackId);
    if (!active || !this.ctx || !active.eqNode) return;
    const now = this.ctx.currentTime;

    let mp = 0;
    if (parallax >= 0.9 && parallax <= 1.1) mp = (parallax - 0.9) / 0.2;
    else if (parallax > 1.1 && parallax <= 1.2) mp = 1.0 - (parallax - 1.1) / 0.1;

    const dxyScreen = Math.sqrt(dx * dx + dy * dy) * zoom;
    const mxy = Math.max(0, 1.0 - dxyScreen / 100);
    active.eqNode.gain.setTargetAtTime(Math.max(0, mp * mxy * 6.0), now, 0.1);

    const REVERB_MAX = Math.max(1, this.env.reverbMaxDist);
    const norm = Math.min(totalDist / REVERB_MAX, 1.0);
    const exp = Math.pow(norm, REVERB_DISTANCE_EXPONENT);

    if (active.reverbNode && active.reverbWetGain) {
      const minW = this.env.reverbMinPercent;
      const wetMix = minW + exp * (1.0 - minW);
      const baseWet = Math.max(0, active.baseReverbAmount);
      const wetMixAmount = baseWet * wetMix;
      const wetDistanceLevel =
        REVERB_DISTANCE_MIN_LEVEL + (1.0 - norm) * (1.0 - REVERB_DISTANCE_MIN_LEVEL);
      const wet = wetMixAmount * REVERB_WET_OUTPUT_GAIN * wetDistanceLevel;
      const dry = 1.0 - wetMixAmount;

      active.reverbWetGain.gain.setTargetAtTime(wet, now, REVERB_WET_FADE_IN_SECONDS);
      active.dryGain.gain.setTargetAtTime(Math.max(0, dry), now, 0.1);
    } else {
      const dryOnlyLevel =
        DRY_ONLY_DISTANCE_MIN_LEVEL + (1.0 - exp) * (1.0 - DRY_ONLY_DISTANCE_MIN_LEVEL);
      active.dryGain.gain.setTargetAtTime(dryOnlyLevel, now, 0.1);
    }
  }

  private removeReverb(active: ActiveSoundNode, now: number) {
    if (active.reverbNode) this.disconnect(active.gain, active.reverbNode);
    this.disconnect(active.reverbNode);
    this.disconnect(active.reverbWetGain);
    active.reverbNode = undefined;
    active.reverbWetGain = undefined;
    active.reverbIR = undefined;
    active.reverbRequestId++;
    active.dryGain.gain.setTargetAtTime(1.0, now, 0.05);
  }

  private muteAudioParam(param: AudioParam, now: number) {
    param.cancelScheduledValues(now);
    param.setValueAtTime(0, now);
  }

  private normalizeReverbIRUrl(url?: string): string {
    const trimmed = (url || '').trim().replace(/\\/g, '/');
    if (!trimmed) return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;

    const withoutPublic = trimmed.replace(/^\/?public\//i, '');
    if (withoutPublic.startsWith('sounds/')) return `/${withoutPublic}`;
    if (withoutPublic.startsWith('/sounds/')) return withoutPublic;

    const withoutLeadingSlash = withoutPublic.replace(/^\/+/, '');
    if (!withoutLeadingSlash.includes('/')) return `/sounds/ir/${withoutLeadingSlash}`;
    return withoutPublic.startsWith('/') ? withoutPublic : `/${withoutPublic}`;
  }

  private disconnect(node?: AudioNode, destination?: AudioNode) {
    if (!node) return;
    try {
      if (destination) node.disconnect(destination);
      else node.disconnect();
    } catch {
      // Web Audio throws when a specific edge is already gone; the target graph
      // state is still "disconnected", so stale edges can be ignored safely.
    }
  }

  private applyAttachedVolume(active: ActiveSoundNode) {
    if (!this.ctx) return;
    const volume = active.attached ? this.attachedVolume : 1;
    active.gain.gain.setTargetAtTime(active.baseVolume * volume, this.ctx.currentTime, 0.05);
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
        if (!data) {
          this.stop(playbackId);
          return;
        }

        const lx = cameraX,
          ly = cameraY,
          lz = 0;
        if (this.ctx) {
          const l = this.ctx.listener;
          if (l.positionX) {
            l.positionX.setTargetAtTime(lx, this.ctx.currentTime, 0.1);
            l.positionY.setTargetAtTime(ly, this.ctx.currentTime, 0.1);
            l.positionZ.setTargetAtTime(lz, this.ctx.currentTime, 0.1);
          } else l.setPosition(lx, ly, lz);
        }

        const px = data.x,
          py = data.y,
          p = data.parallax ?? 1;
        let pzWorld =
          p === 1.1
            ? 0
            : p > 1.1
              ? (p - 1.1) * 1000
              : p === 0
                ? -AUDIO_MAX_DISTANCE
                : -1000 * (1.1 / p - 1);
        pzWorld = Math.max(
          -this.env.audioMaxDistance,
          Math.min(this.env.audioMaxDistance, pzWorld)
        );

        let pz = pzWorld;
        const Z_SENS = this.env.zoomSensitivity;
        if (cameraZoom > 1.0) pz /= Math.max(0.01, 1.0 + (cameraZoom - 1.0) * Math.abs(p) * Z_SENS);
        else if (cameraZoom < 1.0) {
          const extraZ = Math.pow(1.0 - cameraZoom, 4.0) * this.env.audioMaxDistance * Z_SENS;
          pz += pzWorld < 0 ? -extraZ : pzWorld > 0 ? extraZ : 0;
        }

        if (Number.isFinite(pz)) {
          active.panner.positionX.setTargetAtTime(px, this.ctx!.currentTime, 0.1);
          active.panner.positionY.setTargetAtTime(py, this.ctx!.currentTime, 0.1);
          active.panner.positionZ.setTargetAtTime(pz, this.ctx!.currentTime, 0.1);
        }

        if (active.attached!.useProximityEQ) {
          const dx = px - lx,
            dy = py - ly,
            dz = pz - lz;
          this.setProximityEQ(
            playbackId,
            dx,
            dy,
            p,
            1.0 + (Math.max(0.01, cameraZoom) - 1.0) * Math.abs(p),
            Math.sqrt(dx * dx + dy * dy + dz * dz)
          );
        }
      }
    });
  }

  public setPosition(playbackId: number, x: number, y: number, z: number) {
    const a = this.activeNodes.get(playbackId);
    if (a?.panner && this.ctx) {
      a.panner.positionX.setTargetAtTime(x, this.ctx.currentTime, 0.1);
      a.panner.positionY.setTargetAtTime(y, this.ctx.currentTime, 0.1);
      a.panner.positionZ.setTargetAtTime(z, this.ctx.currentTime, 0.1);
    }
  }

  public setVolume(playbackId: number, v: number) {
    const a = this.activeNodes.get(playbackId);
    if (a && this.ctx) {
      a.baseVolume = v;
      this.applyAttachedVolume(a);
    }
  }

  public setAttachedVolume(v: number) {
    this.attachedVolume =
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 1;
    if (!this.ctx) return;
    this.activeNodes.forEach((active) => this.applyAttachedVolume(active));
  }

  public setMasterVolume(v: number) {
    if (this.masterGain && this.ctx)
      this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  public stop(playbackId: number) {
    const a = this.activeNodes.get(playbackId);
    if (a) {
      a.source.stop();
      this.activeNodes.delete(playbackId);
    }
  }

  public stopAll() {
    this.activeNodes.forEach((a) => a.source.stop());
    this.activeNodes.clear();
  }
}
