/**
 * App version service — drives the mobile "please update" flow.
 *
 * Direct port of the FastAPI LMS-Backend (repositories/app_version_repository.py).
 * Reads the APP_VERSION table and decides whether a given app version is up to
 * date, needs a soft (optional) update, or a force (mandatory) update. Degrades
 * gracefully: if the extra columns don't exist it falls back to a single VERSION
 * column, and if the table is missing/empty it never blocks anyone.
 */

import oracledb from 'oracledb';
import { getDirectConnection } from '../config/database.js';

import { logger } from '../utils/logger.js';
// ---------------------------------------------------------------------------
// Version-string helpers (mirror _parse_ver / _cmp_ver / _to_int)
// ---------------------------------------------------------------------------

const parseVer = (s) => {
  if (!s) return [];
  const parts = String(s).match(/\d+/g);
  return parts ? parts.map((p) => parseInt(p, 10)) : [];
};

const cmpVer = (a, b) => {
  const n = Math.max(a.length, b.length);
  const la = [...a, ...Array(n - a.length).fill(0)];
  const lb = [...b, ...Array(n - b.length).fill(0)];
  for (let i = 0; i < n; i++) {
    if (la[i] > lb[i]) return 1;
    if (la[i] < lb[i]) return -1;
  }
  return 0;
};

// int(float(str(v).strip())) — accepts "42", "42.0", 42, etc.
const toInt = (v) => {
  if (v === null || v === undefined) return null;
  const f = parseFloat(String(v).trim());
  return Number.isFinite(f) ? Math.trunc(f) : null;
};

const isMissingColumnError = (err) =>
  err?.errorNum === 904 || String(err?.message ?? '').includes('ORA-00904');

// ---------------------------------------------------------------------------
// APP_VERSION config read (mirror get_app_version_config)
// ---------------------------------------------------------------------------

const FULL_COLS =
  'MIN_VERSION, LATEST_VERSION, MIN_BUILD, LATEST_BUILD, UPDATE_URL, FORCE_MESSAGE, SOFT_MESSAGE';

export const getAppVersionConfig = async (platform = 'ANDROID') => {
  let connection;
  try {
    connection = await getDirectConnection();

    const attempts = [
      {
        sql: `SELECT ${FULL_COLS} FROM APP_VERSION WHERE UPPER(NVL(PLATFORM,'ANDROID')) = :p`,
        binds: { p: (platform || 'ANDROID').toUpperCase() },
      },
      { sql: `SELECT ${FULL_COLS} FROM APP_VERSION`, binds: {} },
    ];

    for (const { sql, binds } of attempts) {
      try {
        const row = (
          await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_ARRAY })
        ).rows?.[0];
        if (!row) return {};
        return {
          min_version: row[0],
          latest_version: row[1],
          min_build: toInt(row[2]),
          latest_build: toInt(row[3]),
          update_url: row[4],
          force_message: row[5],
          soft_message: row[6],
        };
      } catch (e) {
        if (isMissingColumnError(e)) continue; // columns absent → try fallback
        throw e;
      }
    }

    // Last resort: a single VERSION column.
    try {
      const row = (
        await connection.execute('SELECT VERSION FROM APP_VERSION', {}, {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
        })
      ).rows?.[0];
      if (row && row[0]) return { latest_version: String(row[0]) };
    } catch {
      /* ignore */
    }
    return {};
  } catch (e) {
    logger.info(`[APP_VERSION] config read failed (no enforcement): ${e.message ?? e}`);
    return {};
  } finally {
    await connection?.close();
  }
};

// ---------------------------------------------------------------------------
// Decision logic (mirror evaluate_app_version)
// ---------------------------------------------------------------------------

export const evaluateAppVersion = async (version = null, build = null, platform = 'ANDROID') => {
  const result = {
    status: 'ok',
    force: false,
    latest_version: null,
    update_url: null,
    message: null,
  };

  const cfg = await getAppVersionConfig(platform);
  if (!cfg || Object.keys(cfg).length === 0) return result;

  result.latest_version = cfg.latest_version ?? null;
  result.update_url = cfg.update_url ?? null;
  if ((version === null || version === undefined) && (build === null || build === undefined))
    return result;

  const b = toInt(build);
  const { min_build, latest_build, min_version, latest_version } = cfg;

  const below = (targetBuild, targetVer) => {
    if (b !== null && targetBuild !== null && targetBuild !== undefined) return b < targetBuild;
    if (version && targetVer) return cmpVer(parseVer(version), parseVer(targetVer)) < 0;
    return false;
  };

  if (below(min_build, min_version)) {
    result.status = 'force_update';
    result.force = true;
    result.message =
      cfg.force_message || 'A required update is available. Please update the app to continue.';
  } else if (below(latest_build, latest_version)) {
    result.status = 'soft_update';
    result.message = cfg.soft_message || 'A new version of the app is available.';
  }
  return result;
};

/**
 * Guard for login/attendance. Returns `{ message, update_url }` when this client
 * MUST update, else `null`. Never throws; returns null when no version is sent.
 */
export const forceUpdateBlock = async (version = null, build = null, platform = 'ANDROID') => {
  try {
    const res = await evaluateAppVersion(version, build, platform);
    if (res.force) return { message: res.message, update_url: res.update_url };
  } catch (e) {
    logger.info(`[APP_VERSION] force check skipped: ${e.message ?? e}`);
  }
  return null;
};
