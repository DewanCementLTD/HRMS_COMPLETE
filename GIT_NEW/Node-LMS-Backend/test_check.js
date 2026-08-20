import dotenv from 'dotenv';
dotenv.config({ path: 'e:/SYSNOVIX_LMS/[LIVE] HRMS_COMPLETE/Node-LMS-Backend/.env' });

async function check() {
  try {
    const { getDirectConnection } = await import('./src/config/database.js');
    const conn = await getDirectConnection();
    const res1 = await conn.execute("SELECT STATUS, COUNT(*) FROM HR_EMP_MASTER GROUP BY STATUS");
    console.log('HR_EMP_MASTER STATUS count:', res1.rows);

    const res2 = await conn.execute("SELECT STATUS, COUNT(*) FROM HR_EMP_MASTER_VIEW GROUP BY STATUS");
    console.log('HR_EMP_MASTER_VIEW STATUS count:', res2.rows);

    const res3 = await conn.execute("SELECT CONFIRM_STATUS, COUNT(*) FROM HR_EMP_MASTER GROUP BY CONFIRM_STATUS");
    console.log('HR_EMP_MASTER CONFIRM_STATUS count:', res3.rows);

    const res3b = await conn.execute("SELECT CONFIRM_STATUS, COUNT(*) FROM HR_EMP_MASTER_VIEW GROUP BY CONFIRM_STATUS");
    console.log('HR_EMP_MASTER_VIEW CONFIRM_STATUS count:', res3b.rows);

    const res4 = await conn.execute("SELECT UNIT_ID, LOCATION, STATUS, COUNT(*) FROM HR_EMP_MASTER GROUP BY UNIT_ID, LOCATION, STATUS");
    console.log('HR_EMP_MASTER by UNIT_ID, LOCATION, STATUS:', res4.rows);

    const res5 = await conn.execute("SELECT UNIT_ID, LOC_NAME, STATUS, CONFIRM_STATUS, COUNT(*) FROM HR_EMP_MASTER_VIEW GROUP BY UNIT_ID, LOC_NAME, STATUS, CONFIRM_STATUS");
    console.log('HR_EMP_MASTER_VIEW grouped details:', res5.rows);

    const res6 = await conn.execute("SELECT OLD_EMPCODE, NAME, UNIT_ID, LOCATION, STATUS, CONFIRM_STATUS, DTOFCONFIRM FROM HR_EMP_MASTER_VIEW WHERE UNIT_ID = 1");
    console.log('Unit 1 employees in HR_EMP_MASTER_VIEW:', res6.rows);

    await conn.close();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
