# Argon Assessment — Image Upload, Validation & Processing Pipeline

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL running locally (or a connection string)
- Redis 6+ (for BullMQ job queues)
- Cloudflare R2 account (free) **or** AWS S3

---

### 1. Backend

```bash
cd backend
cp .env.example .env   # fill in DB, Redis, and S3/R2 credentials
npm install
npx prisma migrate dev --name pipeline
npm run dev
```

Server starts at `http://localhost:3001`. Workers start automatically in the same process.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

App opens at `http://localhost:5173`

### 3. Redis (required for pipeline)

```bash
# macOS
brew install redis && brew services start redis

# Docker
docker run -d -p 6379:6379 redis:7-alpine
```

---

## Architecture Overview

### Part 1 — Validation Pipeline (existing)
Upload → 6-stage validation (format → resolution → blur → face count → face size → pHash similarity) → if rejected, done. All validation runs synchronously before handing off to the processing pipeline.

### Part 2 — Processing Pipeline (new)

```
POST /upload
  └─ validateAndEnqueue()
       ├─ runs 6-stage validation (async, off request lifecycle)
       └─ on pass: uploads original to R2 staging/{id}/original.*
                   enqueues conversion job → BullMQ

conversionQueue  →  CompressionWorker  →  variantQueue
       │                    │                   │
  CONVERTING           COMPRESSING        GENERATING_VARIANTS
       │                    │                   │
  HEIC → JPEG          quality=80          3 variants via sharp
  normalise JPEG       track ratio         THUMBNAIL 150×150
  strip EXIF           upload compressed   WEB 800px
  extract dimensions                       FULL 3000px
  upload converted                         → status = ACCEPTED
```

**Queue: BullMQ + Redis**
- Each stage is a separate BullMQ `Worker` — independently scalable
- Job data carries only `{ imageId, r2Key }` — no large buffers in Redis
- Built-in retries (3× exponential backoff) and dead-letter handling
- Deterministic `jobId` (`convert-{imageId}`) prevents duplicate jobs on retry

**Idempotency**
- Job IDs are deterministic — BullMQ deduplicates automatically
- R2 `PutObject` is idempotent (last-write wins)
- `ImageVariant` has `@@unique([imageId, variantType])` — upsert is safe on retry

**Scaling**
To scale a worker independently, extract it to a separate process and point it at the same Redis:
```bash
# Scale compression workers to 3 processes
WORKER=compression node dist/workers/compressionWorker.js &
WORKER=compression node dist/workers/compressionWorker.js &
WORKER=compression node dist/workers/compressionWorker.js &
```

**Error handling**
- Worker failures write `rejectionReason` to the `Image` row
- After `maxAttempts` (3) the job permanently fails — no infinite retries
- `processingStage` tracks where in the pipeline a failure occurred

---

## Storage Setup — Cloudflare R2 (Recommended, Free)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. Create a bucket named `argon-images`
3. Go to **Manage R2 API Tokens** → Create token with *Object Read & Write*
4. Copy **Access Key ID** and **Secret Access Key** into `.env`
5. Set `S3_ENDPOINT=https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com`

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /api/images/upload | Upload + kick off pipeline |
| GET | /api/images | List images (cursor pagination) |
| GET | /api/images/:id | Single image + processingStage |
| GET | /api/images/:id/status | Lightweight pipeline status check |
| GET | /api/images/:id/variants | All 3 variant URLs + compression ratio |
| GET | /api/images/:id/variants/:type/view | Stream variant (thumbnail/web/full) |
| GET | /api/images/:id/view | Stream full image (backward compat) |
| DELETE | /api/images/:id | Delete image + all variants from R2 |

---

## Load Test

```bash
# 100 concurrent uploads (uses synthetic JPEG — tests queue throughput)
node load-test.js

# 200 uploads, 30 in-flight at a time, with a real headshot
node load-test.js --count 200 --concurrency 30 --image /path/to/photo.jpg

# Target a remote server, with longer poll timeout
node load-test.js --count 100 --url https://api.yourserver.com --poll-timeout 30
```

Reports: total, success rate, wall time, throughput (req/s), p50/p95/p99 latency. After upload completes, polls sample images to verify pipeline completion and prints variant metadata.

---

## Running Tests

```bash
cd backend && npm test
```

47 tests total (24 original + 12 pipeline worker + 11 API). All mocked — no Redis, no R2, no DB needed.

---

## Validation Rules

| Check | Threshold | Action |
|-------|-----------|--------|
| Format | HEIC/PNG/JPEG only | Reject |
| Resolution | min 200×200 px | Reject |
| Blur | Laplacian variance < 50 | Reject |
| Face count | 0 or >1 faces | Reject |
| Face size | < 3% of image area | Reject |
| Similarity | pHash Hamming distance < 10 | Reject |
