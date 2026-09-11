import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';

import { logger } from './utils/logger.js';
import { presentableMessage, readableMessage, GENERIC_MESSAGE } from './utils/apiErrors.js';
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


// 2. Error-response shaping — must wrap res.json BEFORE the routes run.
//
// Every failure leaves this API as JSON carrying a top-level `message` the
// mobile app can show the employee verbatim, whatever shape the handler chose:
// FastAPI's {detail: "..."} , the middlewares' {detail: {code, message}} and
// Zod's {detail: [issues]} all still go out unchanged underneath, so the web
// client (LMS-Web/src/services/api.ts) reads exactly what it always did.
// Doing it here rather than in each of ~60 handlers means no route can be
// forgotten, and none can leak an ORA- code or a stack frame to a phone screen.
app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const shaped = { ...body };
      if (shaped.success === undefined) shaped.success = false;
      shaped.message = presentableMessage(
        typeof shaped.message === 'string' && shaped.message.trim()
          ? shaped.message
          : readableMessage(shaped),
      );
      // A handler that answered with a raw driver error (several catch blocks
      // do `{detail: String(e.message)}`) would still ship the ORA text in
      // `detail`, which clients fall back to reading. Replace it in place; a
      // detail that is already a sentence, an object or an issue list is left
      // exactly as it was.
      if (typeof shaped.detail === 'string' && presentableMessage(shaped.detail) === GENERIC_MESSAGE) {
        shaped.detail = shaped.message;
      }
      return sendJson(shaped);
    }
    return sendJson(body);
  };
  next();
});

// 3. Mount all routes
app.use('/', routes);

// 4. 404 Handler — must sit after the routes, before the error handler.
// The web client parses every failure as JSON (LMS-Web/src/services/api.ts), so
// an unmatched path has to come back as {detail} like FastAPI does, not as
// Express's default HTML page.
app.use((req, res) => {
  res.status(404).json({
    message: 'That request could not be found on the server.',
    detail: `Not Found: ${req.method} ${req.originalUrl}`,
  });
});

// 5. Global Error Handler (Catches all `next(error)` calls)
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

  // An unhandled throw is almost always a driver or programming error, and its
  // text (ORA codes, SQL, stack frames) is for the log, not for the employee.
  // Only a failure a handler deliberately raised with its own status is quoted
  // back; anything 5xx gets a sentence that says what to do instead.
  const raw = err.message || 'Internal Server Error';
  const message = status >= 500 ? presentableMessage('') : presentableMessage(raw);

  // FastAPI's global handler returns {"detail": str(exc)} — keep that shape so
  // the web client renders the same message (LMS-Web/src/services/api.ts).
  res.status(status).json({
    message,
    ...(err.code ? { code: String(err.code) } : {}),
    detail: status >= 500 ? message : raw,
  });
});

export default app;