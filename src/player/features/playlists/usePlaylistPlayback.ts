import { useCallback, useEffect, useRef } from "react";

import { useDispatch, useSelector, useStore } from "react-redux";
import { RootState } from "../../app/store";
import {
  playPause,
  playTrack,
  updatePlayback,
  updateQueue,
  stopTrack,
} from "./playlistPlaybackSlice";
import { Track } from "./playlistsSlice";
import { getTrackGain } from "./balancerSlice";
import { startOutput, TrackOutput } from "./TrackOutput";
import { LayeredTrack } from "./LayeredTrack";
import { getPlayableLayers } from "./trackLayers";

/** How long a soft stop takes to fade out the current track in ms */
const SOFT_STOP_FADE_DURATION = 3000;

export function usePlaylistPlayback(onError: (message: string) => void) {
  const trackRef = useRef<LayeredTrack | null>(null);
  /** Gain stage of the current track used by the dB balancer */
  const outputRef = useRef<TrackOutput | null>(null);
  const animationRef = useRef<number | null>(null);
  /** Timeout that finishes an in progress soft stop */
  const softStopRef = useRef<number | null>(null);

  const playlists = useSelector((state: RootState) => state.playlists);
  const store = useStore<RootState>();
  const muted = useSelector((state: RootState) => state.playlistPlayback.muted);
  const repeat = useSelector(
    (state: RootState) => state.playlistPlayback.repeat
  );
  const shuffle = useSelector(
    (state: RootState) => state.playlistPlayback.shuffle
  );
  const queue = useSelector((state: RootState) => state.playlistPlayback.queue);
  const playbackTrack = useSelector(
    (state: RootState) => state.playlistPlayback.track
  );
  const layer = useSelector((state: RootState) => state.playlistPlayback.layer);
  const dispatch = useDispatch();

  /** Cancel an in progress soft stop, returns true if one was cancelled */
  const cancelSoftStop = useCallback(() => {
    if (softStopRef.current === null) {
      return false;
    }
    clearTimeout(softStopRef.current);
    softStopRef.current = null;
    return true;
  }, []);

  const play = useCallback(
    /** @param layer Id of the layer to start a dynamic track on, the main layer by default */
    (track: Track, layer?: string) => {
      // The previous track is faded out below so no need to finish the soft stop
      cancelSoftStop();
      let prevTrack = trackRef.current;
      let prevOutput = outputRef.current;
      function removePrevTrack() {
        if (prevTrack) {
          prevTrack.unload();
          prevTrack = undefined;
        }
        if (prevOutput) {
          prevOutput.dispose();
          prevOutput = undefined;
        }
      }
      const state = store.getState();
      const output = new TrackOutput(
        track.id,
        getTrackGain(state.playlists.tracks[track.id] || track, state.balancer)
      );
      let howl: LayeredTrack | undefined;
      function error() {
        howl?.unload();
        trackRef.current = undefined;
        if (outputRef.current === output) {
          outputRef.current = null;
        }
        output.dispose();
        dispatch(stopTrack());
        removePrevTrack();
        onError(`Unable to play track: ${track.title}`);
      }

      try {
        howl = new LayeredTrack(getPlayableLayers(track), output, {
          mute: muted,
          layer,
        });

        trackRef.current = howl;
        outputRef.current = output;
        howl.once("load", () => {
          dispatch(
            playTrack({
              track,
              duration: Math.floor(howl.duration()),
              layer: howl.layers[howl._active].id,
            })
          );
          // Fade out previous track and fade in new track
          if (prevTrack) {
            prevTrack.fade(prevTrack.volume(), 0, 1000);
            prevTrack.once("fade", removePrevTrack);
          }
          howl.fade(0, store.getState().playlistPlayback.volume, 1000);
          // Update playback
          // Create playback animation
          if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current);
          }
          let prevTime = performance.now();
          function animatePlayback(time: number) {
            animationRef.current = requestAnimationFrame(animatePlayback);
            // Limit update to 1 time per second
            const delta = time - prevTime;
            if (howl.playing() && delta > 1000) {
              dispatch(updatePlayback(Math.floor(howl.seek())));
              prevTime = time;
            }
          }
          animationRef.current = requestAnimationFrame(animatePlayback);
        });

        howl.on("error", error);

        if (!howl.valid()) {
          error();
        }
      } catch {
        error();
      }
    },
    [onError, muted, store, cancelSoftStop]
  );

  // Start the audio output early so it's already running when the first track plays
  useEffect(() => {
    startOutput();
  }, []);

  // Keep the current track's gain in sync with the balancer and track settings
  useEffect(() => {
    return store.subscribe(() => {
      const output = outputRef.current;
      const state = store.getState();
      // Skip deleted tracks so their gain doesn't jump while fading out
      const track = output && state.playlists.tracks[output.trackId];
      if (track) {
        output.setGain(getTrackGain(track, state.balancer));
      }
    });
  }, [store]);

  // Cross fade to the selected layer of a dynamic track
  useEffect(() => {
    trackRef.current?.setLayer(layer);
  }, [layer]);

  const seek = useCallback((to: number) => {
    dispatch(updatePlayback(to));
    trackRef.current?.seek(to);
  }, []);

  const stop = useCallback(() => {
    const wasSoftStopping = cancelSoftStop();
    dispatch(playPause(false));
    dispatch(updatePlayback(0));
    const track = trackRef.current;
    if (track) {
      track.stop();
      // Restore the volume lowered by the soft stop fade so the track can be played again
      if (wasSoftStopping) {
        track.volume(store.getState().playlistPlayback.volume);
      }
    }
  }, [cancelSoftStop, store]);

  /** Fade out the current track before stopping it */
  const softStop = useCallback(() => {
    const track = trackRef.current;
    if (!track || softStopRef.current !== null) {
      return;
    }
    if (!track.playing()) {
      stop();
      return;
    }
    track.fade(track.volume(), 0, SOFT_STOP_FADE_DURATION);
    softStopRef.current = window.setTimeout(stop, SOFT_STOP_FADE_DURATION);
  }, [stop]);

  const next = useCallback(() => {
    if (!trackRef.current) {
      return;
    }
    if (!queue) {
      stop();
    } else if (repeat === "track") {
      seek(0);
    } else {
      let index = queue.current + 1;

      if (index >= queue.tracks.length) {
        // Repeat off just stop the playback
        if (repeat === "off") {
          stop();
          return;
        }
        index = 0;
      }

      let id: string;
      if (shuffle) {
        id = queue.tracks[queue.shuffled[index]];
      } else {
        id = queue.tracks[index];
      }
      if (id) {
        if (id === playbackTrack?.id) {
          // Playing the same track just restart it
          seek(0);
        } else {
          // Play the previous track
          const previousTrack = playlists.tracks[id];
          if (previousTrack) {
            play(previousTrack);
            dispatch(updateQueue(index));
          }
        }
      }
    }
  }, [repeat, queue, shuffle, playbackTrack, playlists, seek, play, stop]);

  const previous = useCallback(() => {
    if (!trackRef.current) {
      return;
    }
    if (!queue) {
      stop();
    } else if (repeat === "track") {
      seek(0);
    } else {
      let index = queue.current;
      // Only go to previous if at the start of the track
      if (trackRef.current.seek() < 5) {
        index -= 1;
      }
      if (index < 0) {
        // Start of playlist with repeat off just stop the track
        if (repeat === "off") {
          stop();
          return;
        }
        index = queue.tracks.length - 1;
      }
      let id: string;
      if (shuffle) {
        id = queue.tracks[queue.shuffled[index]];
      } else {
        id = queue.tracks[index];
      }
      if (id) {
        if (id === playbackTrack?.id) {
          // Playing the same track just restart it
          seek(0);
        } else {
          // Play the next track
          const nextTrack = playlists.tracks[id];
          if (nextTrack) {
            play(nextTrack);
            dispatch(updateQueue(index));
          }
        }
      }
    }
  }, [repeat, queue, shuffle, playbackTrack, playlists, seek, play, stop]);

  useEffect(() => {
    const track = trackRef.current;
    // Move to next song or repeat this song on track end
    function handleEnd() {
      // Don't move on to the next track if the track ended while soft stopping
      if (!queue || softStopRef.current !== null) {
        stop();
      } else if (repeat === "track") {
        seek(0);
        track?.play();
      } else {
        let index = queue.current + 1;
        if (index >= queue.tracks.length) {
          // Repeat off just stop the playback
          if (repeat === "off") {
            stop();
            return;
          }
          index = 0;
        }
        let id: string;
        if (shuffle) {
          id = queue.tracks[queue.shuffled[index]];
        } else {
          id = queue.tracks[index];
        }
        if (id) {
          if (id === playbackTrack?.id) {
            // Playing the same track just restart it
            seek(0);
            track?.play();
          } else {
            // Play the next track
            const nextTrack = playlists.tracks[id];
            if (nextTrack) {
              play(nextTrack);
              dispatch(updateQueue(index));
            }
          }
        }
      }
    }
    track?.on("end", handleEnd);
    return () => {
      track?.off("end", handleEnd);
    };
  }, [repeat, queue, shuffle, playbackTrack, playlists, play, seek, stop]);

  // Howler snaps an interrupted fade to its end volume (silent for a soft stop)
  // so pausing, muting or changing volume during a soft stop needs extra handling

  const pauseResume = useCallback(
    (resume: boolean) => {
      if (trackRef.current) {
        if (resume) {
          trackRef.current.play();
        } else if (softStopRef.current !== null) {
          // Pausing during a soft stop finishes the stop early
          stop();
        } else {
          trackRef.current.pause();
        }
      }
    },
    [stop]
  );

  const mute = useCallback(
    (muted: boolean) => {
      if (trackRef.current) {
        trackRef.current.mute(muted);
        // Muting during a soft stop finishes the stop early
        if (softStopRef.current !== null) {
          stop();
        }
      }
    },
    [stop]
  );

  const volume = useCallback(
    (volume: number) => {
      if (trackRef.current) {
        // Changing the volume during a soft stop cancels it.
        // The first call stops the fade and the second call overrides the volume it snapped to
        if (cancelSoftStop()) {
          trackRef.current.volume(volume);
        }
        trackRef.current.volume(volume);
      }
    },
    [cancelSoftStop]
  );

  return {
    seek,
    play,
    next,
    previous,
    stop,
    softStop,
    pauseResume,
    mute,
    volume,
  };
}
