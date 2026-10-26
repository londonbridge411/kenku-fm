/**
 * Integrated loudness measurement following ITU-R BS.1770 (LUFS)
 * Used by the dB balancer to work out how much gain each track needs
 */

/** Sample rate used to decode audio for analysis, lower than playback to save memory */
const ANALYSIS_SAMPLE_RATE = 22050;
/** Largest file in bytes that will be analysed to avoid running out of memory while decoding */
const MAX_ANALYSIS_FILE_SIZE = 250 * 1024 * 1024;

/** Biquad coefficients [b0, b1, b2, a1, a2] normalised so a0 is 1 */
type Biquad = [number, number, number, number, number];

/**
 * K-weighting filter coefficients for any sample rate
 * Derived from the BS.1770 48kHz filters (same approach as libebur128)
 */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf modelling the acoustic effect of the head
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = [
    (Vh + (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  ];

  // Stage 2: high pass (RLB weighting)
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highPass: Biquad = [
    1,
    -2,
    1,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  ];

  return [shelf, highPass];
}

function blockLoudness(meanSquare: number) {
  return -0.691 + 10 * Math.log10(meanSquare);
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Give the event loop a chance to run so long tracks don't freeze the UI */
function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Calculate the gated integrated loudness of the channels in LUFS
 * @returns The loudness or null if the audio is too short or silent
 */
export async function integratedLoudness(
  channels: Float32Array[],
  sampleRate: number
): Promise<number | null> {
  // Gating blocks are 400ms with a 75% overlap so measure power in 100ms steps
  const step = Math.round(sampleRate * 0.1);
  const length = channels[0]?.length || 0;
  const steps = Math.floor(length / step);
  if (steps < 4) {
    return null;
  }

  const [shelf, highPass] = kWeighting(sampleRate);
  const [sb0, sb1, sb2, sa1, sa2] = shelf;
  const [hb0, hb1, hb2, ha1, ha2] = highPass;

  // Sum of squared K-weighted samples for each step across all channels
  const power = new Float64Array(steps);
  for (const data of channels) {
    // Transposed direct form II filter state
    let s1 = 0;
    let s2 = 0;
    let h1 = 0;
    let h2 = 0;
    for (let i = 0; i < steps; i++) {
      let sum = 0;
      const end = (i + 1) * step;
      for (let j = i * step; j < end; j++) {
        const x = data[j];
        const y = sb0 * x + s1;
        s1 = sb1 * x - sa1 * y + s2;
        s2 = sb2 * x - sa2 * y;
        const z = hb0 * y + h1;
        h1 = hb1 * y - ha1 * z + h2;
        h2 = hb2 * y - ha2 * z;
        sum += z * z;
      }
      power[i] += sum;
      // Yield every minute of audio
      if (i % 600 === 599) {
        await yieldToEventLoop();
      }
    }
  }

  const blocks: number[] = [];
  for (let i = 0; i + 3 < steps; i++) {
    blocks.push(
      (power[i] + power[i + 1] + power[i + 2] + power[i + 3]) / (4 * step)
    );
  }

  // Absolute gate removes silence
  const absoluteGated = blocks.filter((z) => blockLoudness(z) > -70);
  if (absoluteGated.length === 0) {
    return null;
  }
  // Relative gate removes quiet sections so they don't drag the measurement down
  const relativeThreshold = blockLoudness(mean(absoluteGated)) - 10;
  const relativeGated = absoluteGated.filter(
    (z) => blockLoudness(z) > relativeThreshold
  );
  if (relativeGated.length === 0) {
    return null;
  }

  return blockLoudness(mean(relativeGated));
}

/**
 * Load and measure the integrated loudness of an audio file
 * @returns The loudness in LUFS or null if it could not be measured
 */
export async function measureLoudness(url: string): Promise<number | null> {
  const response = await fetch(url);
  const data = await response.arrayBuffer();
  if (data.byteLength === 0 || data.byteLength > MAX_ANALYSIS_FILE_SIZE) {
    return null;
  }
  // Decoding with an offline context resamples to the lower analysis rate
  const context = new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE);
  const buffer = await context.decodeAudioData(data);
  const channels: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }
  return integratedLoudness(channels, buffer.sampleRate);
}
