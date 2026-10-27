import { Howl, Howler } from "howler";

/** Largest boost in dB the balancer will apply to a track */
export const MAX_TRACK_GAIN = 12;
/** Largest cut in dB the balancer will apply to a track */
export const MIN_TRACK_GAIN = -30;
/** Time constant for smoothing gain changes in seconds */
const GAIN_SMOOTHING = 0.25;
/** Level of the signal that keeps the output running, -160dB is far too quiet to hear */
const KEEP_ALIVE_LEVEL = 1e-8;

let context: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
/** A media element can only ever be connected to one source node so reuse them */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
/** Layer gain each source is connected to */
const connections = new WeakMap<MediaElementAudioSourceNode, GainNode>();

// Electron doesn't need a user gesture to play audio so skip Howler's unlock step.
// It closes and recreates Howler's audio context as the first track starts
// and reloads any audio element it doesn't think has played yet
Howler.autoUnlock = false;

// Routed elements stay connected to web audio so they can't be reused for other sounds.
// Stop Howler returning them to its pool of reusable elements when a track is unloaded
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const howler = Howler as any;
const releaseHtml5Audio = howler._releaseHtml5Audio;
howler._releaseHtml5Audio = function (audio: HTMLAudioElement) {
  if (sources.has(audio)) {
    return this;
  }
  return releaseHtml5Audio.call(this, audio);
};

function getOutput() {
  if (!context) {
    // Low latency isn't needed for music and larger buffers are less likely to glitch
    context = new AudioContext({ latencyHint: "playback" });
    // Limiter to catch peaks pushed over 0dBFS when boosting quiet tracks
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(context.destination);
    // Chromium stops the output of a silent audio context after 30 seconds and
    // starts it again when sound plays. Keep it running with a signal too quiet
    // to hear so tracks never start while the output is starting
    const keepAlive = context.createConstantSource();
    keepAlive.offset.value = KEEP_ALIVE_LEVEL;
    keepAlive.connect(context.destination);
    keepAlive.start();
  }
  return { context, limiter };
}

/**
 * Start the playlist and Howler audio outputs ahead of time
 * so they are already running when the first track plays.
 */
export function startOutput() {
  const { context } = getOutput();
  if (context.state === "suspended") {
    context.resume();
  }
  // Getting the volume creates Howler's audio context
  Howler.volume();
}

/**
 * Only local files can have their gain adjusted.
 * Routing remote audio without CORS headers through web audio would silence it.
 */
export function canAdjustGain(url: string) {
  return url.startsWith("file:");
}

function dbToGain(db: number) {
  return Math.pow(10, db / 20);
}

/**
 * Routes the HTML5 audio of a playlist track through a gain node
 * so the dB balancer can raise or lower its level.
 * Each layer of a dynamic track gets its own gain node so only the active layer is heard.
 */
export class TrackOutput {
  /** Id of the track this output belongs to */
  trackId: string;
  _gain: GainNode | null = null;
  _db = 0;
  _howls: Howl[] = [];
  /** Gain node for each howl used to switch between layers */
  _layers: GainNode[] = [];
  /** Index of the layer that can be heard */
  _activeLayer = 0;

  constructor(trackId: string, gainDb: number) {
    this.trackId = trackId;
    this._db = gainDb;
  }

  /** Route a howl through this output if its source supports it */
  add(howl: Howl, url: string) {
    if (!canAdjustGain(url)) {
      return;
    }
    const { context, limiter } = getOutput();
    if (!this._gain) {
      this._gain = context.createGain();
      this._gain.gain.value = dbToGain(this._db);
      this._gain.connect(limiter);
    }
    const layer = context.createGain();
    layer.gain.value = this._howls.length === this._activeLayer ? 1 : 0;
    layer.connect(this._gain);
    this._howls.push(howl);
    this._layers.push(layer);
    this._connect(howl, layer);
    // Howler may create a new audio element when replaying so connect again on play
    howl.on("play", () => this._connect(howl, layer));
  }

  _connect(howl: Howl, layer: GainNode) {
    const { context } = getOutput();
    if (context.state === "suspended") {
      context.resume();
    }
    for (const sound of (howl as any)._sounds) {
      const element = sound._node;
      if (!(element instanceof HTMLMediaElement)) {
        continue;
      }
      let source = sources.get(element);
      if (!source) {
        source = context.createMediaElementSource(element);
        sources.set(element, source);
      }
      // Avoid reconnecting a playing source as it can cause a glitch
      if (connections.get(source) !== layer) {
        source.disconnect();
        source.connect(layer);
        connections.set(source, layer);
      }
    }
  }

  /** Set the gain in dB, ramping smoothly from the current level */
  setGain(db: number) {
    if (db === this._db) {
      return;
    }
    this._db = db;
    if (this._gain) {
      const { context } = getOutput();
      this._gain.gain.setTargetAtTime(
        dbToGain(db),
        context.currentTime,
        GAIN_SMOOTHING
      );
    }
  }

  /**
   * Cross fade to the layer at index
   * @param fade Fade duration in seconds
   */
  setLayer(index: number, fade: number) {
    if (index === this._activeLayer) {
      return;
    }
    this._activeLayer = index;
    if (this._layers.length === 0) {
      return;
    }
    const { context } = getOutput();
    const now = context.currentTime;
    this._layers.forEach((layer, i) => {
      // Layers are different mixes of the same music so a linear fade keeps the level even
      layer.gain.cancelScheduledValues(now);
      layer.gain.setValueAtTime(layer.gain.value, now);
      layer.gain.linearRampToValueAtTime(i === index ? 1 : 0, now + fade);
    });
  }

  dispose() {
    for (const howl of this._howls) {
      howl.off("play");
    }
    this._howls = [];
    for (const layer of this._layers) {
      layer.disconnect();
    }
    this._layers = [];
    this._gain?.disconnect();
    this._gain = null;
  }
}
