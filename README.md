# Argon Assessment — Image Upload & Validation

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL running locally (or a connection string)
- Cloudflare R2 account (free) **or** AWS S3

---

### 1. Backend

```bash
cd backend
cp .env.example .env   # fill in your DB and S3/R2 credentials
npm install
npx prisma migrate dev --name init
npm run dev
```

Server starts at `http://localhost:3001`

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

App opens at `http://localhost:5173`

---

## Storage Setup — Cloudflare R2 (Recommended, Free)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. Create a bucket named `argon-images`
3. Go to **Manage R2 API Tokens** → Create token with *Object Read & Write*
4. Copy **Access Key ID** and **Secret Access Key** into `.env`
5. Set `S3_ENDPOINT=https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com`
6. Optionally enable **Public Access** on the bucket and set `S3_PUBLIC_URL`

## Storage Setup — AWS S3

1. Create an S3 bucket in your preferred region
2. Create an IAM user with `s3:PutObject`, `s3:DeleteObject` on that bucket
3. Set `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `.env`
4. Leave `S3_ENDPOINT` blank

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| POST | /api/images/upload | Upload + validate image |
| GET | /api/images | List all images |
| GET | /api/images/:id | Get single image |
| DELETE | /api/images/:id | Delete image |

---

## Validation Rules

| Check | Threshold | Action |
|-------|-----------|--------|
| Format | HEIC/PNG/JPEG only | Reject |
| Resolution | min 200×200 px | Reject |
| Blur | Laplacian variance < 50 | Reject |
| Face count | 0 or >1 faces | Reject |
| Face size | Too small relative to image | Reject |
| Similarity | pHash distance < threshold | Reject |

---

## Running Tests

```bash
cd backend && npm test
```
