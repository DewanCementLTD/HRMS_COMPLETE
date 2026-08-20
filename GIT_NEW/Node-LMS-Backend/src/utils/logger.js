import pino from 'pino';
import pretty from 'pino-pretty';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, '../../logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const isDevelopment = process.env.NODE_ENV !== 'production';
const LEVEL = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Shared pino options. `serializers.err` gives every logged Error a proper
// type/message/stack shape (pino-pretty renders that as a readable block);
// `redact` keeps credentials out of the log files if an object carrying one is
// ever passed to the logger.
const baseOptions = {
  level: LEVEL,
  serializers: { err: pino.stdSerializers.err },
  redact: {
    paths: [
      'password', '*.password',
      'old_password', '*.old_password',
      'new_password', '*.new_password',
      'req.headers.authorization', 'req.headers.cookie',
      'DB_PASSWORD', 'GEMINI_API_KEY',
    ],
    censor: '[redacted]',
  },
};

const prettyOptions = {
  translateTime: 'SYS:standard',
  // pid/hostname add nothing for a single-process server; req/res are already
  // reduced to method/url/statusCode by the serializers in routes/index.js.
  ignore: 'pid,hostname,req,res',
  messageFormat: '{msg}',
};

const consoleStream = pretty({ ...prettyOptions, colorize: true });

// Global logger — startup, shutdown and anything outside a mounted router.
export const logger = pino(baseOptions, consoleStream);

const routeLoggers = {};

export function getRouteLogger(prefix) {
  if (!routeLoggers[prefix]) {
    const safePrefix = String(prefix).replace(/[<>:"/\\|?*]/g, '_');
    const logFilePath = path.join(LOGS_DIR, `${safePrefix}.log`);

    const fileStream = pretty({
      ...prettyOptions,
      colorize: false,
      destination: fs.createWriteStream(logFilePath, { flags: 'a' }),
    });

    // Both streams are set to the logger's own level so a warn/error is never
    // written to the console but silently dropped from the file (or vice versa).
    routeLoggers[prefix] = pino(
      baseOptions,
      pino.multistream([
        { stream: consoleStream, level: LEVEL },
        { stream: fileStream, level: LEVEL },
      ], { dedupe: false })
    );
  }
  return routeLoggers[prefix];
}

// pino's streams write asynchronously, so anything logged immediately before
// process.exit() can be lost — which is how a crash ends up with NO explanation
// in the log. Write the fatal to stderr synchronously first, so the reason is
// always on the record no matter what the stream does.
function logFatalSync(err, msg) {
  try {
    fs.writeSync(2, `[${new Date().toISOString()}] FATAL: ${msg}\n${err?.stack || err}\n`);
  } catch { /* stderr unavailable — nothing more we can do */ }
  try {
    logger.fatal({ err }, msg);
  } catch { /* logger already torn down */ }
}

export function installProcessHandlers() {
  // An uncaught exception leaves the process in an undefined state — log it and
  // let the supervisor restart us. The short delay gives pino's stream a chance
  // to flush the structured copy to the log file before we go.
  process.on('uncaughtException', (err) => {
    logFatalSync(err, 'Uncaught exception — shutting down');
    setTimeout(() => process.exit(1), 100).unref();
  });

  // Deliberately does NOT exit. Since Node 15 the default for an unhandled
  // rejection is to crash the process, which for this server means one stray
  // background promise (e.g. the fire-and-forget AI CV evaluation in
  // recruitment.controller.js) could take the whole backend down for every
  // user. The FastAPI backend this replaces just logs and keeps serving; match
  // that, and make the rejection loud so it still gets fixed.
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error({ err }, 'Unhandled promise rejection — server still running, but this is a bug');
  });
}
