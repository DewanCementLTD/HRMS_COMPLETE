// Creates the Training Management tables (scripts/training_ddl.sql).
// Idempotent: objects/columns/constraints that already exist (ORA-00955, 01408,
// 01430, 02260, 02261, 02264, 02275) are skipped,
// so it is safe to re-run after adding statements to the .sql file.
//   cd Node-LMS-Backend && node scripts/run_training_ddl.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import oracledb from 'oracledb';

try { oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR }); } catch { /* thin mode */ }

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, 'training_ddl.sql'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);

const conn = await oracledb.getConnection({
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectString: process.env.DB_DSN,
});
let created = 0, skipped = 0;
try {
  for (const stmt of statements) {
    const head = stmt.split('\n')[0].slice(0, 90);
    try {
      await conn.execute(stmt);
      created++;
      console.log(`OK    ${head}`);
    } catch (e) {
      if ([955, 1408, 1430, 2260, 2261, 2264, 2275].includes(e.errorNum)) { skipped++; console.log(`SKIP  ${head} (exists)`); }
      else { console.error(`FAIL  ${head}\n      ${e.message}`); process.exitCode = 1; break; }
    }
  }
} finally {
  await conn.close();
}
console.log(`\n${created} created, ${skipped} already present`);
