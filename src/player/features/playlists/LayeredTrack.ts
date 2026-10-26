import { Howl } from "howler";
import { TypedEmitter } from "tiny-typed-emitter";

import { TrackLayer } from "./playlistsSlice";
import { TrackOutput } from "./TrackOutput";

/** How long switching between layers takes in seconds */
const LAYER_FADE_DURATION = 2;
/** Layers further apart than this in seconds are seeked back into sync */
const MAX_LAYER_DRIFT = 0.05;
/** How often to check that layers are in sync in ms */
const SYNC_INTERVAL = 1000;

export interface LayeredTrackEvents {
  /** Every layer has loaded */
  load: () => void;
  error: () => void;
  /** The main layer finished a fade */
  fade: () => void;
  /** The main layer reached the end */
  end: () => void;
}

/**
 * Plays every layer of a track in sync behind a Howl like interface.
 * Playback controls apply to all layers and the output's layer gains decide which one is heard.
 * Tracks without extra layers have a single layer and behave like a normal Howl.
 */
export class LayeredTrack extends TypedEmitter<LayeredTrackEvents> {
  layers: TrackLayer[];
  _howls: Howl[];
  _output: TrackOutput;
  /** Index of the layer being heard */
  _active = 0;
  _syncInterval: number | null = null;
  _errored = false;

  constructor(
    layers: TrackLayer[],
    output: TrackOutput,
    options: { mute: boolean }
  ) {
    super();
    this.layers = layers;
    this._output = output;
    let loaded = 0;
    this._howls = layers.map((layer) => {
      const howl = new Howl({
        src: layer.url,
        html5: true,
        mute: options.mute,
        volume: 0,
      });
      output.add(howl, layer.url);
      howl.once("load", () => {
        loaded += 1;
        if (loaded === layers.length) {
          this.emit("load");
        }
      });
      howl.on("loaderror", () => this._error());
      howl.on("playerror", () => this._error());
      return howl;
    });
    this._main.on("fade", () => this.emit("fade"));
    this._main.on("end", () => this.emit("end"));
  }

  /** Only report the first error as any layer failing fails the whole track */
  _error() {
    if (!this._errored) {
      this._errored = true;
      this.emit("error");
    }
  }

  get _main() {
    return this._howls[0];
  }

  /** False if Howler was unable to create a sound for any layer */
  valid() {
    return this._howls.every((howl) => Boolean((howl as any)._sounds[0]));
  }

  play() {
    for (const howl of this._howls) {
      howl.play();
    }
    this._startSync();
  }

  pause() {
    this._stopSync();
    for (const howl of this._howls) {
      howl.pause();
    }
  }

  stop() {
    this._stopSync();
    for (const howl of this._howls) {
      howl.stop();
    }
  }

  playing() {
    return this._main.playing();
  }

  duration() {
    return this._main.duration();
  }

  /** Get the playback position or seek every layer to a position in seconds */
  seek(to?: number): number {
    if (to === undefined) {
      // Fall back to the main layer if the active layer is shorter and has ended
      const active = this._howls[this._active];
      return (active.playing() ? active : this._main).seek() as number;
    }
    for (const howl of this._howls) {
      howl.seek(to);
    }
    return to;
  }

  /** Get or set the volume of every layer */
  volume(volume?: number): number {
    if (volume === undefined) {
      return this._main.volume() as number;
    }
    for (const howl of this._howls) {
      howl.volume(volume);
    }
    return volume;
  }

  fade(from: number, to: number, duration: number) {
    for (const howl of this._howls) {
      howl.fade(from, to, duration);
    }
  }

  mute(muted: boolean) {
    for (const howl of this._howls) {
      howl.mute(muted);
    }
  }

  unload() {
    this._stopSync();
    this.removeAllListeners();
    for (const howl of this._howls) {
      howl.unload();
    }
  }

  /** Cross fade to a layer, unknown ids switch back to the main layer */
  setLayer(id: string | undefined) {
    const index = Math.max(
      this.layers.findIndex((layer) => layer.id === id),
      0
    );
    if (index === this._active) {
      return;
    }
    // Line the new layer up with the one being heard before fading it in
    if (this.playing()) {
      this._syncLayer(index, this.seek());
    }
    this._active = index;
    this._output.setLayer(index, LAYER_FADE_DURATION);
  }

  /** Seek a layer to the position if it has drifted out of sync */
  _syncLayer(index: number, position: number) {
    const howl = this._howls[index];
    if (
      howl.playing() &&
      Math.abs((howl.seek() as number) - position) > MAX_LAYER_DRIFT
    ) {
      howl.seek(position);
    }
  }

  _startSync() {
    if (this._howls.length < 2 || this._syncInterval !== null) {
      return;
    }
    // HTML5 audio elements drift apart over time so keep the silent layers
    // lined up with the one being heard
    this._syncInterval = window.setInterval(() => {
      if (!this._howls[this._active].playing()) {
        return;
      }
      const position = this.seek();
      for (let i = 0; i < this._howls.length; i++) {
        if (i !== this._active) {
          this._syncLayer(i, position);
        }
      }
    }, SYNC_INTERVAL);
  }

  _stopSync() {
    if (this._syncInterval !== null) {
      clearInterval(this._syncInterval);
      this._syncInterval = null;
    }
  }
}
