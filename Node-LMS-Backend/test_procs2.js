import dotenv from 'dotenv';
dotenv.config({ path: 'e:/SYSNOVIX_LMS/[LIVE] HRMS_COMPLETE/Node-LMS-Backend/.env' });

async function check() {
  try {
    const { getDirectConnection } = await import('./src/config/database.js');
    const conn = await getDirectConnection();

    for (const procName of ['ATTENDANCE_UPDATE', 'UPD_CUR_MNTH_ATTND']) {
      const src = await conn.execute(
        `SELECT TEXT FROM ALL_SOURCE WHERE NAME = :p ORDER BY LINE`,
        { p: procName }
      );
      console.log(`=== PROCEDURE: ${procName} ===`);
      console.log(src.rows.map(r => r[0]).join(''));
    }

    await conn.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
