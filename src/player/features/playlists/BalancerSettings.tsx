import React from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";

import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../app/store";
import {
  clearLoudness,
  enableBalancer,
  setBalancerTarget,
} from "./balancerSlice";
import { getBalanceableUrls, resetFailedMeasurements } from "./PlaylistBalancer";

type BalancerSettingsProps = {
  open: boolean;
  onClose: () => void;
};

export function BalancerSettings({ open, onClose }: BalancerSettingsProps) {
  const dispatch = useDispatch();
  const balancer = useSelector((state: RootState) => state.balancer);
  const tracks = useSelector((state: RootState) => state.playlists.tracks);

  const urls = getBalanceableUrls(tracks);
  const measured = [...urls].filter((url) => url in balancer.loudness).length;

  function handleRemeasure() {
    resetFailedMeasurements();
    dispatch(clearLoudness());
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>dB Balancer</DialogTitle>
      <DialogContent>
        <DialogContentText variant="body2" sx={{ mb: 2 }}>
          Raises or lowers each playlist track so they all play at the same
          loudness. Only local files can be balanced.
        </DialogContentText>
        <FormControlLabel
          control={
            <Switch
              checked={balancer.enabled}
              onChange={(_, checked) => dispatch(enableBalancer(checked))}
            />
          }
          label="Enabled"
        />
        <Typography variant="body2" sx={{ mt: 2 }}>
          Target loudness: {balancer.target} dB (LUFS)
        </Typography>
        <Slider
          aria-label="Target loudness"
          value={balancer.target}
          min={-30}
          max={-6}
          step={1}
          marks={[
            { value: -30, label: "-30" },
            { value: -18, label: "-18" },
            { value: -6, label: "-6" },
          ]}
          disabled={!balancer.enabled}
          onChange={(_, value) => dispatch(setBalancerTarget(value as number))}
        />
        <Typography variant="caption" color="text.secondary" component="p">
          {balancer.enabled
            ? `Measured ${measured} of ${urls.size} local tracks`
            : `Measured ${measured} of ${urls.size} local tracks, enable to measure the rest`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleRemeasure} disabled={urls.size === 0}>
          Re-measure All
        </Button>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
