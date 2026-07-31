import dotenv from 'dotenv';
dotenv.config({ path: 'e:/SYSNOVIX_LMS/[LIVE] HRMS_COMPLETE/Node-LMS-Backend/.env' });

async function setup() {
  let conn;
  try {
    const { getDirectConnection } = await import('./src/config/database.js');
    conn = await getDirectConnection();

    console.log('--- 1. Updating Employee Bank Account Details ---');
    const empUpdates = [
      { code: '100434.1', bnk: '1', brn: '1', acct: 'PK12345678901234' },
      { code: '100002.1', bnk: '1', brn: '1', acct: 'PK98765432109876' },
      { code: '100660.1', bnk: '1', brn: '1', acct: 'PK55544433321111' },
    ];
    for (const e of empUpdates) {
      await conn.execute(
        `UPDATE HR_EMP_MASTER SET BNKCODE = :bnk, BRNCODE = :brn, BNKACCT = :acct WHERE OLD_EMPCODE = :code AND UNIT_ID = 1`,
        { bnk: e.bnk, brn: e.brn, acct: e.acct, code: e.code }
      );
    }
    console.log('Bank details updated.');

    console.log('--- 2. Setting up PF Loan for Zohaib Farooqui (100002.1) ---');
    await conn.execute(`DELETE FROM HR_LOAN_MST WHERE OLD_EMPCODE = '100002.1' AND UNIT_ID = 1 AND LOAN_CD = '16'`);
    
    const docRes = await conn.execute(`SELECT NVL(MAX("DOC#"), 0) + 1 FROM HR_LOAN_MST`);
    const docNo = docRes.rows[0][0];

    await conn.execute(
      `INSERT INTO HR_LOAN_MST (
        "DOC#", DOC_DT, UNIT_ID, OLD_EMPCODE, LOAN_CD, LOAN_DATE, LOAN_AMT,
        LOAN_RECOVER, INSTALMENT_AMT, NOF_INSTALMENT, START_DT, CHARGE_INT, LOAN_INST
      ) VALUES (
        :doc, TO_DATE('2026-07-01', 'YYYY-MM-DD'), 1, '100002.1', '16', TO_DATE('2026-07-01', 'YYYY-MM-DD'),
        50000, 0, 5000, 10, TO_DATE('2026-07-01', 'YYYY-MM-DD'), 'N', 'Y'
      )`,
      { doc: docNo }
    );
    console.log(`Loan record DOC# ${docNo} created: 50,000 total, 5,000 monthly installment.`);

    console.log('--- 3. Processing 6 Periods (Period 48 to 53: Jul-2026 to Dec-2026) ---');
    const periods = [48, 49, 50, 51, 52, 53];
    let cumLoanRecover = 0;

    for (const p of periods) {
      console.log(`\nProcessing Period ${p}...`);

      // Set period status to Open 'O'
      await conn.execute(`UPDATE HR_ATTND_PERIOD SET STATUS = 'O' WHERE "PERIOD#" = :p AND UNIT_ID = 1`, { p });

      // Fetch period details
      const pRes = await conn.execute(
        `SELECT RULE_ID, PERIOD_FRM, PERIOD_TO FROM HR_ATTND_PERIOD WHERE "PERIOD#" = :p AND UNIT_ID = 1`,
        { p }
      );
      const prow = pRes.rows[0];
      const ruleId = prow[0];

      // Clear existing monthly allow/ded and salary process tables for period
      await conn.execute(`DELETE FROM HR_MONTHLY_ALLOW WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p });
      await conn.execute(`DELETE FROM HR_MONTHLY_DED WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p });
      await conn.execute(`DELETE FROM HR_SALARY_PROCESS WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p });
      await conn.execute(`DELETE FROM HR_SALARY_PROCESS_MASTER WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p });
      try { await conn.execute(`DELETE FROM HR_SALARY_PROCESS_FH WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p }); } catch {}
      try { await conn.execute(`DELETE FROM HR_SALARY_PROCESS_MASTER_FH WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p }); } catch {}

      // Add Monthly Variable Allowances (Using Allowance 19 = OT, 4 = Conveyance, 15 = Utility)
      const allowances = [
        { code: '100434.1', allId: '19', amt: 5000, otHr: 20 },
        { code: '100434.1', allId: '4',  amt: 3000, otHr: 0 },
        { code: '100002.1', allId: '19', amt: 4500, otHr: 15 },
        { code: '100002.1', allId: '4',  amt: 2500, otHr: 0 },
        { code: '100002.1', allId: '15', amt: 3500, otHr: 0 },
        { code: '100660.1', allId: '19', amt: 6000, otHr: 25 },
        { code: '100660.1', allId: '4',  amt: 4000, otHr: 0 },
      ];
      for (const a of allowances) {
        await conn.execute(
          `INSERT INTO HR_MONTHLY_ALLOW (RULE_ID, OLD_EMPCODE, UNIT_ID, PERIOD#, ALLOWANCE_ID, AMOUNT, OT_HOUR)
           VALUES (:ruleId, :code, 1, :p, :allId, :amt, :otHr)`,
          { ruleId, code: a.code, p, allId: a.allId, amt: a.amt, otHr: a.otHr }
        );
      }

      // Add Monthly Deductions
      await conn.execute(
        `INSERT INTO HR_MONTHLY_DED (OLD_EMPCODE, UNIT_ID, PERIOD#, DEDUCTION_ID, AMOUNT)
         VALUES ('100434.1', 1, :p, '2', 1000)`,
        { p }
      );

      // Update cumulative loan recovery before salary process run
      cumLoanRecover += 5000;
      await conn.execute(
        `UPDATE HR_LOAN_MST SET LOAN_RECOVER = :rec WHERE "DOC#" = :doc`,
        { rec: cumLoanRecover, doc: docNo }
      );

      // Run HR_SALARY_PROCES_PRO
      await conn.execute(
        `BEGIN HR_SALARY_PROCES_PRO(1, :p, :pf, :pt, :r); END;`,
        { p, pf: prow[1], pt: prow[2], r: ruleId }
      );

      // Post to FINAL tables for posted reports
      await conn.execute(`DELETE FROM HR_SALARY_PROCESS_FINAL WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p });
      await conn.execute(`DELETE FROM HR_SALARY_PROCESS_MASTER_FINAL WHERE UNIT_ID = 1 AND PERIOD# = :p`, { p });

      await conn.execute(
        `INSERT INTO HR_SALARY_PROCESS_FINAL SELECT * FROM HR_SALARY_PROCESS WHERE UNIT_ID = 1 AND PERIOD# = :p`,
        { p }
      );
      await conn.execute(
        `INSERT INTO HR_SALARY_PROCESS_MASTER_FINAL SELECT * FROM HR_SALARY_PROCESS_MASTER WHERE UNIT_ID = 1 AND PERIOD# = :p`,
        { p }
      );

      console.log(`Period ${p} processed and posted successfully.`);
    }

    await conn.commit();
    console.log('\n--- ALL 6 PERIODS PROCESSED SUCCESSFULLY ---');
    await conn.close();
    process.exit(0);
  } catch (err) {
    console.error('Error during setup:', err);
    conn?.rollback();
    process.exit(1);
  }
}

setup();
