// 1. Load environment variables FIRST before anything else
import 'dotenv/config'; 

import app from './app.js';
import { getDirectConnection, closePool } from './config/database.js';

import { logger, installProcessHandlers } from './utils/logger.js';

installProcessHandlers();

const PORT = process.env.PORT || 8000;

const startServer = async () => {
  try {
    // 2. Initialize the Database
    // Probe the pool once so a bad DSN/credential fails loudly at startup rather
    // than on the first request. Release it again — holding it forever would
    // permanently burn one of the pool's connections.
    const probe = await getDirectConnection();
    try {
      logger.info('Direct database connection established successfully.');
    } finally {
      await probe.close();
    }

    // 3. Start the Express Server listening for HTTP requests
    const server = app.listen(PORT, () => {
      logger.info(`ERP Server is running in ESM mode on http://localhost:${PORT}`);
    });

    // 4. Graceful shutdown — stop accepting new requests, let in-flight ones
    // finish, then hand the Oracle sessions back. Without this, a restart drops
    // connections mid-query and leaves the pool's sessions to time out on the
    // DB side. The unref'd timer is a backstop for a connection that never ends.
    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received — shutting down gracefully`);

      const force = setTimeout(() => {
        logger.warn('Shutdown timed out — forcing exit');
        process.exit(1);
      }, 10000);
      force.unref();

      server.close(async () => {
        await closePool();
        clearTimeout(force);
        process.exit(0);
      });
    };

    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => { shutdown(sig); });
    }
  } catch (error) {
    // pino takes the merging OBJECT first — logger.error('msg', err) treats the
    // error as a printf argument and throws the stack away.
    logger.fatal({ err: error }, 'CRITICAL: Server failed to start.');
    process.exit(1);
  }
};

startServer();

