import { Track, TrackLayer } from "./playlistsSlice";
import { canAdjustGain } from "./TrackOutput";

/**
 * All layers of a track with the main audio first, the main layer shares the track's id.
 * Layers without a source yet are skipped.
 */
export function getTrackLayers(track: Track): TrackLayer[] {
  return [
    { id: track.id, title: track.layerTitle || "Main", url: track.url },
    ...(track.layers || []).filter((layer) => layer.url),
  ];
}

/** A track with more than one layer */
export function isDynamicTrack(track: Track) {
  return getTrackLayers(track).length > 1;
}

/**
 * Layers that will be played for a track.
 * Switching layers silences the others through web audio which only works with local files
 * so dynamic tracks with remote audio fall back to only playing the main layer.
 */
export function getPlayableLayers(track: Track): TrackLayer[] {
  const layers = getTrackLayers(track);
  if (layers.every((layer) => canAdjustGain(layer.url))) {
    return layers;
  }
  return layers.slice(0, 1);
}
