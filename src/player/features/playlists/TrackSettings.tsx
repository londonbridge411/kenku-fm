import React from "react";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Slider from "@mui/material/Slider";
import Typography from "@mui/material/Typography";

import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../app/store";
import { editTrack, Track } from "./playlistsSlice";
import { AudioSelector } from "../../common/AudioSelector";
import { canAdjustGain } from "./TrackOutput";
import { TrackLayerSettings } from "./TrackLayerSettings";

type TrackSettingsProps = {
  track: Track;
  open: boolean;
  onClose: () => void;
};

export function TrackSettings({ track, open, onClose }: TrackSettingsProps) {
  const dispatch = useDispatch();
  const loudness = useSelector(
    (state: RootState) => state.balancer.loudness[track.url]
  );
  const gain = track.gain || 0;

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    dispatch(editTrack({ id: track.id, title: event.target.value }));
  }

  function handleTitleStringChange(title: string) {
    dispatch(editTrack({ id: track.id, title }));
  }

  function handleURLChange(url: string) {
    dispatch(editTrack({ id: track.id, url }));
  }

  function handleGainChange(_: Event, value: number | number[]) {
    dispatch(editTrack({ id: track.id, gain: value as number }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      // Stop key events from propagating to prevent the track drag and drop from stealing the space bar
      onKeyDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DialogTitle>Edit Track</DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent>
          <AudioSelector
            value={track.url}
            onChange={handleURLChange}
            onFileName={handleTitleStringChange}
          />
          <TextField
            margin="dense"
            id="name"
            label="Name"
            fullWidth
            variant="standard"
            autoComplete="off"
            InputLabelProps={{
              shrink: true,
            }}
            value={track.title}
            onChange={handleTitleChange}
          />
          <Typography variant="body2" sx={{ mt: 2 }}>
            Gain: {gain > 0 ? "+" : ""}
            {gain} dB
          </Typography>
          <Slider
            aria-label="Gain"
            value={gain}
            min={-12}
            max={12}
            step={0.5}
            marks={[{ value: 0 }]}
            disabled={!canAdjustGain(track.url)}
            onChange={handleGainChange}
          />
          <Typography variant="caption" color="text.secondary" component="p">
            {!canAdjustGain(track.url)
              ? "Only local files can have their gain adjusted"
              : loudness === undefined
              ? "Applied on top of the dB balancer. Not measured yet"
              : `Applied on top of the dB balancer. Measured loudness: ${loudness.toFixed(
                  1
                )} dB (LUFS)`}
          </Typography>
          <TrackLayerSettings track={track} />
        </DialogContent>
        <DialogActions>
          <Button type="submit">Done</Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
