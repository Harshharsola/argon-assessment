import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import imageRoutes from './routes/images';
import errorHandler from './middleware/errorHandler';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:5173' }));
app.use(morgan('dev'));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/images', imageRoutes);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default app; // for tests
