import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

import imageRoutes from './routes/images';
import errorHandler from './middleware/errorHandler';

const app = express();
const prisma = new PrismaClient();

// Global rate limit — override with GLOBAL_RATE_LIMIT env var for load testing
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.GLOBAL_RATE_LIMIT ?? '10000000000'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Stricter limit for uploads — override with UPLOAD_RATE_LIMIT env var for load testing
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.UPLOAD_RATE_LIMIT ?? '10'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Upload rate limit exceeded. Please wait before uploading more images.' },
});

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(morgan('dev'));
app.use(express.json());
app.use(globalLimiter);

// Health check with DB connectivity verification
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'degraded', db: 'disconnected' });
  }
});

app.use('/api/images/upload', uploadLimiter);
app.use('/api/images', imageRoutes);
app.use(errorHandler);

export default app;
