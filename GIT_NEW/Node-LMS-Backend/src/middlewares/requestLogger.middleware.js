import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, '../../logs');

if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const stats = {
  total: 0,
  byRoute: {},
  startTime: Date.now(),
};

// One WriteStream per prefix (lazy-created, append mode)
const streams = {};

function getStream(prefix) {
  // Ensure the logs directory exists
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }

  // Make the filename safe for Windows/Linux/macOS
  const safePrefix = String(prefix).replace(/[<>:"/\\|?*]/g, "_");

  if (!streams[safePrefix]) {
    const filePath = path.join(LOGS_DIR, `${safePrefix}.log`);
    streams[safePrefix] = fs.createWriteStream(filePath, { flags: "a" });

    // Prevent an unhandled stream error from crashing the process
    streams[safePrefix].on("error", (err) => {
      console.error(`Log stream error (${filePath}):`, err);
    });
  }

  return streams[safePrefix];
}

function routePrefix(req) {
  // First non-empty path segment: "/auth/login" → "auth"
  const segment = req.originalUrl.split('/').filter(Boolean)[0];
  return segment || 'general';
}

export const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const prefix = routePrefix(req);
    const key = `${req.method} ${req.baseUrl}${req.path}`;

    stats.total += 1;
    stats.byRoute[key] = (stats.byRoute[key] ?? 0) + 1;

    const uptimeSec = (Date.now() - stats.startTime) / 1000;
    const rps = (stats.total / uptimeSec).toFixed(2);
    const timestamp = new Date().toISOString();

    // Per-route log line
    const requestLine = `[${timestamp}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)\n`;
    getStream(prefix).write(requestLine);

    // Overwrite stats.log with the latest snapshot
    const statsPath = path.join(LOGS_DIR, 'stats.log');
    fs.writeFile(statsPath, buildStats(timestamp, rps), () => {});

    console.log(requestLine.trim());
  });

  next();
};

function buildStats(timestamp, rps) {
  const routeLines = Object.entries(stats.byRoute)
    .map(([route, count]) => `  ${route.padEnd(45)} ${count}`)
    .join('\n');

  return [
    `Updated        : ${timestamp}`,
    `Total requests : ${stats.total}`,
    `Requests/sec   : ${rps}`,
    '',
    'Per route:',
    routeLines,
    '',
  ].join('\n');
}
