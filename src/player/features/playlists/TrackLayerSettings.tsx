import React, { useCallback } from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import Add from "@mui/icons-material/AddRounded";
import Delete from "@mui/icons-material/DeleteRounded";
import FolderOpen from "@mui/icons-material/FolderOpenRounded";

import { v4 as uuid } from "uuid";

import { useDispatch } from "react-redux";
import { editTrack, Track, TrackLayer } from "./playlistsSlice";
import { getDropURL, encodeFilePath } from "../../../renderer/common/drop";
import useFileDrop, { FileInfo } from "../../common/useFileDrop";
import { canAdjustGain } from "./TrackOutput";

type LayerItemProps = {
  layer: TrackLayer;
  onChange: (layer: TrackLayer) => void;
  onRemove: () => void;
};

function LayerItem({ layer, onChange, onRemove }: LayerItemProps) {
  const onDrop = useCallback(
    (files: FileInfo[]) => {
      const file = files[0];
      if (file) {
        onChange({ ...layer, url: encodeFilePath(file.path) });
      }
    },
    [layer, onChange]
  );

  const { rootProps, inputProps } = useFileDrop({
    onDrop,
    accept: "audio/*",
    multiple: false,
  });

  function handleURLDrop(event: React.DragEvent<HTMLInputElement>) {
    event.preventDefault();
    const url = getDropURL(event.dataTransfer);
    if (url) {
      onChange({ ...layer, url });
    }
  }

  return (
    <Stack direction="row" spacing={1} alignItems="flex-end">
      <TextField
        margin="dense"
        label="Layer Name"
        variant="standard"
        autoComplete="off"
        InputLabelProps={{
          shrink: true,
        }}
        sx={{ width: "35%", flexShrink: 0 }}
        value={layer.title}
        onChange={(event) => onChange({ ...layer, title: event.target.value })}
      />
      <TextField
        margin="dense"
        label="Source"
        placeholder="Enter a URL or browse for a track"
        variant="standard"
        autoComplete="off"
        fullWidth
        InputLabelProps={{
          shrink: true,
        }}
        value={layer.url}
        onChange={(event) => onChange({ ...layer, url: event.target.value })}
        onDrop={handleURLDrop}
      />
      <Tooltip title="Browse">
        <IconButton aria-label="browse" {...rootProps}>
          <FolderOpen />
        </IconButton>
      </Tooltip>
      <input {...inputProps} />
      <Tooltip title="Remove Layer">
        <IconButton aria-label="remove layer" onClick={onRemove}>
          <Delete />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

type TrackLayerSettingsProps = {
  track: Track;
};

/** Editor for the layers of a dynamic track */
export function TrackLayerSettings({ track }: TrackLayerSettingsProps) {
  const dispatch = useDispatch();
  const layers = track.layers || [];

  function updateLayers(layers: TrackLayer[]) {
    dispatch(
      editTrack({
        id: track.id,
        layers: layers.length > 0 ? layers : undefined,
      })
    );
  }

  function handleAdd() {
    updateLayers([
      ...layers,
      { id: uuid(), title: `Layer ${layers.length + 2}`, url: "" },
    ]);
  }

  const handleLayerChange = useCallback(
    (layer: TrackLayer) => {
      updateLayers(layers.map((l) => (l.id === layer.id ? layer : l)));
    },
    [layers]
  );

  const remote = [track.url, ...layers.map((layer) => layer.url)].some(
    (url) => url && !canAdjustGain(url)
  );

  return (
    <>
      <Typography variant="body2" sx={{ mt: 2 }}>
        Layers
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p">
        Layers play in sync with the main source. While the track plays you
        can cross fade between them from the player. Use versions of the same
        music that are the same length.
      </Typography>
      {layers.length > 0 && (
        <TextField
          margin="dense"
          label="Main Layer Name"
          placeholder="Main"
          fullWidth
          variant="standard"
          autoComplete="off"
          InputLabelProps={{
            shrink: true,
          }}
          value={track.layerTitle || ""}
          onChange={(event) =>
            dispatch(
              editTrack({
                id: track.id,
                layerTitle: event.target.value || undefined,
              })
            )
          }
        />
      )}
      {layers.map((layer) => (
        <LayerItem
          key={layer.id}
          layer={layer}
          onChange={handleLayerChange}
          onRemove={() =>
            updateLayers(layers.filter((l) => l.id !== layer.id))
          }
        />
      ))}
      {layers.length > 0 && remote && (
        <Typography variant="caption" color="warning.main" component="p">
          Layers only work with local files, only the main source will play
        </Typography>
      )}
      <Button startIcon={<Add />} onClick={handleAdd} sx={{ mt: 1 }}>
        Add Layer
      </Button>
    </>
  );
}
