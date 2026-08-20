/**
 * App version controllers — /app/* endpoints for the mobile update flow.
 *
 * Direct port of the FastAPI LMS-Backend routers/app_version_router.py.
 * Error bodies use { detail } to match FastAPI's HTTPException JSON.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { evaluateAppVersion } from '../services/appVersion.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Directory the latest release APK is dropped into (as app-latest.apk).
// Default: <project root>/static/apk — overridable via APK_DIR.
const APK_DIR = process.env.APK_DIR || path.join(__dirname, '..', '..', 'static', 'apk');
const APK_LATEST_NAME = process.env.APK_LATEST_NAME || 'app-latest.apk';

// GET /app/version-check — called by the app on launch and after login.
// Returns whether the client is up to date, needs a soft (optional) update,
// or a force (mandatory) one.
export const versionCheck = async (req, res, next) => {
  try {
    const { platform, version, build } = res.locals.validated.query;
    res.json(await evaluateAppVersion(version ?? null, build ?? null, platform));
  } catch (err) {
    next(err);
  }
};

// GET /app/download/latest — serve the latest release APK.
// Point APP_VERSION.UPDATE_URL at this URL.
export const downloadLatestApk = (req, res, next) => {
  try {
    const apkPath = path.join(APK_DIR, APK_LATEST_NAME);
    if (!fs.existsSync(apkPath) || !fs.statSync(apkPath).isFile()) {
      return res.status(404).json({ detail: 'No APK is currently published' });
    }
    res.set('Content-Type', 'application/vnd.android.package-archive');
    res.download(apkPath, APK_LATEST_NAME);
  } catch (err) {
    next(err);
  }
};
