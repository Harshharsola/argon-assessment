/**
 * BullMQ queue definitions + shared Redis connection config.
 *
 * One Queue instance per pipeline stage. Workers import these same
 * Queue objects to add jobs; Worker instances subscribe to the same
 * queue names to consume them.
 *
 * Scaling: run multiple Worker processes pointing at the same Redis —
 * BullMQ uses BRPOPLPUSH under the hood, so each job is claimed by
 * exactly one worker (no duplicate processing).
 *
 * Queues are lazily instantiated to avoid crashing the app on import
 * if Redis is not yet available.
 */

import { Queue } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';

export const redisConnection: ConnectionOptions = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
};

// ── Job data shapes ────────────────────────────────────────────────────────────

export interface ConversionJobData {
  imageId: string;
  stagingKey: string; // R2 key of original validated buffer
}

export interface CompressionJobData {
  imageId: string;
  convertedKey: string; // R2 key written by ConversionWorker
}

export interface VariantJobData {
  imageId: string;
  compressedKey: string; // R2 key written by CompressionWorker
}

// ── Shared default job options ─────────────────────────────────────────────────

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600 }, // keep completed jobs 1h for debugging
  removeOnFail: { age: 86400 },    // keep failed jobs 24h
};

// ── Lazy queue instances ───────────────────────────────────────────────────────
// Created on first access so a missing Redis won't crash on import.

let _conversionQueue: Queue<ConversionJobData> | null = null;
let _compressionQueue: Queue<CompressionJobData> | null = null;
let _variantQueue: Queue<VariantJobData> | null = null;

export function getConversionQueue(): Queue<ConversionJobData> {
  if (!_conversionQueue) {
    _conversionQueue = new Queue<ConversionJobData>('conversion', {
      connection: redisConnection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _conversionQueue;
}

export function getCompressionQueue(): Queue<CompressionJobData> {
  if (!_compressionQueue) {
    _compressionQueue = new Queue<CompressionJobData>('compression', {
      connection: redisConnection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _compressionQueue;
}

export function getVariantQueue(): Queue<VariantJobData> {
  if (!_variantQueue) {
    _variantQueue = new Queue<VariantJobData>('variant-generation', {
      connection: redisConnection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
  }
  return _variantQueue;
}

// Backward-compat named exports (lazy getters)
export const conversionQueue  = { add: (...args: Parameters<Queue<ConversionJobData>['add']>) => getConversionQueue().add(...args) };
export const compressionQueue = { add: (...args: Parameters<Queue<CompressionJobData>['add']>) => getCompressionQueue().add(...args) };
export const variantQueue     = { add: (...args: Parameters<Queue<VariantJobData>['add']>) => getVariantQueue().add(...args) };

/** Close all queue connections — call during graceful shutdown */
export async function closeAllQueues(): Promise<void> {
  await Promise.allSettled([
    _conversionQueue?.close(),
    _compressionQueue?.close(),
    _variantQueue?.close(),
  ]);
}
