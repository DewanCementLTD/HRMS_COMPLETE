import dotenv from 'dotenv';
dotenv.config({ path: 'e:/SYSNOVIX_LMS/[LIVE] HRMS_COMPLETE/Node-LMS-Backend/.env' });

async function check() {
  try {
    const { getDirectConnection } = await import('./src/config/database.js');
    const conn = await getDirectConnection();

    const empAllow = await conn.execute(
      `SELECT OLD_EMPCODE, ALLOWANCE_ID, AMOUNT, PROC_FLAG FROM HR_EMP_ALLOW WHERE UNIT_ID = 1 AND OLD_EMPCODE IN ('100434.1', '100002.1', '100660.1')`
    );
    console.log('Fixed allowances in HR_EMP_ALLOW:', empAllow.rows);

    await conn.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
