// Creates the Performance Appraisal tables (scripts/appraisal_ddl.sql).
// Idempotent: objects/columns/constraints that already exist (ORA-00955, 01408,
// 01430, 01442, 01451, 02260, 02261, 02264, 02275) are skipped, so it is safe to re-run.
// Also widens HR_TRAINING_REQUEST.SOURCE to accept 'APPRAISAL', and (v2) migrates
// the appraisal stage / action checks and the rating scale to the DCL process.
//   cd Node-LMS-Backend && node scripts/run_appraisal_ddl.mjs
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import oracledb from 'oracledb';

try { oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_LIB_DIR }); } catch { /* thin mode */ }

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, 'appraisal_ddl.sql'), 'utf8')
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
      if ([955, 1408, 1430, 1442, 1451, 2260, 2261, 2264, 2275].includes(e.errorNum)) { skipped++; console.log(`SKIP  ${head} (exists)`); }
      else { console.error(`FAIL  ${head}\n      ${e.message}`); process.exitCode = 1; break; }
    }
  }

  if (!process.exitCode) {
    // HR_TRAINING_REQUEST.SOURCE: replace the unnamed check with a named one that allows APPRAISAL.
    const r = await conn.execute(
      `SELECT CONSTRAINT_NAME, SEARCH_CONDITION FROM USER_CONSTRAINTS
        WHERE TABLE_NAME = 'HR_TRAINING_REQUEST' AND CONSTRAINT_TYPE = 'C'`,
    );
    const sourceChecks = r.rows.filter(([, cond]) => /SOURCE\s+IN/i.test(String(cond ?? '')));
    if (sourceChecks.some(([, cond]) => /APPRAISAL/i.test(String(cond)))) {
      skipped++;
      console.log('SKIP  HR_TRAINING_REQUEST.SOURCE already allows APPRAISAL');
    } else {
      for (const [name] of sourceChecks) await conn.execute(`ALTER TABLE HR_TRAINING_REQUEST DROP CONSTRAINT ${name}`);
      await conn.execute(
        `ALTER TABLE HR_TRAINING_REQUEST ADD CONSTRAINT HR_TRAINING_REQUEST_SRC_CK
           CHECK (SOURCE IN ('EMPLOYEE','HOD','HR','APPRAISAL'))`,
      );
      created++;
      console.log('OK    HR_TRAINING_REQUEST.SOURCE now allows APPRAISAL');
    }

    // v2: replace an unnamed check on `table` whose condition mentions `column IN` with `named`.
    const replaceCheck = async (table, column, mustHave, named, ddl, beforeAdd) => {
      const c = await conn.execute(
        `SELECT CONSTRAINT_NAME, SEARCH_CONDITION FROM USER_CONSTRAINTS WHERE TABLE_NAME = :t AND CONSTRAINT_TYPE = 'C'`, { t: table },
      );
      const checks = c.rows.filter(([, cond]) => new RegExp(`${column}\\s+IN`, 'i').test(String(cond ?? '')));
      if (checks.some(([, cond]) => String(cond).includes(mustHave))) {
        skipped++;
        console.log(`SKIP  ${table}.${column} check already migrated`);
        return;
      }
      for (const [name] of checks) await conn.execute(`ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
      if (beforeAdd) await beforeAdd();
      await conn.execute(`ALTER TABLE ${table} ADD CONSTRAINT ${named} CHECK (${ddl})`);
      created++;
      console.log(`OK    ${table}.${column} check migrated`);
    };

    await replaceCheck('HR_APPRAISAL_MASTER', 'STAGE', "'OBJ_SETTING'", 'HR_APPRAISAL_MASTER_STAGE_CK',
      `STAGE IN ('OBJ_SETTING','OBJ_REVIEW','MIDYEAR','MID_REVIEW','RPT','HOD1','HOD2','HR','COMPLETED','CANCELLED')`,
      async () => {
        // Appraisals launched under the first (BRD) design move to the matching DCL stage.
        for (const [from, to] of [['GOALS', 'OBJ_SETTING'], ['GOALS_REVIEW', 'OBJ_REVIEW'], ['SELF', 'MIDYEAR'], ['MGMT', 'HR']]) {
          const u = await conn.execute(`UPDATE HR_APPRAISAL_MASTER SET STAGE = :nst WHERE STAGE = :ost`, { nst: to, ost: from });
          if (u.rowsAffected) console.log(`      ${u.rowsAffected} appraisal(s) ${from} -> ${to}`);
        }
      });
    await replaceCheck('HR_APPRAISAL_APPROVAL', 'ACTION', "'FINALISE'", 'HR_APPRAISAL_APPROVAL_ACT_CK',
      `ACTION IN ('SUBMIT','APPROVE','RETURN','CANCEL','REOPEN','SIGN','FINALISE','ACK')`);

    // v2: rating scale moves from 0-100 bands to DCL grades on the 1-5 points total.
    const GRADES = [
      [4.5, 5, 'A+', 'Outstanding', 5, 'N'], [3.5, 4.49, 'A', 'Excellent Performance', 19, 'N'],
      [2.5, 3.49, 'B', 'Good Performance', 63, 'N'], [1.5, 2.49, 'C', 'Inconsistent', 8, 'Y'], [0, 1.49, 'D', 'Non-performer', 5, 'Y'],
    ];
    const old = await conn.execute(`SELECT DISTINCT COMPC FROM HR_APPR_RATING_SCALE WHERE MAX_SCORE > 5`);
    for (const [compc] of old.rows) {
      await conn.execute(`DELETE FROM HR_APPR_RATING_SCALE WHERE COMPC = :c`, { c: compc });
      for (const [mn, mx, l, d, tg, dev] of GRADES) {
        await conn.execute(
          `INSERT INTO HR_APPR_RATING_SCALE (SCALE_ID, COMPC, MIN_SCORE, MAX_SCORE, LABEL, DESCRIPTION, TARGET_PCT, IS_DEVELOPMENT, CREATED_BY)
           VALUES (HR_APPR_RATING_SCALE_SEQ.NEXTVAL, :c, :mn, :mx, :l, :d, :tg, :dev, 'MIGRATION')`,
          { c: compc, mn, mx, l, d, tg, dev },
        );
      }
      created++;
      console.log(`OK    rating scale of company ${compc} -> A+ / A / B / C / D`);
    }
    await conn.commit();
  }
} finally {
  await conn.close();
}
console.log(`\n${created} created, ${skipped} already present`);
