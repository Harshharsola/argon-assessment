// Use the WASM build — no native tfjs-node compilation required
// eslint-disable-next-line @typescript-eslint/no-require-imports
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js') as typeof import('@vladmandic/face-api');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tf = require('@tensorflow/tfjs') as typeof import('@tensorflow/tfjs');
import { Canvas, Image, ImageData, createCanvas, loadImage } from 'canvas';
import * as path from 'path';

// Patch face-api to use node-canvas environment
faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as unknown as faceapi.Environment);

const MODEL_DIR = path.resolve(__dirname, '../../models');

/** Minimum face area as a fraction of total image area */
const MIN_FACE_AREA_RATIO = 0.03; // 3%

let modelsLoaded = false;

/**
 * Lazily load the SSD MobileNet face detector model once.
 * Subsequent calls are no-ops.
 */
async function ensureModelsLoaded(): Promise<void> {
  if (modelsLoaded) return;
  await tf.ready(); // wait for WASM backend to initialise
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODEL_DIR);
  modelsLoaded = true;
}

export interface FaceValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Detect faces in an image buffer and validate:
 * - Exactly 1 face must be present
 * - The face must be large enough relative to the image
 */
export async function validateFaces(buffer: Buffer): Promise<FaceValidationResult> {
  await ensureModelsLoaded();

  const img = await loadImage(buffer);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const detections = await faceapi.detectAllFaces(
    canvas as unknown as HTMLCanvasElement,
    new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 })
  );

  if (detections.length === 0) {
    return { valid: false, reason: 'No face detected in the image' };
  }

  if (detections.length > 1) {
    return {
      valid: false,
      reason: `Multiple faces detected (found ${detections.length}). Only single-face images are allowed.`,
    };
  }

  // Check face size relative to image
  const face = detections[0]!;
  const faceArea = face.box.width * face.box.height;
  const imageArea = img.width * img.height;
  const ratio = faceArea / imageArea;

  if (ratio < MIN_FACE_AREA_RATIO) {
    return {
      valid: false,
      reason: `Face is too small (${(ratio * 100).toFixed(1)}% of image). Minimum ${(MIN_FACE_AREA_RATIO * 100).toFixed(0)}% required.`,
    };
  }

  return { valid: true };
}

export { MIN_FACE_AREA_RATIO };
