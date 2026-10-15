-- ============================================================================
-- HR_SALARY_PROCES_PRO — PF deduction fix (2026-10-01)
-- ============================================================================
-- Only the PF DEDUCTION block (and A.PF_MEM_DT in the EMPLOYEE cursor) changes:
--   * condition was PF_IND = 'Y' AND EMP_STATUS = '1' (1 = PROBATIONERY), so
--     permanent staff (EMP_STATUS = '2') never had PF deducted;
--     now permanent staff only, EMP_STATUS = '2', from the PF membership date
--     (PF_MEM_DT, else confirmation / appointment date);
--   * amount was basic × 8.33%; now (earned gross − designation FPO) / 1.55 ×
--     8.33% — the same figure the PF ledger (/pf) credits.
-- Takes effect on the next salary process. Rollback:
--   2026-10-01c_salary_proc_pf_fix_ROLLBACK.sql (the procedure as it was).
-- Run in SQL*Plus / SQL Developer as hrms on orclpdb.
-- ============================================================================

CREATE OR REPLACE PROCEDURE Hr_salary_proces_pro (
    munit       NUMBER,
    mpriod      NUMBER,
    Mpriod_frm  DATE,
    Mpriod_to   DATE,
    Mrule_id    NUMBER
) AS
BEGIN
RESIGN_CASE;                                        
ATTENDANCE_UPDATE(munit, mpriod);                   
UPD_CUR_MNTH_ATTND(munit, Mpriod_frm, Mpriod_to); 

    COMMIT;  -- was: forms_ddl('COMMIT')

    DELETE FROM HR_SALARY_PROCESS        WHERE UNIT_ID = MUNIT;
    COMMIT;

    DELETE FROM HR_SALARY_PROCESS_MASTER WHERE UNIT_ID = MUNIT;
    COMMIT;

    DBMS_OUTPUT.PUT_LINE('Process is Running, Please Wait...');

    DECLARE
        /* -- Main employee cursor -- */
        CURSOR EMPLOYEE IS
            SELECT A.OLD_EMPCODE,
                   A.UNIT_ID,
                   A.GROSS,
                   A.BASIC,
                   A.HOUSE_RENT,
                   A.UTILITIES,
                   A.FPO,
                   A.CONV,
                   B.FPO_AMOUNT    FPO_CONV,
                   A.DTOFAPPT,
                   A.PF_IND,
                   A.PF_MEM_DT,
                   A.EOBI_CHK,
                   A.TAX,
                   A.TAX_TYPE,
                   A.EMP_STATUS,
                   A.DTOFBRTH,
                   A.DTOFCONFIRM
              FROM HR_EMP_MASTER_VIEW A,
                   HR_DESG            B
             WHERE A.UNIT_ID = munit
               and a.UNIT_ID = b.compc
               AND A.STATUS  = 'Active'
               AND A.DESG_CD = B.DESG_CD;     -- FIX: missing semicolon was here

        /* -- Working variables -- */
        MDREBATE              NUMBER := 0;
        mD_NOFDAYS            NUMBER := 30;
        P_NOFDAYS             NUMBER := 0;
        P_ACTULDY             NUMBER := 0;
        P_SUP_AMOUNT          NUMBER := 0;
        P_LWP_AMOUNT          NUMBER := 0;
        P_NOFABST             NUMBER := 0;
        P_NWJ_AMOUNT          NUMBER := 0;
        P_MONTHLY_ALLOWANCE   NUMBER := 0;
        P_TOT_EARNING         NUMBER := 0;
        P_TAXABLE_AMOUNT      NUMBER := 0;
        P_TAX_AMOUNT          NUMBER := 0;
        P_INC_FROM_PERIOD     NUMBER := 0;
        P_INC_TO_PERIOD       NUMBER := 0;
        P_INC_AMOUNT          NUMBER := 0;
        P_PREVIOUS_NOFDAY     NUMBER := 0;
        P_PERDAY_RATE         NUMBER := 0;
        P_INCR_DAYS           NUMBER := 0;
        P_INCR_BASIC          NUMBER := 0;
        P_ABSENT_MONTH        NUMBER := 0;
        P_FORECAST_AMOUNT     NUMBER := 0;
        P_PRV_ABS_AMT         NUMBER := 0;
        P_FIX_AMOUNT          NUMBER := 0;
        P_ACCUM_GROSS         NUMBER := 0;
        P_EARN_GROSS          NUMBER := 0;
        P_EARN_GROSS_AUC      NUMBER := 0;
        P_EARN_GROSS_wt       NUMBER := 0;
        P_REMAINIG_MONTH      NUMBER := 0;
        P_ACCUM_TAX           NUMBER := 0;
        P_TAX_AMOUNT60        NUMBER := 0;
        REBATE                NUMBER := 0;
        p_filer               NUMBER := 0;
        p_nonfiler            NUMBER := 0;

    BEGIN
        FOR I IN EMPLOYEE LOOP

            /* -- Commission salary update for contract employees -- */
          --  IF NVL(I.EMP_STATUS, 1) = 2 THEN
                --hr_comm_sal_upd(I.OLD_EMPCODE, Mpriod_frm, Mpriod_to, mpriod);
         --   END IF;

            /* -- Rebate -- */
            BEGIN
                SELECT SUM(t.amont),
                       SUM(t.mnth_rebt)
                  INTO REBATE,
                       MDREBATE
                  FROM hr_rebate_v t
                 WHERE UNIT_ID     = MUNIT
                   AND OLD_EMPCODE = I.OLD_EMPCODE
                   AND t.rule_id   = Mrule_id;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    REBATE   := 0;
                    MDREBATE := 0;
            END;

            /* -- Net working days (Days - Absent) -- */
            BEGIN
                SELECT NVL(DAYS, 0) - NVL(ABSENT, 0)
                  INTO P_NOFDAYS
                  FROM HR_EMP_DAYS
                 WHERE PERIOD#     = mpriod
                   AND UNIT_ID     = MUNIT
                   AND OLD_EMPCODE = I.OLD_EMPCODE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_NOFDAYS := 0;
            END;

            /* -- Actual days -- */
            BEGIN
                SELECT NVL(DAYS, 0)
                  INTO P_ACTULDY
                  FROM HR_EMP_DAYS
                 WHERE PERIOD#     = mpriod
                   AND UNIT_ID     = MUNIT
                   AND OLD_EMPCODE = I.OLD_EMPCODE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_ACTULDY := 0;
            END;

            /* -- Number of absences -- */
            BEGIN
                SELECT NVL(ABSENT, 0)
                  INTO P_NOFABST
                  FROM HR_EMP_DAYS
                 WHERE PERIOD#     = mpriod
                   AND UNIT_ID     = MUNIT
                   AND OLD_EMPCODE = I.OLD_EMPCODE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_NOFABST := 0;
            END;

            /* -- Supplement amount -- */
            BEGIN
                SELECT NVL(SUM(ALLOW_AMOUNT), 0)
                  INTO P_SUP_AMOUNT
                  FROM HR_TRANS_DTL
                 WHERE UNIT_ID     = MUNIT
                   AND OLD_EMPCODE = I.OLD_EMPCODE
                   AND PERIOD#     = mpriod
                   AND DOC_TYPE    = 'S';
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_SUP_AMOUNT := 0;
            END;

            /* -- Increment amount -- */
            BEGIN
                SELECT NVL(SUM(ALLOW_AMOUNT), 0)
                  INTO P_INC_AMOUNT
                  FROM HR_TRANS_DTL
                 WHERE UNIT_ID     = MUNIT
                   AND OLD_EMPCODE = I.OLD_EMPCODE
                   AND PERIOD#     = mpriod
                   AND DOC_TYPE    = 'I';
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_INC_AMOUNT := 0;
            END;

            /* -- New-joining arrear -- */
            BEGIN
                SELECT NVL(SUM(ALLOW_AMOUNT), 0)
                  INTO P_NWJ_AMOUNT
                  FROM HR_TRANS_DTL
                 WHERE UNIT_ID     = MUNIT
                   AND OLD_EMPCODE = I.OLD_EMPCODE
                   AND PERIOD#     = mpriod
                   AND DOC_TYPE    = 'N';
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_NWJ_AMOUNT := 0;
            END;

            /* -- Leave without pay (LWP) -- */
            BEGIN
                SELECT ROUND(SUM((NVL(GROSS, 0) / mD_NOFDAYS) * NVL(P_NOFABST, 0)))
                  INTO P_LWP_AMOUNT
                  FROM HR_EMP_MASTER_VIEW A
                 WHERE A.UNIT_ID     = MUNIT
                   AND A.STATUS      = 'Active'
                   AND A.OLD_EMPCODE = I.OLD_EMPCODE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_LWP_AMOUNT := 0;
            END;

            /* -- Fix allowance (pro-rated to working days) -- */
            BEGIN
                SELECT ROUND(SUM((NVL(AMOUNT, 0) / mD_NOFDAYS) * NVL(P_NOFDAYS, 0)))
                  INTO P_FIX_AMOUNT
                  FROM HR_EMP_ALLOW A
                 WHERE A.OLD_EMPCODE = I.OLD_EMPCODE
                   AND A.UNIT_ID     = I.UNIT_ID
                   AND PROC_FLAG     = 'Y';
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_FIX_AMOUNT := 0;
            END;

            /* -- Monthly allowance -- */
            BEGIN
                SELECT NVL(SUM(AMOUNT), 0)
                  INTO P_MONTHLY_ALLOWANCE
                  FROM HR_MONTHLY_ALLOW
                 WHERE UNIT_ID     = MUNIT
                   AND PERIOD#     = mpriod
                   AND OLD_EMPCODE = I.OLD_EMPCODE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_MONTHLY_ALLOWANCE := 0;
            END;

            /* -- Total earning -- */
            P_TOT_EARNING := NVL(P_MONTHLY_ALLOWANCE, 0)
                           + NVL(P_FIX_AMOUNT, 0)
                           + NVL(P_SUP_AMOUNT, 0)
                           + NVL(P_NWJ_AMOUNT, 0);

            /* -- Earned gross (taxable allowances only) -- */
            BEGIN
                SELECT NVL(SUM(AMOUNT), 0)
                  INTO P_EARN_GROSS
                  FROM HR_MONTHLY_ALLOW A,
                       HR_ALLOWANCE     B
                 WHERE A.ALLOWANCE_ID = B.ALLOWANCE_ID
                   AND A.UNIT_ID      = MUNIT
                   AND PERIOD#        = mpriod
                   AND OLD_EMPCODE    = I.OLD_EMPCODE
                   AND TAXABLE        = 'Y';
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_EARN_GROSS := 0;
            END;

            P_EARN_GROSS     := NVL(P_EARN_GROSS, 0)
                              + NVL(P_FIX_AMOUNT, 0)
                              + NVL(P_INC_AMOUNT, 0)
                              + NVL(P_SUP_AMOUNT, 0)
                              + NVL(P_NWJ_AMOUNT, 0);

            P_EARN_GROSS_wt  := NVL(P_FIX_AMOUNT, 0)
                              + NVL(P_SUP_AMOUNT, 0);

            P_EARN_GROSS_AUC := NVL(P_FIX_AMOUNT, 0)
                              + NVL(P_INC_AMOUNT, 0)
                              + NVL(P_SUP_AMOUNT, 0)
                              + NVL(P_NWJ_AMOUNT, 0);

            /* ----------------------------------------
               INSERT INTO HR_SALARY_PROCESS_MASTER
               ---------------------------------------- */
            INSERT INTO HR_SALARY_PROCESS_MASTER (
                OLD_EMPCODE, UNIT_ID, PERIOD#,
                ACTUAL_GROSS, ACTUAL_BASIC,
                TOTAL_EARNING, EARNED_GROSS, EARNED_BASIC,
                W_DAY, ABSENT_DAYS,
                LOCATION, DEPT_NO, STATUS, EMP_STATUS,
                PF_IND, GRADE_CD, DESG_CD, DEPUT_LOC,
                BNKCODE, BNKACCT, S_CODE, EOBI_CHK,
                REBATE, HOLD_SAL
            )
            SELECT OLD_EMPCODE,
                   UNIT_ID,
                   mpriod,
                   GROSS,
                   BASIC,
                   P_TOT_EARNING,
                   P_EARN_GROSS_AUC,
                   0,
                   P_NOFDAYS,
                   mD_NOFDAYS - P_NOFDAYS,
                   LOCATION,
                   DEPT_NO,
                   STATUS,
                   EMP_STATUS,
                   PF_IND,
                   GRADE_CD,
                   DESG_CD,
                   DEPUT_LOC,
                   BNKCODE,
                   BNKACCT,
                   S_CODE,
                   EOBI_CHK,
                   MDREBATE,
                   HOLD_SAL
              FROM HR_EMP_MASTER
             WHERE OLD_EMPCODE = I.OLD_EMPCODE
               AND UNIT_ID     = MUNIT;

            COMMIT;

            /* ----------------------------------------
               PF DEDUCTION
               PF = (earned gross - designation FPO) / 1.55 x 8.33%,
               i.e. the same figure the PF ledger (Node /pf) credits.
               Permanent members only (PF_IND = 'Y', EMP_STATUS '2' = PERMANENT),
               from the PF membership date (else confirmation / appointment).
               Changed 2026-10-01: was basic x 8.33% for EMP_STATUS = '1'
               (PROBATIONERY) only, which skipped permanent staff.
               ---------------------------------------- */
            IF I.PF_IND = 'Y' AND I.EMP_STATUS = '2' THEN
                IF TO_CHAR(COALESCE(I.PF_MEM_DT, I.DTOFCONFIRM, I.DTOFAPPT), 'YYYYMMDD')
                   <= TO_CHAR(Mpriod_to, 'YYYYMMDD')
                THEN
                    DECLARE
                        P_PF_AMOUNT NUMBER := GREATEST(NVL(P_EARN_GROSS_AUC, 0) - NVL(I.FPO_CONV, 0), 0)
                                              / 1.55 * 0.0833;
                    BEGIN
                        IF P_PF_AMOUNT > 0 AND P_TOT_EARNING - P_PF_AMOUNT >= 0 THEN
                            INSERT INTO HR_SALARY_PROCESS (
                                OLD_EMPCODE, UNIT_ID, PERIOD#,
                                TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                            ) VALUES (
                                I.OLD_EMPCODE, MUNIT, mpriod,
                                12, 'D', P_PF_AMOUNT
                            );
                            P_TOT_EARNING := P_TOT_EARNING - P_PF_AMOUNT;
                        END IF;
                    END;
                END IF;
            END IF;

            /* ----------------------------------------
               FIX (EOBI) DEDUCTIONS
               Only for permanent employees (emp_status = '1')
               ---------------------------------------- */
            IF I.EOBI_CHK = 'Y' AND I.EMP_STATUS = '1' THEN
                DECLARE
                    CURSOR FIX_DEDUCTION IS
                        SELECT OLD_EMPCODE EMPCODE,
                               DED_CODE,
                               AMOUNT,
                               PROC_FLAG
                          FROM HR_EMP_DED
                         WHERE OLD_EMPCODE = I.OLD_EMPCODE
                           AND UNIT_ID     = MUNIT
                           AND PROC_FLAG   = 'Y';
                BEGIN
                    FOR K IN FIX_DEDUCTION LOOP
                        IF P_TOT_EARNING - K.AMOUNT >= 0 THEN
                            /* Skip EOBI (DED_CODE='1') if employee age >= 60 years (720 months) */
                            -- FIX: replaced :B2.D_PERIOD_TO with Mpriod_to parameter
                            IF ROUND(MONTHS_BETWEEN(TO_DATE(Mpriod_to), I.DTOFBRTH)) >= 720
                               AND K.DED_CODE = '1'
                            THEN
                                NULL;  -- No EOBI for employees aged 60+
                            ELSE
                                INSERT INTO HR_SALARY_PROCESS (
                                    OLD_EMPCODE, UNIT_ID, PERIOD#,
                                    TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                                ) VALUES (
                                    I.OLD_EMPCODE, MUNIT, mpriod,
                                    K.DED_CODE, 'D', K.AMOUNT
                                );
                                P_TOT_EARNING := NVL(P_TOT_EARNING, 0) - NVL(K.AMOUNT, 0);
                            END IF;
                        END IF;
                    END LOOP;
                END;
            END IF;

            /* ----------------------------------------
               TAX DEDUCTION  (permanent / salaried employees)
               ---------------------------------------- */

            /* Accumulated earned gross (all previous months this FY + current) */
            BEGIN
                SELECT NVL(SUM(EARNED_GROSS), 0) + NVL(P_EARN_GROSS, 0)
                  INTO P_ACCUM_GROSS
                  FROM HR_SALARY_PROCESS_MASTER_FINAL A,
                       HR_ATTND_PERIOD                B,
                       HR_FINANCIAL_YEAR              C
                 WHERE A.PERIOD#  = B.PERIOD#
                   AND A.UNIT_ID  = B.UNIT_ID
                   AND B.RULE_ID  = C.RULE_ID
                   AND B.UNIT_ID  = C.UNIT_ID
                   AND OLD_EMPCODE = I.OLD_EMPCODE
                   AND C.STATUS   = 'O'
                   AND A.UNIT_ID  = MUNIT;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_ACCUM_GROSS := NVL(P_EARN_GROSS, 0);
            END;

            /* Accumulated income tax paid so far this FY */
            BEGIN
                SELECT NVL(SUM(TRANS_AMOUNT), 0)
                  INTO P_ACCUM_TAX
                  FROM HR_SALARY_PROCESS_FINAL        A,
                       HR_ATTND_PERIOD                B,
                       HR_FINANCIAL_YEAR              C,
                       HR_SALARY_PROCESS_MASTER_FINAL D
                 WHERE A.PERIOD#      = B.PERIOD#
                   AND A.UNIT_ID      = B.UNIT_ID
                   AND B.RULE_ID      = C.RULE_ID
                   AND B.UNIT_ID      = C.UNIT_ID
                   AND A.UNIT_ID      = D.UNIT_ID
                   AND A.OLD_EMPCODE  = D.OLD_EMPCODE
                   AND A.PERIOD#      = D.PERIOD#
                   AND C.STATUS       = 'O'
                   AND TRANS_ID       = 10
                   AND TRANS_TYPE     = 'D'
                   AND A.UNIT_ID      = MUNIT
                   AND A.OLD_EMPCODE  = I.OLD_EMPCODE;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_ACCUM_TAX := 0;
            END;

            /* Remaining months + forecast salary */
            BEGIN
                SELECT ROUND(((TO_DATE - (Mpriod_frm) - 4) / 30)),
                       ROUND(((TO_DATE - (Mpriod_frm) - 4) / 30) - 1) * I.GROSS,
                       filer,
                       nonfiler
                  INTO P_REMAINIG_MONTH,
                       P_FORECAST_AMOUNT,
                       p_filer,
                       p_nonfiler
                  FROM HR_FINANCIAL_YEAR
                 WHERE UNIT_ID = MUNIT
                   AND STATUS  = 'O';
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_FORECAST_AMOUNT := 0;
                    P_REMAINIG_MONTH  := 1;
            END;

            P_TAXABLE_AMOUNT := NVL(P_ACCUM_GROSS, 0) + NVL(P_FORECAST_AMOUNT, 0);

            /* Calculate tax from slab table */
            BEGIN
                SELECT ROUND(
                           (((((P_TAXABLE_AMOUNT - SLAB_DED) *
                               (NVL(SLAB_RATE, 0) / 100))
                              + NVL(FIXED_TAX, 0))
                             - NVL(P_ACCUM_TAX, 0))
                            - NVL(REBATE, 0))
                           / P_REMAINIG_MONTH
                       ),
                       ROUND(
                           ((((P_TAXABLE_AMOUNT - SLAB_DED) *
                              (NVL(SLAB_RATE, 0) / 100))
                             + NVL(FIXED_TAX, 0)) / 2
                            - NVL(P_ACCUM_TAX, 0))
                           / P_REMAINIG_MONTH,
                           2
                       )
                  INTO P_TAX_AMOUNT,
                       P_TAX_AMOUNT60
                  FROM HR_TAX_MST A,
                       HR_TAX_DTL B
                 WHERE A.TAX_ID = B.TAX_ID
                   AND A.STATUS = 'O'
                   AND P_TAXABLE_AMOUNT BETWEEN SLAB_FROM AND SLAB_TO;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN
                    P_TAX_AMOUNT   := 0;
                    P_TAX_AMOUNT60 := 0;
            END;

            /* Deduct tax for permanent/salaried (emp_status != '3') */
            IF P_TOT_EARNING - NVL(P_TAX_AMOUNT, 0) >= 0 THEN
                IF P_TAX_AMOUNT > 0
                   AND I.TAX       = 'Y'
                   AND I.EMP_STATUS != '3'
                THEN
                    INSERT INTO HR_SALARY_PROCESS (
                        OLD_EMPCODE, UNIT_ID, PERIOD#,
                        TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                    ) VALUES (
                        I.OLD_EMPCODE, MUNIT, mpriod,
                        '10', 'D', P_TAX_AMOUNT
                    );
                    P_TOT_EARNING := P_TOT_EARNING - NVL(P_TAX_AMOUNT, 0);
                END IF;
            END IF;

            /* -- Consultant / contract tax (emp_status = '3') -- */
            IF P_TOT_EARNING > 0
               AND I.TAX       = 'Y'
               AND I.EMP_STATUS = '3'
            THEN
                IF I.TAX_TYPE = 'F' THEN
                    P_TAX_AMOUNT := (P_EARN_GROSS * p_filer)   / 100;
                ELSIF I.TAX_TYPE = 'N' THEN
                    P_TAX_AMOUNT := (P_EARN_GROSS * p_nonfiler) / 100;
                END IF;

                INSERT INTO HR_SALARY_PROCESS (
                    OLD_EMPCODE, UNIT_ID, PERIOD#,
                    TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                ) VALUES (
                    I.OLD_EMPCODE, MUNIT, mpriod,
                    '10', 'D', P_TAX_AMOUNT
                );
            END IF;

            /* ----------------------------------------
               MONTHLY DEDUCTIONS
               ---------------------------------------- */
            DECLARE
                CURSOR DEDUCTION IS
                    SELECT DEDUCTION_ID, AMOUNT
                      FROM HR_MONTHLY_DED
                     WHERE OLD_EMPCODE = I.OLD_EMPCODE
                       AND UNIT_ID     = I.UNIT_ID
                       AND PERIOD#     = mpriod;
            BEGIN
                FOR J IN DEDUCTION LOOP
                    IF P_TOT_EARNING - J.AMOUNT >= 0 THEN
                        INSERT INTO HR_SALARY_PROCESS (
                            OLD_EMPCODE, UNIT_ID, PERIOD#,
                            TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                        ) VALUES (
                            I.OLD_EMPCODE, MUNIT, mpriod,
                            J.DEDUCTION_ID, 'D', J.AMOUNT
                        );
                        P_TOT_EARNING := P_TOT_EARNING - NVL(J.AMOUNT, 0);

                    ELSIF J.AMOUNT - P_TOT_EARNING > 0
                          AND NVL(P_TOT_EARNING, 0) >= 0
                    THEN
                        INSERT INTO HR_SALARY_PROCESS (
                            OLD_EMPCODE, UNIT_ID, PERIOD#,
                            TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                        ) VALUES (
                            I.OLD_EMPCODE, MUNIT, mpriod,
                            J.DEDUCTION_ID, 'D', P_TOT_EARNING
                        );
                        P_TOT_EARNING := 0;
                    END IF;
                END LOOP;
            END;

            /* ----------------------------------------
               LOAN DEDUCTIONS
               ---------------------------------------- */
            DECLARE
                CURSOR LOAN IS
                    SELECT LOAN_CD,
                           SUM(INSTALMENT_AMT) INSTALMENT_AMT
                      FROM HR_LOAN_MST
                     WHERE OLD_EMPCODE = I.OLD_EMPCODE
                       AND UNIT_ID     = MUNIT
                       AND NVL(LOAN_AMT, 0) - NVL(LOAN_RECOVER, 0) > 0
                       AND LOAN_INST   = 'Y'
                       AND START_DT    <= Mpriod_to
                     GROUP BY LOAN_CD;
            BEGIN
                FOR M IN LOAN LOOP
                    IF P_TOT_EARNING - M.INSTALMENT_AMT >= 0 THEN
                        INSERT INTO HR_SALARY_PROCESS (
                            OLD_EMPCODE, UNIT_ID, PERIOD#,
                            TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                        ) VALUES (
                            I.OLD_EMPCODE, MUNIT, mpriod,
                            M.LOAN_CD, 'D', M.INSTALMENT_AMT
                        );
                        P_TOT_EARNING := P_TOT_EARNING - NVL(M.INSTALMENT_AMT, 0);

                    ELSIF M.INSTALMENT_AMT - P_TOT_EARNING >= 0
                          AND NVL(P_TOT_EARNING, 0) > 0
                    THEN
                        INSERT INTO HR_SALARY_PROCESS (
                            OLD_EMPCODE, UNIT_ID, PERIOD#,
                            TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                        ) VALUES (
                            I.OLD_EMPCODE, MUNIT, mpriod,
                            M.LOAN_CD, 'D', P_TOT_EARNING
                        );
                        P_TOT_EARNING := 0;
                    END IF;
                END LOOP;
            END;

            /* ----------------------------------------
               FIX ALLOWANCES  (pro-rated to actual days)
               ---------------------------------------- */
            DECLARE
                CURSOR FIX_ALLOWANCE IS
                    SELECT ALLOWANCE_ID,
                           SUM(AMOUNT) AMOUNT
                      FROM (
                            SELECT ALLOWANCE_ID,
                                   (NVL(AMOUNT, 0) / mD_NOFDAYS) * NVL(P_ACTULDY, 0) AMOUNT
                              FROM HR_EMP_ALLOW A
                             WHERE A.OLD_EMPCODE = I.OLD_EMPCODE
                               AND A.UNIT_ID     = I.UNIT_ID
                               AND PROC_FLAG     = 'Y'
                           )
                     GROUP BY ALLOWANCE_ID;
            BEGIN
                FOR L IN FIX_ALLOWANCE LOOP
                    IF L.ALLOWANCE_ID = 2 THEN
                        UPDATE HR_SALARY_PROCESS_MASTER
                           SET EARNED_BASIC = L.AMOUNT
                         WHERE UNIT_ID      = MUNIT
                           AND OLD_EMPCODE  = I.OLD_EMPCODE
                           AND PERIOD#      = mpriod;
                    END IF;

                    INSERT INTO HR_SALARY_PROCESS (
                        OLD_EMPCODE, UNIT_ID, PERIOD#,
                        TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                    ) VALUES (
                        I.OLD_EMPCODE, MUNIT, mpriod,
                        L.ALLOWANCE_ID, 'A', L.AMOUNT
                    );
                END LOOP;
            END;

            /* ----------------------------------------
               MONTHLY ALLOWANCES
               ---------------------------------------- */
            DECLARE
                CURSOR MONTHLY_ALLOWANCE IS
                    SELECT ALLOWANCE_ID,
                           SUM(AMOUNT) AMOUNT
                      FROM HR_MONTHLY_ALLOW
                     WHERE OLD_EMPCODE = I.OLD_EMPCODE
                       AND UNIT_ID     = I.UNIT_ID
                       AND PERIOD#     = mpriod
                     GROUP BY ALLOWANCE_ID;
            BEGIN
                FOR M IN MONTHLY_ALLOWANCE LOOP
                    INSERT INTO HR_SALARY_PROCESS (
                        OLD_EMPCODE, UNIT_ID, PERIOD#,
                        TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                    ) VALUES (
                        I.OLD_EMPCODE, MUNIT, mpriod,
                        M.ALLOWANCE_ID, 'A', M.AMOUNT
                    );
                END LOOP;
            END;

            /* ----------------------------------------
               SPECIAL TRANSACTION LINES
               21 = Supplement   23 = Increment
               24 = New-join     28 = LWP (negative)
               ---------------------------------------- */
            BEGIN
                -- Supplement arrear
                INSERT INTO HR_SALARY_PROCESS (
                    OLD_EMPCODE, UNIT_ID, PERIOD#,
                    TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                ) VALUES (
                    I.OLD_EMPCODE, MUNIT, mpriod,
                    '21', 'A', P_SUP_AMOUNT
                );

                -- New-joining arrear
                INSERT INTO HR_SALARY_PROCESS (
                    OLD_EMPCODE, UNIT_ID, PERIOD#,
                    TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                ) VALUES (
                    I.OLD_EMPCODE, MUNIT, mpriod,
                    '24', 'A', P_NWJ_AMOUNT
                );

                -- Increment arrear
                INSERT INTO HR_SALARY_PROCESS (
                    OLD_EMPCODE, UNIT_ID, PERIOD#,
                    TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                ) VALUES (
                    I.OLD_EMPCODE, MUNIT, mpriod,
                    '23', 'A', P_INC_AMOUNT
                );

                -- Leave without pay (stored as negative)
                INSERT INTO HR_SALARY_PROCESS (
                    OLD_EMPCODE, UNIT_ID, PERIOD#,
                    TRANS_ID, TRANS_TYPE, TRANS_AMOUNT
                ) VALUES (
                    I.OLD_EMPCODE, MUNIT, mpriod,
                    '28', 'A', NVL(P_LWP_AMOUNT, 0) * -1
                );
            END;

        END LOOP;  -- END EMPLOYEE LOOP
    END;

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('Process Has Been Completed Successfully.');

END Hr_salary_proces_pro;
/
