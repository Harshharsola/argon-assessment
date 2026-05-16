#!/usr/bin/env node
/**
 * Load test — submits N images concurrently and reports throughput + latency.
 * After uploads complete, polls a sample to verify pipeline completion.
 *
 * Usage:
 *   node load-test.js                          # 100 uploads, synthetic JPEG
 *   node load-test.js --image /path/photo.jpg  # single image, repeated N times
 *   node load-test.js --folder /path/to/imgs   # cycle through all images in folder
 *   node load-test.js --count 200              # override total upload count
 *   node load-test.js --concurrency 30
 *   node load-test.js --poll-timeout 30        # seconds to wait for pipeline
 *
 * Requirements: Node >= 18 (uses built-in fetch + FormData).
 * No npm packages needed.
 */

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const { values: args } = parseArgs({
  options: {
    count:          { type: 'string', default: '100'  },
    concurrency:    { type: 'string', default: '20'   },
    image:          { type: 'string', default: ''     },
    folder:         { type: 'string', default: ''     },
    url:            { type: 'string', default: 'http://localhost:3001' },
    'poll-timeout': { type: 'string', default: '15'   },
  },
  strict: false,
});

const TOTAL         = parseInt(args.count);
const CONCURRENCY   = parseInt(args.concurrency);
const BASE_URL      = args.url;
const POLL_TIMEOUT  = parseInt(args['poll-timeout']) * 1000;

// Generate a tiny valid JPEG in-memory if no image path provided.
// This is a 2×2 red JPEG (~600 bytes) — fast to upload, passes format check,
// but will likely fail face detection (intentional for throughput testing).
// Pass a real headshot with --image for full end-to-end pipeline testing.
function makeMinimalJpeg() {
  return Buffer.from(
    'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909' +
    '08080a0a090a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c' +
    '2837292c30313434341f27393d38323c2e333432ffc0000b08000200020101110003ffc40' +
    '01f0000010501010101010100000000000000000102030405060708090a0bffda00080101' +
    '0003f0007c80ffda0008010100013f007c80ffda000801010003f0007c80ffd9',
    'hex',
  );
}

