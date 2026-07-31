import dotenv from 'dotenv';
dotenv.config({ path: 'e:/SYSNOVIX_LMS/[LIVE] HRMS_COMPLETE/Node-LMS-Backend/.env' });

async function verify() {
  const { getDirectConnection } = await import('./src/config/database.js');
  const conn = await getDirectConnection();

  // 1. Bank details
  const banks = await conn.execute(
    `SELECT OLD_EMPCODE, NAME, BNKCODE, BRNCODE, BNKACCT FROM HR_EMP_MASTER WHERE UNIT_ID=1 AND OLD_EMPCODE IN ('100434.1','100002.1','100660.1') ORDER BY OLD_EMPCODE`
  );
  console.log('BANK DETAILS:', JSON.stringify(banks.rows));

  // 2. Loan details
  const loans = await conn.execute(
    `SELECT "DOC#", OLD_EMPCODE, LOAN_CD, LOAN_AMT, LOAN_RECOVER, INSTALMENT_AMT, LOAN_INST, TO_CHAR(START_DT,'YYYY-MM-DD') FROM HR_LOAN_MST WHERE UNIT_ID=1 AND OLD_EMPCODE='100002.1'`
  );
  console.log('LOANS:', JSON.stringify(loans.rows));

  // 3. Monthly allowances added
  const ma = await conn.execute(
    `SELECT PERIOD#, OLD_EMPCODE, ALLOWANCE_ID, AMOUNT, OT_HOUR FROM HR_MONTHLY_ALLOW WHERE UNIT_ID=1 AND PERIOD# BETWEEN 48 AND 53 ORDER BY PERIOD#, OLD_EMPCODE, ALLOWANCE_ID`
  );
  console.log('MONTHLY_ALLOW:', JSON.stringify(ma.rows));

  // 4. Monthly deductions added
  const md = await conn.execute(
    `SELECT PERIOD#, OLD_EMPCODE, DEDUCTION_ID, AMOUNT FROM HR_MONTHLY_DED WHERE UNIT_ID=1 AND PERIOD# BETWEEN 48 AND 53 ORDER BY PERIOD#, OLD_EMPCODE`
  );
  console.log('MONTHLY_DED:', JSON.stringify(md.rows));

  // 5. Salary process summary (current)
  const sp = await conn.execute(
    `SELECT PERIOD#, OLD_EMPCODE, TRANS_TYPE, TRANS_ID, TRANS_AMOUNT FROM HR_SALARY_PROCESS WHERE UNIT_ID=1 AND PERIOD# BETWEEN 48 AND 53 ORDER BY PERIOD#, OLD_EMPCODE, TRANS_TYPE, TRANS_ID`
  );
  console.log('SALARY_PROCESS rows:', sp.rows.length);
  console.log('SALARY_PROCESS sample:', JSON.stringify(sp.rows.slice(0,20)));

  // 6. Salary process master summary
  const spm = await conn.execute(
    `SELECT PERIOD#, OLD_EMPCODE, ACTUAL_GROSS, EARNED_GROSS, TOTAL_EARNING, ABSENT_DAYS, W_DAY FROM HR_SALARY_PROCESS_MASTER WHERE UNIT_ID=1 AND PERIOD# BETWEEN 48 AND 53 ORDER BY PERIOD#, OLD_EMPCODE`
  );
  console.log('SALARY_PROCESS_MASTER:', JSON.stringify(spm.rows));

  // 7. Final tables
  const spf = await conn.execute(
    `SELECT PERIOD#, OLD_EMPCODE, TRANS_TYPE, TRANS_ID, TRANS_AMOUNT FROM HR_SALARY_PROCESS_FINAL WHERE UNIT_ID=1 AND PERIOD# BETWEEN 48 AND 53 ORDER BY PERIOD#, OLD_EMPCODE, TRANS_TYPE, TRANS_ID`
  );
  console.log('SALARY_PROCESS_FINAL rows:', spf.rows.length);

  const spmf = await conn.execute(
    `SELECT PERIOD#, OLD_EMPCODE, ACTUAL_GROSS, EARNED_GROSS, TOTAL_EARNING FROM HR_SALARY_PROCESS_MASTER_FINAL WHERE UNIT_ID=1 AND PERIOD# BETWEEN 48 AND 53 ORDER BY PERIOD#, OLD_EMPCODE`
  );
  console.log('SALARY_PROCESS_MASTER_FINAL:', JSON.stringify(spmf.rows));

  // 8. Bank + Branch info
  const bnkInfo = await conn.execute(
    `SELECT BNKCODE, BNKNAME FROM HR_BANK WHERE BNKCODE='1'`
  );
  const brnInfo = await conn.execute(
    `SELECT BRNCODE, BRNNAME, BNKCODE FROM HR_BRANCH WHERE BRNCODE='1' AND BNKCODE='1'`
  );
  console.log('BANK:', JSON.stringify(bnkInfo.rows));
  console.log('BRANCH:', JSON.stringify(brnInfo.rows));

  // 9. Allowance types referenced
  const alls = await conn.execute(
    `SELECT ALLOWANCE_ID, ALLOWANCE_DESC, USE_ALLOWANCE FROM HR_ALLOWANCE WHERE ALLOWANCE_ID IN ('2','3','4','5','15','19')`
  );
  console.log('ALLOWANCES:', JSON.stringify(alls.rows));

  // 10. Deduction types referenced
  const deds = await conn.execute(
    `SELECT DED_CD, DED_DESC FROM HR_DEDUCTION WHERE DED_CD IN ('2','12','16')`
  );
  console.log('DEDUCTIONS:', JSON.stringify(deds.rows));

  // 11. PF_BALANCES for Zohaib
  const pfb = await conn.execute(
    `SELECT PERIOD#, PF_BAL FROM HR_PF_BALANCES WHERE OLD_EMPCODE='100002.1' AND UNIT_ID=1 ORDER BY PERIOD#`
  );
  console.log('PF_BALANCES:', JSON.stringify(pfb.rows));

  await conn.close();
  process.exit(0);
}
verify().catch(e => { console.error(e); process.exit(1); });
