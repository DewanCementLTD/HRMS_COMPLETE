import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';

import { logger } from './utils/logger.js';
const app = express();

// 1. Security & Parsing Middleware
app.use(cors()); // Allow frontend to talk to this API

// Parse JSON body payloads.
// express.json() defaults to a 100 KB limit; FastAPI/Starlette imposes none. The
// mobile app posts base64 JPEG face frames to /auth/attendance/face and
// /face/register — a single face-mark measured ~675 KB — so the default silently
// turned every face request into a 413 that the live backend accepts. Keep a
// generous bound rather than no bound at all; override with JSON_BODY_LIMIT.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '50mb' }));


// 2. Mount all routes
app.use('/', routes);

// 3. 404 Handler — must sit after the routes, before the error handler.
// The web client parses every failure as JSON (LMS-Web/src/services/api.ts), so
// an unmatched path has to come back as {detail} like FastAPI does, not as
// Express's default HTML page.
app.use((req, res) => {
  res.status(404).json({ detail: `Not Found: ${req.method} ${req.originalUrl}` });
});

// 4. Global Error Handler (Catches all `next(error)` calls)
app.use((err, req, res, next) => {
  // Once the response has started streaming (a file download, say) we cannot
  // swap in a JSON error body — hand back to Express to abort the connection.
  if (res.headersSent) return next(err);

  const status = Number(err.status || err.statusCode) || 500;

  // Attach the error to the response so pino-http logs THIS error — with the
  // stack, the right level and the request's own route logger — as part of the
  // single request-completion line. Logging it again here would double every
  // failure in the log file. `req.log` is absent only for requests that never
  // reached a mounted router, so fall back to the global logger there.
  res.err = err;
  if (!req.log) {
    logger.error({ err }, `Unhandled error on ${req.method} ${req.originalUrl}`);
  }

  // FastAPI's global handler returns {"detail": str(exc)} — keep that shape so
  // the web client renders the same message (LMS-Web/src/services/api.ts).
  res.status(status).json({ detail: err.message || 'Internal Server Error' });
});

export default app;