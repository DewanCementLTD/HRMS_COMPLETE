import oracledb from 'oracledb';
import { logger } from '../utils/logger.js';
import 'dotenv/config';

// Try Thick mode first (needs a 64-bit Oracle Client at ORACLE_CLIENT_LIB_DIR).
// If the client is missing or the wrong architecture, fall back to node-oracledb's
// built-in Thin mode instead of killing the process — Thin talks to Oracle 12.1+
// with no client install at all, which is how the FastAPI backend connects
// (python-oracledb runs thin: see LMS-Backend/core/database.py).
const ORACLE_CLIENT_LIB_DIR =
  process.env.ORACLE_CLIENT_LIB_DIR || 'C:\\oraclexe\\app\\oracle\\product\\11.2.0\\server\\bin';

try {
  oracledb.initOracleClient({ libDir: ORACLE_CLIENT_LIB_DIR });
  logger.info(`Oracle Thick mode initialized from ${ORACLE_CLIENT_LIB_DIR}`);
} catch (err) {
  logger.warn(
    `Oracle Thick mode unavailable (${err.message.split('\n')[0]}) — falling back to Thin mode.`
  );
}

// Hold the in-flight promise, not just the resolved pool. Callers that arrive
// while createPool() is still running must await that same promise — checking a
// `pool` variable instead would still see undefined and build a SECOND pool,
// orphaning the first one's sessions.
let poolPromise;

const initializePool = () => {
  if (!poolPromise) {
    poolPromise = oracledb
      .createPool({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_DSN,
        poolMin: 4,
        poolMax: 10,
        poolIncrement: 1,
      })
      .then((p) => {
        logger.info('Oracle Connection Pool initialized successfully');
        return p;
      })
      .catch((err) => {
        logger.error({ err }, 'Failed to create Oracle connection pool');
        // Clear it so a later call can retry instead of re-awaiting a rejection.
        poolPromise = undefined;
        throw err;
      });
  }
  return poolPromise;
};

// Kick the pool off at import time so the first request doesn't pay for it.
// The rejection is handled inside initializePool; swallow it here so an early
// DB outage doesn't surface as an unhandled rejection before index.js probes.
initializePool().catch(() => {});

// Export the same function signature, but get connection from pool instead
export const getDirectConnection = async () => {
  const pool = await initializePool();
  try {
    return await pool.getConnection();
  } catch (err) {
    logger.error({ err }, 'Failed to get connection from pool');
    throw err;
  }
};

// Close the pool on shutdown so Oracle reclaims the sessions immediately
// instead of leaving up to poolMax of them to time out server-side. The drain
// timeout lets in-flight queries finish first.
export const closePool = async (drainSeconds = 5) => {
  if (!poolPromise) return;
  try {
    const pool = await poolPromise;
    await pool.close(drainSeconds);
    logger.info('Oracle connection pool closed');
  } catch (err) {
    logger.error({ err }, 'Error closing Oracle connection pool');
  } finally {
    poolPromise = undefined;
  }
};
