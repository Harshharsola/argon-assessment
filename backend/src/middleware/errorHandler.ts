import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

interface AppError extends Error {
  status?: number;
}

const errorHandler: ErrorRequestHandler = (
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(err);
  const status = err.status ?? 500;
  res.status(status).json({ error: err.message ?? 'Internal server error' });
};

export default errorHandler;
