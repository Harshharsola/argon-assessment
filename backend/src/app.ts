import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import imageRoutes from './routes/images';
import errorHandler from './middleware/errorHandler';

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/images', imageRoutes);
app.use(errorHandler);

export default app;
