import dotenv from 'dotenv';
dotenv.config({ path: 'e:/SYSNOVIX_LMS/[LIVE] HRMS_COMPLETE/Node-LMS-Backend/.env' });

async function check() {
  try {
    const { getDirectConnection } = await import('./src/config/database.js');
    const conn = await getDirectConnection();

    // Check Period 48 (Unit 1, Jul 2026)
    const p48 = await conn.execute(
      "SELECT ABSENT, COUNT(*) FROM HR_EMP_DAYS WHERE PERIOD# = 48 AND UNIT_ID = 1 GROUP BY ABSENT"
    );
    console.log('Period 48 (Unit 1) ABSENT values in HR_EMP_DAYS:', p48.rows);

    const sample48 = await conn.execute(
      "SELECT OLD_EMPCODE, DAYS, ABSENT, LEAVE, PRESENT, LATE, HALFDAY FROM HR_EMP_DAYS WHERE PERIOD# = 48 AND UNIT_ID = 1 FETCH FIRST 5 ROWS ONLY"
    );
    console.log('Sample rows for Period 48 in HR_EMP_DAYS:', sample48.rows);

    // Also check what the attendance summary PDF queries (HR_DAILY_LOG / HR_EMP_ATTND)
    const dailyLog = await conn.execute(
      "SELECT COUNT(*) FROM HR_DAILY_LOG WHERE ATTND_DATE BETWEEN TO_DATE('2026-06-30','YYYY-MM-DD') AND TO_DATE('2026-07-31','YYYY-MM-DD')"
    );
    console.log('HR_DAILY_LOG count for July 2026 range:', dailyLog.rows);

    const empAttnd = await conn.execute(
      "SELECT COUNT(*) FROM HR_EMP_ATTND WHERE ATTND_DATE BETWEEN TO_DATE('2026-06-30','YYYY-MM-DD') AND TO_DATE('2026-07-31','YYYY-MM-DD')"
    );
    console.log('HR_EMP_ATTND count for July 2026 range:', empAttnd.rows);

    await conn.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
