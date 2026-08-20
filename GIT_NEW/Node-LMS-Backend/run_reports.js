import dotenv from 'dotenv';
dotenv.config({ path: 'e:/SYSNOVIX_LMS/[LIVE] HRMS_COMPLETE/Node-LMS-Backend/.env' });

async function runReports() {
  const { getDirectConnection } = await import('./src/config/database.js');
  const conn = await getDirectConnection();

  const results = {};

  // ==== 1. Allowance Detail Report ====
  const ar = await conn.execute(`
    select v.empcode, v.ename,
           (select sum(nvl(ma.OT_HOUR,0)) from HR_MONTHLY_ALLOW ma
             where ma.OLD_EMPCODE=v.empcode and ma.UNIT_ID=v.unitid
               and ma.ALLOWANCE_ID='19' and ma.period# between 48 and 53) ot_hours,
           v.all_id, v.descr, v.amont
      from (
    select a.old_empcode empcode, A.UNIT_ID UNITID,
           ' '||c.name ename, b.allowance_id all_id,
           b.allowance_desc descr,
           sum(nvl(a.trans_amount,0)) amont
      from hr_salary_process_final a, hr_allowance b, hr_emp_master c
     where a.trans_id=b.allowance_id
       and a.old_empcode=c.old_empcode
       and a.unit_id=c.UNIT_ID
       and b.use_allowance='M'
       and a.trans_type='A'
       and a.period# between 48 and 53
       and a.unit_id=1
     group by a.old_empcode, A.UNIT_ID, c.name, b.allowance_id, b.allowance_desc
    ) v order by v.ename, v.empcode`);
  results.allowanceDetail = ar.rows;

  // ==== 2. Deduction Detail Report ====
  const dr = await conn.execute(`
    select a.old_empcode empcode, ' '||c.name ename,
           b.ded_cd, b.ded_desc descr,
           sum(nvl(a.trans_amount,0)) amont
      from hr_salary_process_final a, hr_deduction b, hr_emp_master c
     where a.trans_id=b.ded_cd
       and a.old_empcode=c.old_empcode
       and a.unit_id=c.UNIT_ID
       and b.ded_cd not in (1,10,11,12,13,16,5)
       and a.trans_type='D'
       and a.period# between 48 and 53
       and a.unit_id=1
     group by a.old_empcode, c.name, b.ded_cd, b.ded_desc
     order by ename, empcode`);
  results.deductionDetail = dr.rows;

  // ==== 3. Allowance Recon (period 48 vs 53) ====
  const ar2 = await conn.execute(`
    SELECT v.OLD_EMPCODE, v.UNIT_ID, v.TRANS_ID,
           v.F_AMOUNT, v.T_AMOUNT, v.DIFF,
           (SELECT ' '||MAX(m.NAME) FROM HR_EMP_MASTER m WHERE m.OLD_EMPCODE=v.OLD_EMPCODE AND m.UNIT_ID=v.UNIT_ID) ENAME,
           (SELECT MAX(al.ALLOWANCE_DESC) FROM HR_ALLOWANCE al WHERE al.ALLOWANCE_ID=v.TRANS_ID) DESCR
      FROM (
            SELECT OLD_EMPCODE, UNIT_ID, TRANS_ID,
                   SUM(F_AMOUNT) F_AMOUNT, SUM(T_AMOUNT) T_AMOUNT,
                   SUM(F_AMOUNT)-SUM(T_AMOUNT) DIFF
              FROM (SELECT A.OLD_EMPCODE, A.UNIT_ID, TRANS_ID,
                           ROUND(NVL(TRANS_AMOUNT,0)) F_AMOUNT, 0 T_AMOUNT
                      FROM HR_SALARY_PROCESS_FINAL A, HR_ALLOWANCE B, HR_SALARY_PROCESS_MASTER_FINAL C, HR_LOCATION D
                     WHERE A.PERIOD#=48
                       AND A.UNIT_ID=1
                       AND A.TRANS_TYPE='A' AND B.USE_ALLOWANCE<>'F'
                       AND A.TRANS_ID=B.ALLOWANCE_ID
                       AND A.PERIOD#=C.PERIOD# AND A.UNIT_ID=C.UNIT_ID AND A.OLD_EMPCODE=C.OLD_EMPCODE
                       AND C.LOCATION=D.LOC_ID
                    UNION ALL
                    SELECT A.OLD_EMPCODE, A.UNIT_ID, TRANS_ID,
                           0, ROUND(NVL(TRANS_AMOUNT,0))
                      FROM HR_SALARY_PROCESS_FINAL A, HR_ALLOWANCE B, HR_SALARY_PROCESS_MASTER_FINAL C, HR_LOCATION D
                     WHERE A.PERIOD#=53
                       AND A.UNIT_ID=1
                       AND A.TRANS_TYPE='A' AND B.USE_ALLOWANCE<>'F'
                       AND A.TRANS_ID=B.ALLOWANCE_ID
                       AND A.PERIOD#=C.PERIOD# AND A.UNIT_ID=C.UNIT_ID AND A.OLD_EMPCODE=C.OLD_EMPCODE
                       AND C.LOCATION=D.LOC_ID)
             GROUP BY OLD_EMPCODE, UNIT_ID, TRANS_ID
            HAVING (SUM(F_AMOUNT)!=0 or SUM(T_AMOUNT)!=0)
           ) v ORDER BY DESCR, ENAME`);
  results.allowanceRecon = ar2.rows;

  // ==== 4. Deduction Recon (period 48 vs 53) ====
  const dr2 = await conn.execute(`
    SELECT v.OLD_EMPCODE, v.TRANS_ID, v.DED_DESC DESCR,
           v.F_AMOUNT, v.T_AMOUNT, v.DIFF,
           (SELECT ' '||MAX(m.NAME) FROM HR_EMP_MASTER m WHERE m.OLD_EMPCODE=v.OLD_EMPCODE AND m.UNIT_ID=v.UNIT_ID) ENAME
      FROM (
            SELECT OLD_EMPCODE, UNIT_ID, TRANS_ID, ded_desc,
                   SUM(FROM_AMOUNT) F_AMOUNT, SUM(T_AMOUNT) T_AMOUNT,
                   SUM(FROM_AMOUNT)-SUM(T_AMOUNT) DIFF
              FROM (SELECT A.OLD_EMPCODE, A.UNIT_ID, TRANS_ID, b.ded_desc,
                           NVL(TRANS_AMOUNT,0) FROM_AMOUNT, 0 T_AMOUNT
                      FROM HR_SALARY_PROCESS_FINAL A, hr_deduction B
                     WHERE A.PERIOD#=48 AND A.UNIT_ID=1 AND A.TRANS_TYPE='D' AND A.TRANS_ID=B.DED_CD
                    UNION ALL
                    SELECT A.OLD_EMPCODE, A.UNIT_ID, TRANS_ID, b.ded_desc,
                           0, NVL(TRANS_AMOUNT,0)
                      FROM HR_SALARY_PROCESS_FINAL A, hr_deduction B
                     WHERE A.PERIOD#=53 AND A.UNIT_ID=1 AND A.TRANS_TYPE='D' AND A.TRANS_ID=B.DED_CD)
             GROUP BY OLD_EMPCODE, UNIT_ID, TRANS_ID, ded_desc
           ) v ORDER BY v.DED_DESC, ENAME`);
  results.deductionRecon = dr2.rows;

  // ==== 5. Month-wise Deduction (DED_CD=16 PF-Withdrawal/Loan, periods 48-53) ====
  const mwd = await conn.execute(`
    select a.unit_id, a.old_empcode, ' '||a.name name,
           c.ded_desc, b.period#, d.period_frm, b.trans_amount
      from hr_emp_master a, hr_salary_process_final b, hr_deduction c, hr_attnd_period d
     where a.OLD_EMPCODE=b.old_empcode and a.UNIT_ID=b.unit_id
       and b.trans_id=c.ded_cd and b.trans_type='D'
       and b.period#=d.period# and b.unit_id=d.unit_id
       and b.trans_id='16'
       and a.UNIT_ID=1
       and b.period# between 48 and 53
     order by 1,6,2`);
  results.monthWiseDed = mwd.rows;

  // ==== 6. Bank Advice (period 48, 'IN' type) ====
  const ba = await conn.execute(`
    SELECT A.OLD_EMPCODE, ' '||A.NAME NAME,
           E.LOC_NAME, A.BNKCODE, B.BNKNAME, A.BRNCODE, C.BRNNAME, A.BNKACCT,
           A.GROSS,
           round(SUM(DECODE(D.TRANS_TYPE,'A',NVL(D.TRANS_AMOUNT,0)))) T_ALL,
           round(SUM(DECODE(D.TRANS_TYPE,'D',NVL(D.TRANS_AMOUNT,0)))) T_DED
      FROM HR_EMP_MASTER A, HR_BANK B, HR_BRANCH C, HR_SALARY_PROCESS D, HR_LOCATION E, hr_desg f
     WHERE A.BNKCODE=B.BNKCODE
       AND A.BRNCODE=C.BRNCODE AND A.BNKCODE=C.BNKCODE AND B.BNKCODE=C.BNKCODE
       AND A.OLD_EMPCODE=D.OLD_EMPCODE AND A.UNIT_ID=D.UNIT_ID
       AND A.DESG_CD=F.DESG_CD
       AND D.PERIOD#=53
       AND A.UNIT_ID=1
       AND A.STATUS='A'
       AND NVL(A.HOLD_SAL,'N')='N'
       AND A.LOCATION=E.LOC_ID
     GROUP BY A.OLD_EMPCODE, A.NAME, A.LOCATION, E.LOC_NAME,
              A.BNKCODE, B.BNKNAME, A.BRNCODE, C.BRNNAME, A.BNKACCT, A.GROSS
    HAVING SUM(DECODE(D.TRANS_TYPE,'A',NVL(D.TRANS_AMOUNT,0)))>1
     ORDER BY 8`);
  results.bankAdvice = ba.rows;

  // ==== 7. PF Detail for Zohaib (100002.1) ====
  const pf = await conn.execute(`
    SELECT b.unit_id, B.PERIOD#, b.old_empcode,
           D.ACTUAL_GROSS, D.EARNED_GROSS, D.ACTUAL_BASIC, D.EARNED_BASIC,
           sum(decode(b.trans_id,'12',B.TRANS_AMOUNT,0)) amount, 'S' src
      FROM HR_SALARY_PROCESS_FINAL B, HR_DEDUCTION C, HR_SALARY_PROCESS_MASTER_FINAL D
     WHERE B.TRANS_ID=C.DED_Cd
       AND B.OLD_EMPCODE=D.OLD_EMPCODE AND B.UNIT_ID=D.UNIT_ID AND B.PERIOD#=D.PERIOD#
       AND b.trans_type='D' AND b.unit_id=1
       AND b.old_empcode='100002.1'
     group by b.unit_id, B.PERIOD#, b.old_empcode,
              D.ACTUAL_GROSS, D.EARNED_GROSS, D.ACTUAL_BASIC, D.EARNED_BASIC
     ORDER BY 2`);
  results.pfDetail = pf.rows;

  console.log(JSON.stringify(results, null, 2));
  await conn.close();
  process.exit(0);
}
runReports().catch(e => { console.error(e); process.exit(1); });
