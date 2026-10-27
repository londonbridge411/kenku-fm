import React, { useEffect, useState } from "react";

import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../app/store";
import { removeLoudness, setLoudness } from "./balancerSlice";
import { measureLoudness } from "./loudness";
import { canAdjustGain } from "./TrackOutput";

/** Urls that failed to be measured this session so they aren't retried */
const failedUrls = new Set<string>();

/** Allow tracks that failed to be measured to be tried again */
export function resetFailedMeasurements() {
  failedUrls.clear();
}

/** Urls of local tracks that can be balanced */
export function getBalanceableUrls(tracks: RootState["playlists"]["tracks"]) {
  const urls = new Set<string>();
  for (const track of Object.values(tracks)) {
    if (canAdjustGain(track.url)) {
      urls.add(track.url);
    }
  }
  return urls;
}

// Measure the loudness of tracks in the background for the dB balancer
// This is done in a empty component to avoid re-rendering any children
export function PlaylistBalancer() {
  const enabled = useSelector((state: RootState) => state.balancer.enabled);
  const loudness = useSelector((state: RootState) => state.balancer.loudness);
  const tracks = useSelector((state: RootState) => state.playlists.tracks);
  const currentUrl = useSelector(
    (state: RootState) => state.playlistPlayback.track?.url
  );
  const dispatch = useDispatch();

  // Clearing this when a measurement finishes moves on to the next track
  const [measuring, setMeasuring] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || measuring) {
      return;
    }
    const pending = [...getBalanceableUrls(tracks)].filter(
      (url) => !(url in loudness) && !failedUrls.has(url)
    );
    if (pending.length === 0) {
      return;
    }
    // Measure the playing track first so it's balanced as soon as possible
    const url = pending.includes(currentUrl) ? currentUrl : pending[0];
    setMeasuring(url);
    measureLoudness(url)
      .then((value) => {
        if (value === null) {
          failedUrls.add(url);
        } else {
          dispatch(setLoudness({ url, loudness: value }));
        }
      })
      .catch(() => {
        failedUrls.add(url);
      })
      .finally(() => {
        setMeasuring(null);
      });
  }, [enabled, measuring, tracks, loudness, currentUrl]);

  // Remove measurements for tracks that no longer exist
  useEffect(() => {
    const urls = new Set(Object.values(tracks).map((track) => track.url));
    const stale = Object.keys(loudness).filter((url) => !urls.has(url));
    if (stale.length > 0) {
      dispatch(removeLoudness(stale));
    }
  }, [tracks, loudness]);

  return <></>;
}
