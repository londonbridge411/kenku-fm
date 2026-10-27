import React, { useState } from "react";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import PlayArrow from "@mui/icons-material/PlayArrowRounded";
import Pause from "@mui/icons-material/PauseRounded";
import LayersIcon from "@mui/icons-material/LayersRounded";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";

import MoreVert from "@mui/icons-material/MoreVertRounded";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListSubheader from "@mui/material/ListSubheader";

import { Track, removeTrack, Playlist } from "./playlistsSlice";
import { useDispatch, useSelector } from "react-redux";
import { TrackSettings } from "./TrackSettings";
import {
  getPlayableLayers,
  getTrackLayers,
  isDynamicTrack,
} from "./trackLayers";
import { RootState } from "../../app/store";
import {
  playPause,
  removeTrackFromQueue,
  startQueue,
  stopTrack,
  updatePlayback,
} from "./playlistPlaybackSlice";

type TrackItemProps = {
  track: Track;
  playlist: Playlist;
  onPlay: (id: string, layer?: string) => void;
};

export function TrackItem({ track, playlist, onPlay }: TrackItemProps) {
  const isCurrentTrack = useSelector(
    (state: RootState) => state.playlistPlayback.track?.id === track.id,
  );
  const playing = useSelector(
    (state: RootState) => state.playlistPlayback.playing && isCurrentTrack,
  );
  const dispatch = useDispatch();

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);
  function handleMenuClick(event: React.MouseEvent<HTMLButtonElement>) {
    setAnchorEl(event.currentTarget);
  }
  function handleMenuClose() {
    setAnchorEl(null);
  }

  function handleEdit() {
    setSettingsOpen(true);
    handleMenuClose();
  }

  function handleCopyID() {
    navigator.clipboard.writeText(track.id);
    handleMenuClose();
  }

  function handleDelete() {
    // TODO: Fix bug where playback does not update to zero when isCurrentTrack is removed
    if (isCurrentTrack) {
      dispatch(playPause(false));
      dispatch(stopTrack());
    }
    dispatch(removeTrack({ trackId: track.id, playlistId: playlist.id }));
    dispatch(
      removeTrackFromQueue({ trackId: track.id, playlistId: playlist.id }),
    );
    handleMenuClose();
  }

  // Layer picker shown when starting a dynamic track
  const [layerAnchorEl, setLayerAnchorEl] = useState<null | HTMLElement>(null);
  const playableLayers = getPlayableLayers(track);

  function handlePlayPause(event: React.MouseEvent<HTMLButtonElement>) {
    if (isCurrentTrack) {
      dispatch(playPause(!playing));
    } else if (playableLayers.length > 1) {
      setLayerAnchorEl(event.currentTarget);
    } else {
      onPlay(track.id);
    }
  }

  function handleLayerPlay(layer: string) {
    setLayerAnchorEl(null);
    onPlay(track.id, layer);
  }

  return (
    <ListItem key={track.id} disablePadding>
      <Paper
        sx={{
          minWidth: 0,
          width: "100%",
          m: 0.5,
          backgroundColor: "rgba(34, 38, 57, 0.8)",
        }}
      >
        <ListItemButton
          role={undefined}
          sx={{ m: 0, borderRadius: "16px" }}
          dense
          selected={isCurrentTrack}
        >
          <ListItemText
            primary={track.title}
            sx={{
              ".MuiListItemText-primary": {
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
            }}
            primaryTypographyProps={{
              typography: "body1",
            }}
          />
          {isDynamicTrack(track) && (
            <Tooltip title={`Dynamic track (${getTrackLayers(track).length} layers)`}>
              <LayersIcon
                fontSize="small"
                sx={{ mx: 1, color: "rgba(255,255,255,0.6)" }}
              />
            </Tooltip>
          )}
          <IconButton
            aria-label={playing ? "pause" : "play"}
            onClick={handlePlayPause}
          >
            {playing ? <Pause /> : <PlayArrow />}
          </IconButton>
          <IconButton onClick={handleMenuClick}>
            <MoreVert />
          </IconButton>
        </ListItemButton>
      </Paper>
      <Menu
        id="playlist-menu"
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        slotProps={{ list: { "aria-labelledby": "more-button" } }}
      >
        <MenuItem onClick={handleEdit}>Edit</MenuItem>
        <MenuItem onClick={handleCopyID}>Copy ID</MenuItem>
        <MenuItem onClick={handleDelete}>Delete</MenuItem>
      </Menu>
      <Menu
        anchorEl={layerAnchorEl}
        open={Boolean(layerAnchorEl)}
        onClose={() => setLayerAnchorEl(null)}
      >
        <ListSubheader sx={{ lineHeight: "36px", bgcolor: "transparent" }}>
          Start on layer
        </ListSubheader>
        {playableLayers.map((layer) => (
          <MenuItem key={layer.id} onClick={() => handleLayerPlay(layer.id)}>
            {layer.title}
          </MenuItem>
        ))}
      </Menu>
      <TrackSettings
        track={track}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </ListItem>
  );
}
