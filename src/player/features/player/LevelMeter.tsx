import React, { useEffect, useRef } from "react";
import Box from "@mui/material/Box";

import { getOutputMeter } from "../playlists/TrackOutput";

/** Lowest level shown on the meter in dBFS */
const MIN_DB = -48;
/** How fast the bars fall in dB per second */
const FALL_RATE = 24;
/** How long the peak marker holds before falling in ms */
const PEAK_HOLD = 1000;

const HEIGHT = 10;
const BAR_HEIGHT = 4;

function toDb(value: number) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

/** Position along the meter from 0 to 1 for a level in dBFS */
function toPosition(db: number) {
  return Math.min(Math.max((db - MIN_DB) / -MIN_DB, 0), 1);
}

/**
 * Stereo peak meter of the playlist output.
 * Only local tracks are routed through web audio so remote tracks won't show.
 */
export function LevelMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const levels = [MIN_DB, MIN_DB];
    const peaks = [MIN_DB, MIN_DB];
    const peakTimes = [0, 0];
    let samples: Float32Array<ArrayBuffer> | null = null;
    let prevTime = performance.now();
    let frame: number;

    function draw(time: number) {
      frame = requestAnimationFrame(draw);
      const delta = (time - prevTime) / 1000;
      prevTime = time;

      // Match the canvas to its displayed size so the bars stay sharp
      const scale = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * scale);
      const height = Math.round(HEIGHT * scale);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const meter = getOutputMeter();
      for (let channel = 0; channel < 2; channel++) {
        let db = MIN_DB;
        const analyser = meter?.[channel];
        if (analyser) {
          if (!samples || samples.length !== analyser.fftSize) {
            samples = new Float32Array(analyser.fftSize);
          }
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          for (const sample of samples) {
            peak = Math.max(peak, Math.abs(sample));
          }
          db = toDb(peak);
        }
        // Jump up instantly and fall smoothly
        levels[channel] = Math.max(db, levels[channel] - FALL_RATE * delta);
        if (levels[channel] >= peaks[channel]) {
          peaks[channel] = levels[channel];
          peakTimes[channel] = time;
        } else if (time - peakTimes[channel] > PEAK_HOLD) {
          peaks[channel] = Math.max(
            levels[channel],
            peaks[channel] - FALL_RATE * delta
          );
        }
      }

      ctx.clearRect(0, 0, width, height);
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, "#4caf50");
      gradient.addColorStop(toPosition(-12), "#8bc34a");
      gradient.addColorStop(toPosition(-6), "#ffeb3b");
      gradient.addColorStop(toPosition(-2), "#ff9800");
      gradient.addColorStop(1, "#f44336");
      const barHeight = BAR_HEIGHT * scale;
      const gap = height - barHeight * 2;
      for (let channel = 0; channel < 2; channel++) {
        const y = channel * (barHeight + gap);
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.fillRect(0, y, width, barHeight);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, y, width * toPosition(levels[channel]), barHeight);
        if (peaks[channel] > MIN_DB) {
          const x = Math.min(
            width * toPosition(peaks[channel]),
            width - 2 * scale
          );
          ctx.fillRect(x, y, 2 * scale, barHeight);
        }
      }
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      aria-hidden
      sx={{ display: "block", width: "100%", height: `${HEIGHT}px` }}
    />
  );
}
