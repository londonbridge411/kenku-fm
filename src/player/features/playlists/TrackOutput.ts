import { Howl } from "howler";

/** Largest boost in dB the balancer will apply to a track */
export const MAX_TRACK_GAIN = 12;
/** Largest cut in dB the balancer will apply to a track */
export const MIN_TRACK_GAIN = -30;
/** Time constant for smoothing gain changes in seconds */
const GAIN_SMOOTHING = 0.25;

let context: AudioContext | null = null;
let limiter: DynamicsCompressorNode | null = null;
/** A media element can only ever be connected to one source node so reuse them */
const sources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

function getOutput() {
  if (!context) {
    context = new AudioContext();
    // Limiter to catch peaks pushed over 0dBFS when boosting quiet tracks
    limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(context.destination);
  }
  return { context, limiter };
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
 * so the dB balancer can raise or lower its level
 */
export class TrackOutput {
  /** Id of the track this output belongs to */
  trackId: string;
  _gain: GainNode | null = null;
  _db = 0;
  _howls: Howl[] = [];

  constructor(trackId: string, gainDb: number) {
    this.trackId = trackId;
    this._db = gainDb;
  }

  /** Route a howl through this output if its source supports it */
  add(howl: Howl, url: string) {
    if (!canAdjustGain(url)) {
      return;
    }
    if (!this._gain) {
      const { context, limiter } = getOutput();
      this._gain = context.createGain();
      this._gain.gain.value = dbToGain(this._db);
      this._gain.connect(limiter);
    }
    this._howls.push(howl);
    this._connect(howl);
    // Howler may create a new audio element when replaying so connect again on play
    howl.on("play", () => this._connect(howl));
  }

  _connect(howl: Howl) {
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
        // Stop Howler from reusing this element for other sounds once it's unloaded
        // as it will always be routed through web audio from now on.
        // Howler only pools elements marked unlocked and marks them on every play
        Object.defineProperty(element, "_unlocked", {
          get: () => false,
          set: () => {},
        });
      }
      source.disconnect();
      source.connect(this._gain);
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

  dispose() {
    for (const howl of this._howls) {
      howl.off("play");
    }
    this._howls = [];
    this._gain?.disconnect();
    this._gain = null;
  }
}
