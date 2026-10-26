import { createSlice, PayloadAction } from "@reduxjs/toolkit";

import { Track } from "./playlistsSlice";
import { MAX_TRACK_GAIN, MIN_TRACK_GAIN } from "./TrackOutput";

export interface BalancerState {
  enabled: boolean;
  /** Loudness every track is balanced towards in LUFS */
  target: number;
  /** Measured integrated loudness in LUFS keyed by track url */
  loudness: Record<string, number>;
}

const initialState: BalancerState = {
  enabled: false,
  target: -18,
  loudness: {},
};

export const balancerSlice = createSlice({
  name: "balancer",
  initialState,
  reducers: {
    enableBalancer: (state, action: PayloadAction<boolean>) => {
      state.enabled = action.payload;
    },
    setBalancerTarget: (state, action: PayloadAction<number>) => {
      state.target = action.payload;
    },
    setLoudness: (
      state,
      action: PayloadAction<{ url: string; loudness: number }>
    ) => {
      state.loudness[action.payload.url] = action.payload.loudness;
    },
    removeLoudness: (state, action: PayloadAction<string[]>) => {
      for (const url of action.payload) {
        delete state.loudness[url];
      }
    },
    clearLoudness: (state) => {
      state.loudness = {};
    },
  },
});

/** Total gain in dB to apply to a track from the balancer and its own offset */
export function getTrackGain(
  track: Track | undefined,
  balancer: BalancerState
): number {
  if (!track) {
    return 0;
  }
  let gain = track.gain || 0;
  if (balancer.enabled) {
    const loudness = balancer.loudness[track.url];
    if (loudness !== undefined) {
      gain += balancer.target - loudness;
    }
  }
  return Math.min(Math.max(gain, MIN_TRACK_GAIN), MAX_TRACK_GAIN);
}

export const {
  enableBalancer,
  setBalancerTarget,
  setLoudness,
  removeLoudness,
  clearLoudness,
} = balancerSlice.actions;

export default balancerSlice.reducer;