async function uploadOne(index, imageBuffer, filename) {
  const form = new FormData();
  // Append unique filename to avoid similarity rejection
  const uniqueName = `${index}_${filename}`;
  const blob = new Blob([imageBuffer], { type: 'image/jpeg' });
  form.append('image', blob, uniqueName);

  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/images/upload`, {
      method: 'POST',
      body: form,
    });
    const latency = Date.now() - start;
    const body = await res.json().catch(() => ({}));
    return { index, status: res.status, latency, ok: res.status === 202, id: body.id };
  } catch (err) {
    const latency = Date.now() - start;
    return { index, status: 0, latency, ok: false, error: err.message };
  }
}

async function runWithConcurrency(tasks, concurrency) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  });
  await Promise.all(workers);
  return results;
}

/** Poll images until they reach a terminal state or timeout */
async function pollForCompletion(ids, timeoutMs) {
  const pending = new Set(ids);
  const results = {};
  const start = Date.now();

  while (pending.size > 0 && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));

    for (const id of [...pending]) {
      try {
        const res = await fetch(`${BASE_URL}/api/images/${id}/status`);
        const data = await res.json();
        if (data.status !== 'PROCESSING') {
          pending.delete(id);
          results[id] = data;
        }
      } catch {
        // ignore poll errors, retry next cycle
      }
    }
  }

  // Record remaining as timeout
  for (const id of pending) {
    results[id] = { status: 'TIMEOUT', processingStage: 'unknown' };
  }

  return results;
}

/** Load all images from a folder (jpeg/jpg/png only), return array of {buffer, filename} */
function loadFolder(folderPath) {
  const SUPPORTED = /\.(jpe?g|png|heic|heif)$/i;
  const files = fs.readdirSync(folderPath).filter((f) => SUPPORTED.test(f));
  if (files.length === 0) throw new Error(`No supported images found in ${folderPath}`);
  return files.map((f) => ({
    buffer: fs.readFileSync(path.join(folderPath, f)),
    filename: f,
  }));
}

async function main() {
  // Build the image pool — folder > single image > synthetic
  let imagePool; // Array of { buffer, filename }

  if (args.folder) {
    imagePool = loadFolder(path.resolve(args.folder));
    console.log(`Using folder: ${args.folder} (${imagePool.length} images found)`);
  } else if (args.image) {
    const buffer = fs.readFileSync(path.resolve(args.image));
    imagePool = [{ buffer, filename: path.basename(args.image) }];
    console.log(`Using image: ${args.image} (${buffer.length} bytes)`);
  } else {
    imagePool = [{ buffer: makeMinimalJpeg(), filename: 'test.jpg' }];
    console.log('No --image or --folder provided; using synthetic minimal JPEG');
    console.log('  (Tip: use --folder /path/to/images for full pipeline testing)');
  }

  // If folder has fewer images than TOTAL, cycle through them
  const totalToUpload = args.folder
    ? imagePool.length                  // upload each image exactly once
    : TOTAL;                            // repeat single image N times

  console.log(`\nLoad test: ${totalToUpload} uploads, concurrency=${CONCURRENCY}, target=${BASE_URL}\n`);

  const tasks = Array.from({ length: totalToUpload }, (_, i) => {
    const { buffer, filename } = imagePool[i % imagePool.length];
    return () => uploadOne(i, buffer, filename);
  });

  const wallStart = Date.now();
  const results = await runWithConcurrency(tasks, Math.min(CONCURRENCY, tasks.length));
  const wallMs = Date.now() - wallStart;

  const successful = results.filter((r) => r.ok);
  const failed     = results.filter((r) => !r.ok);
  const latencies  = results.map((r) => r.latency).sort((a, b) => a - b);
  const total      = results.length;

  const p50 = latencies[Math.floor(latencies.length * 0.50)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

  console.log('── Upload Results ────────────────────────────────');
  console.log(`Total requests : ${total}`);
  console.log(`Successful 202 : ${successful.length}`);
  console.log(`Failed         : ${failed.length}`);
  console.log(`Wall time      : ${wallMs}ms`);
  console.log(`Throughput     : ${(total / (wallMs / 1000)).toFixed(1)} req/s`);
  console.log(`Latency avg    : ${avg}ms`);
  console.log(`Latency p50    : ${p50}ms`);
  console.log(`Latency p95    : ${p95}ms`);
  console.log(`Latency p99    : ${p99}ms`);

  if (failed.length > 0) {
    console.log('\nFailed requests (first 5):');
    failed.slice(0, 5).forEach((r) => {
      console.log(`  #${r.index} → HTTP ${r.status} ${r.error ?? ''}`);
    });
  }

  // Poll a sample of successful uploads to verify pipeline completion
  const sampleIds = successful.slice(0, 10).map((r) => r.id).filter(Boolean);
  if (sampleIds.length > 0) {
    console.log(`\n── Pipeline Completion ───────────────────────────`);
    console.log(`Polling ${sampleIds.length} sample images (timeout=${POLL_TIMEOUT / 1000}s)...`);

    const pipelineResults = await pollForCompletion(sampleIds, POLL_TIMEOUT);
    const counts = { ACCEPTED: 0, REJECTED: 0, TIMEOUT: 0 };

    for (const [id, result] of Object.entries(pipelineResults)) {
      const r = result;
      const status = r.status;
      counts[status] = (counts[status] || 0) + 1;
      console.log(`  ${id} → status=${status} stage=${r.processingStage ?? 'n/a'}`);
    }

    console.log(`\nPipeline summary:`);
    console.log(`  Accepted  : ${counts.ACCEPTED ?? 0}`);
    console.log(`  Rejected  : ${counts.REJECTED ?? 0}`);
    console.log(`  Timed out : ${counts.TIMEOUT ?? 0}`);

    // If any images were accepted, fetch their variants as proof
    const acceptedId = Object.entries(pipelineResults).find(([, r]) => r.status === 'ACCEPTED')?.[0];
    if (acceptedId) {
      try {
        const res = await fetch(`${BASE_URL}/api/images/${acceptedId}/variants`);
        const data = await res.json();
        console.log(`\nSample variant data for ${acceptedId}:`);
        console.log(`  Compression ratio: ${data.compressionRatio}×`);
        if (data.variants) {
          for (const [type, v] of Object.entries(data.variants)) {
            console.log(`  ${type}: ${v.widthPx}×${v.heightPx}px (${v.sizeBytes} bytes)`);
          }
        }
      } catch {
        // variant fetch failed, skip
      }
    }
  }
}

main().catch((err) => {
  console.error('Load test error:', err);
  process.exit(1);
});
