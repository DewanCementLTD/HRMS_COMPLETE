# HRMS / LMS — Database Schema & API Reference

**System:** Dewan Cement HRMS/LMS · **DB:** Oracle (shared with ERP) · **Generated:** 2026‑06‑30

> This document lists every database object the application reads or writes, their columns, how they relate, and the complete REST API surface. The HRMS shares one Oracle schema with the ERP: it **owns** its operational tables and **reads** ERP‑owned tables where the ERP is authoritative.

---

## 1. Service Topology

| Service | Tech | Port | Responsibility |
|---|---|---|---|
| Core API | FastAPI (`main:app`) | 8001 | Auth, HRMS, attendance, payroll, leave, reference, documents, recruitment |
| Face service | FastAPI (`api:app`, InsightFace + FAISS) | 8002 | Face register / verify (1:1) / identify (1:N) |
| Web portal | Next.js (React) | 3000 | HR‑admin + employee self‑service UI |
| Mobile app | Android | — | Face attendance + self‑service |
| Database | Oracle `hrms` schema | 1521 | Single source of truth (HRMS + ERP co‑resident) |

---

## 2. Data Ownership

- **HRMS‑owned (read/write):** `ATTENDANCE_RECORDS`, `EMP_FACE_EMBEDDINGS`, `LOCATION_TRACKS`, all reference/setup tables, `SHIFT_HEAD`, `HR_DOCUMENT`, `APP_VERSION`, the `RECRUITMENT_*` tables, payroll input tables.
- **ERP‑owned (the app mostly READS):** `DUTY_ROSTER` (shift/late/half‑day/early‑out are ERP‑computed; the app only amends a day's shift/remarks), `HR_PAY_REG_V`, `IMPORT_DATA`, and master lookups resolved via `codename()`.
- **Trigger chain (attendance → ERP):**
  `ATTENDANCE_RECORDS` —`TRG_ATTEN_REC_INTO_MACHINE_DATA`→ `MACHINEDATA` —`INSRT_IN_IMP_DATA_AFTR_MCHN_POOL`→ `IMPORT_DATA` → ERP roster.

---

## 3. Key Identifiers & Relationships

| Key | Meaning | Links |
|---|---|---|
| `CARD_NO` | Company‑qualified card, e.g. `100011.3` (empcode `.` unit) | `ATTENDANCE_RECORDS`, `DUTY_ROSTER`, `EMPLOYEE`, `LOCATION_TRACKS`, leave |
| `EMPCODE` / `OLD_EMPCODE` | Employee code (`OLD_EMPCODE` is the payroll/pay‑register key) | `HR_EMP_MASTER`, `RECRUITMENT_*`, `HR_PAY_REG_V` |
| `UNIT_ID` **=** `COMPC` | Company / business unit (e.g. 1 Dewan Cement, 3 Chef & Butler) | filters almost everything |
| `LOCATION` **=** `BRNCH` | Branch (`COM_LOCATION.LCODE`) | employee branch, shift, location scope |
| `DEPT_NO`, `DESG_CD` | **Unique per company** (key = code + `COMPC`); resolve names with `COMPC = UNIT_ID` or `codename()` | `HR_DEPT`, `HR_DESG` |
| `PERIOD#` | Payroll period number | `HR_ATTND_PERIOD`, `HR_PAY_REG_V`, monthly inputs |
| `SHIFT` | Shift code (G/A/B/D/R/X) | `HR_SHIFT` (LOV) → `SHIFT_HEAD` (timings) → `DUTY_ROSTER.ROSTER_SHIFT` |

**Access scoping:** a user's `SEC_USERCMPN` (companies) and `SEC_USERBRCH` (branches) rights are enforced server‑side on every request.

---

## 4. Notable Derived / Virtual Columns

- `ATTENDANCE_RECORDS.IN_DT` / `OUT_DT` — `ENTRY_TIME`/`EXIT_DATE` formatted `DD-MON-YY HH24:MI` (virtual).
- `ATTENDANCE_RECORDS.TOTAL_HOURS` — `TIME_SPENT` as `HH:MM` (virtual).
- `CHECKOUT_LATS/LONGS/ADDRESS` — check‑out location, kept separate from the check‑in location.

---

## 5. Database Schema (tables & columns)

> `NN` = NOT NULL. Types abbreviated. Generated from `USER_TAB_COLUMNS`.

### Employee & Org Master

**HR_EMP_MASTER** _( table, 114 cols )_  
`EMPCODE` VARCHAR2(30) NN · `NAME` VARCHAR2(40) · `FHNAME` VARCHAR2(40) · `ATDTCARD#` VARCHAR2(11) · `RPT_OFFICER` VARCHAR2(30) · `SEX` VARCHAR2(1) · `DTOFBRTH` DATE · `PLACEBRTH` VARCHAR2(15) · `BLDGRP` VARCHAR2(20) · `RELIGION` VARCHAR2(4) · `MARSTAT` VARCHAR2(4) · `NICNO` VARCHAR2(20) · `DTOFAPPT` DATE · `ORG_ID` VARCHAR2(8) · `LOCATION` NUMBER · `DEPT_NO` VARCHAR2(3) · `STATUS` VARCHAR2(1) · `EMP_STATUS` VARCHAR2(2) · `PF_IND` VARCHAR2(1) · `PF_MEM_DT` DATE · `DTOFCONFIRM` DATE · `NTN` VARCHAR2(15) · `GRADE_CD` VARCHAR2(10) · `DESG_CD` VARCHAR2(3) · `DEPUT_LOC` VARCHAR2(4) · `ADDRESS` VARCHAR2(120) · `CNTCODE` VARCHAR2(2) · `STATECD` VARCHAR2(2) · `CITYCD` VARCHAR2(3) · `DISTCD` VARCHAR2(3) · `AREA_CD` VARCHAR2(3) · `PERMADD` VARCHAR2(120) · `PHONE#` VARCHAR2(30) · `EOABI#` VARCHAR2(15) · `SESSI#` VARCHAR2(15) · `BNKCODE` VARCHAR2(3) · `BRNCODE` VARCHAR2(3) · `BNKACCT` VARCHAR2(20) · `MGT_LEVEL` NUMBER · `LAST_PROM_DT` DATE · `DTOFRESIGN` DATE · `RESOFRESIGN` VARCHAR2(50) · `QFICATION` VARCHAR2(30) · `QFICATIONCD` NUMBER · `ORG_NO` VARCHAR2(4) · `BASIC` NUMBER · `PATH` VARCHAR2(200) · `OLD_EMPCODE` VARCHAR2(8) · `SHIFT` VARCHAR2(4) · `GROSS` NUMBER · `S_CODE` VARCHAR2(4) · `EMAIL` VARCHAR2(40) · `L_TRANS_DT` DATE · `COST_CD` VARCHAR2(10) · `LAST_INC_DT` DATE · `L_STATUS_DT` DATE · `TRANS_CO_DT` DATE · `TRANS_CO_NAME` VARCHAR2(8) · `TRANS_TO_CO` VARCHAR2(8) · `DCHK` CHAR(1) · `DPER` NUMBER · `GRAD_AMT` NUMBER · `EOBI_CHK` CHAR(1) · `EOBI_AMT` NUMBER · `PF_AMT` NUMBER · `UNIT_ID` NUMBER NN · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `REBATE` NUMBER · `MAIL_STATS` VARCHAR2(1) · `RESG_DT` DATE · `APT_DT` DATE · `HOLD_SAL` VARCHAR2(1) · `APT_PERIOD` NUMBER · `SEP_PERIOD` NUMBER · `PROBATION` VARCHAR2(4) · `CONFIRM_STATUS` VARCHAR2(10) · `NIC_DATE` DATE · `EMPNO` NUMBER · `SEC_ID` NUMBER · `VEHICLE#` VARCHAR2(20) · `MOBILE#` VARCHAR2(20) · `GRP_INS` VARCHAR2(20) · `HLT_INS` VARCHAR2(20) · `NXT_NAME` VARCHAR2(50) · `NXT_CNIC` VARCHAR2(50) · `NXT_MOBILE` VARCHAR2(50) · `NXT_RELAT` VARCHAR2(50) · `ICE_MOBILE` VARCHAR2(50) · `ICE_NAME` VARCHAR2(50) · `ICE_RELAT` VARCHAR2(50) · `TAX` VARCHAR2(1) · `TAX_TYPE` VARCHAR2(1) · `AUC_DT_OPT` DATE · `TRNS_DT` DATE · `TRNS_TO` VARCHAR2(20) · `FILER` VARCHAR2(2) · `RENEW_DT` DATE · `QFICATION_D` VARCHAR2(500) · `OTAMT` NUMBER · `INCENTIVE_TYPE` VARCHAR2(1) · `USER_PASWD` VARCHAR2(100) · `HOD1` NUMBER · `HOD2` NUMBER · `HOD3` NUMBER · `LEAVE_ALLOW` VARCHAR2(20) · `W_HOUR` NUMBER · `HR_ADMIN` VARCHAR2(1) · `TRACK_LOCATION` VARCHAR2(1) · `TRACK_LOCATION_HR` NUMBER · `LOCATION_FIXED` VARCHAR2(1) · `DEFAULT_LATITUDE` NUMBER · `DEFAULT_LONGITUDE` NUMBER · `MARGIN` NUMBER

**HR_EMP_MASTER_SAL** _( table, 5 cols )_  
`UNIT_ID` NUMBER · `OLD_EMPCODE` VARCHAR2(10) · `GROSS` NUMBER · `BASIC` NUMBER · `PERIOD#` NUMBER

**EMPLOYEE** _( view, 37 cols )_  
`EMP_PK` NUMBER · `ATDTCARD#` VARCHAR2(11) · `CARD_NO` NUMBER · `EMPCODE` VARCHAR2(30) NN · `EMP_NO` VARCHAR2(11) · `EMP_NAME` VARCHAR2(40) · `FATHER_NAME` VARCHAR2(40) · `DATE_OF_BIRTH` DATE · `NIC_NO` VARCHAR2(20) · `NIC_EXP_DATE` VARCHAR2(0) · `EOBI_NO` VARCHAR2(15) · `UIC_CARD_NO` VARCHAR2(15) · `DEPARTMENT` VARCHAR2(50) · `STATUS` VARCHAR2(1) · `ACTIVE` VARCHAR2(3) · `DATE_OF_JOIN` DATE · `TYPE` CHAR(9) · `SALARY` NUMBER · `DATE_OF_LEFT` VARCHAR2(0) · `VACANCY_NO` VARCHAR2(0) · `MANAGER_ABOVE` VARCHAR2(0) · `ORG_ID` NUMBER · `DEPARTMENT_HEAD_FK` VARCHAR2(3) · `REMARKS` VARCHAR2(0) · `DESIGNATION_HEAD_FK` VARCHAR2(3) · `DESIGNATION` VARCHAR2(50) · `MOBILE_NO` VARCHAR2(40) · `ADDRESS` VARCHAR2(120) · `EMAIL_ADDRESS` VARCHAR2(40) · `COMPC` NUMBER · `BRNCH` NUMBER · `LEAVE_ALLOW` VARCHAR2(20) · `LEAVE_LEVEL` VARCHAR2(0) · `USER_PASWD` VARCHAR2(100) · `HOD1` NUMBER · `HOD2` NUMBER · `HOD3` NUMBER

**HR_EMP_MASTER_VIEW** _( view, 70 cols )_  
`OLD_EMPCODE` VARCHAR2(8) · `EMPNO` NUMBER · `UNIT_ID` NUMBER NN · `UNIT_NAME` VARCHAR2(100) NN · `NAME` VARCHAR2(40) · `FHNAME` VARCHAR2(40) · `CONFIRM_STATUS` VARCHAR2(10) · `GROSS` NUMBER · `BASIC` NUMBER · `HOUSE_RENT` NUMBER · `UTILITIES` NUMBER · `FPO` NUMBER · `CONV` NUMBER · `ATDTCARD#` VARCHAR2(11) · `SEX` VARCHAR2(6) · `DTOFBRTH` DATE · `NICNO` VARCHAR2(20) · `DTOFAPPT` DATE · `LOCATION` NUMBER · `LOC_NAME` VARCHAR2(50) NN · `DEPT_NO` VARCHAR2(3) · `DEPT_NAME` VARCHAR2(50) · `DEPT_ABBRV` VARCHAR2(10) · `STATUS` VARCHAR2(8) · `PF_IND` VARCHAR2(1) · `PF_MEM_DT` DATE · `NTN` VARCHAR2(15) · `DESG_CD` VARCHAR2(3) · `DESG_DESC` VARCHAR2(50) · `DESG_ABRV` VARCHAR2(10) · `DESG_GRP` VARCHAR2(2) · `GRADE_CD` VARCHAR2(10) · `ADDRESS` VARCHAR2(120) · `PERMADD` VARCHAR2(120) · `PHONE#` VARCHAR2(30) · `EOABI#` VARCHAR2(15) · `SESSI#` VARCHAR2(15) · `BNKCODE` VARCHAR2(3) · `BRNCODE` VARCHAR2(3) · `BNKACCT` VARCHAR2(20) · `DTOFRESIGN` DATE · `DTOFCONFIRM` DATE · `PROBATION` VARCHAR2(4) · `RESOFRESIGN` VARCHAR2(50) · `EOBI_CHK` CHAR(1) · `EOBI_AMT` NUMBER · `EMP_STATUS` VARCHAR2(2) · `EMP_TYPE` VARCHAR2(30) · `DEPUT_LOC` VARCHAR2(4) · `S_CODE` VARCHAR2(4) · `OTAMT` NUMBER · `MAIL_STATS` VARCHAR2(1) · `REBATE` NUMBER · `EMAIL` VARCHAR2(40) · `TAX` VARCHAR2(1) · `TAX_TYPE` VARCHAR2(1) · `QFICATION` VARCHAR2(30) · `QFICATION_NM` VARCHAR2(30) · `QFICATIONCD` NUMBER · `RPT_OFFCR` VARCHAR2(4000) · `VEHICLE#` VARCHAR2(20) · `MOBILE#` VARCHAR2(20) · `GRP_INS` VARCHAR2(20) · `HLT_INS` VARCHAR2(20) · `SEP_PERIOD` NUMBER · `APT_PERIOD` NUMBER · `USR_DATE_UPD` DATE · `INCEN_CODE` VARCHAR2(1) · `IMG_PTH` VARCHAR2(200) · `INCENTIVE_DESC` VARCHAR2(14)

**HR_DEPT** _( table, 12 cols )_  
`DEPT_NO` NUMBER NN · `DEPT_NAME` VARCHAR2(50) · `ABRV` VARCHAR2(10) · `STR_REQ` NUMBER · `STR_AVL` NUMBER · `COST_CD` VARCHAR2(10) · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `DEPT_INV` NUMBER · `DEPT_MST` NUMBER · `DEPARTMENT_FK` NUMBER · `COMPC` NUMBER NN

**HR_DESG** _( table, 10 cols )_  
`GRADE_CD` VARCHAR2(10) · `DESG_CD` NUMBER NN · `DESG_DESC` VARCHAR2(50) · `DESG_ABRV` VARCHAR2(10) · `DESG_GRP` VARCHAR2(2) · `DESG_ORDER` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `FPO_AMOUNT` NUMBER · `COMPC` NUMBER NN

**HR_GRADE_CD** _( table, 3 cols )_  
`GRADE_CD` VARCHAR2(10) · `DESCR` VARCHAR2(50) · `STATUS` VARCHAR2(1)

**HR_EMP_STATUS** _( table, 8 cols )_  
`EMP_STATUS` VARCHAR2(2) NN · `EMP_STATUS_DESC` VARCHAR2(30) · `EMP_STATUS_ABBR` VARCHAR2(10) · `PROCESS_IN_PROL` VARCHAR2(1) · `RPT_ALLOW` VARCHAR2(10) · `UNIT_ID` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE

**HR_EMP_QUALIFICATION** _( table, 14 cols )_  
`EMPCODE` VARCHAR2(30) · `Q_TYPE` VARCHAR2(3) · `Q_CODE` VARCHAR2(3) · `INST_CD` VARCHAR2(3) · `PASSING_YR` NUMBER · `PASSING_POSITION` VARCHAR2(20) · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `OLD_EMPCODE` VARCHAR2(8) · `DEGREE` VARCHAR2(3) · `QUAL_MAJOR` VARCHAR2(3) · `UNIT_ID` NUMBER · `DESCR` VARCHAR2(200) · `INTITUTE` VARCHAR2(300)

**CADRE** _( table, 6 cols )_  
`CADRE_PK` NUMBER · `CADRE` VARCHAR2(4) · `CARD_NO` NUMBER · `POROMOTION_DATE` DATE · `COMPC` NUMBER · `BRNCH` NUMBER

**BLOOD_GROUP** _( table, 4 cols )_  
`BLOOD_GROUP_PK` NUMBER NN · `BLOOD_GROUP` VARCHAR2(200) · `COMPC` NUMBER · `BRNCH` NUMBER

**UNIT_MST** _( view, 2 cols )_  
`UNIT_ID` VARCHAR2(2) NN · `UNIT_NAME` VARCHAR2(100) NN

**COMPANY_INFO** _( table, 24 cols )_  
`COMPC` VARCHAR2(2) NN · `DESCR` VARCHAR2(100) NN · `MANGR` VARCHAR2(40) · `ADRS1` VARCHAR2(60) · `ADRS2` VARCHAR2(40) · `PHONE` VARCHAR2(80) · `FAXNO` VARCHAR2(40) · `MOBNO` VARCHAR2(40) · `UANOS` VARCHAR2(40) · `EMAIL` VARCHAR2(40) · `NTNNO` VARCHAR2(20) · `GSTNO` VARCHAR2(20) · `EOBNO` VARCHAR2(20) · `SESNO` VARCHAR2(20) · `BDATE` DATE · `STATS` VARCHAR2(1) NN · `SNAME` VARCHAR2(20) · `CIRCL` VARCHAR2(20) · `ZONES` VARCHAR2(20) · `BPASS` VARCHAR2(50) · `B_TNS` VARCHAR2(50) · `PRFIX` VARCHAR2(5) · `TMP_U` VARCHAR2(30) · `IMG` VARCHAR2(100)

**COM_LOCATION** _( table, 57 cols )_  
`LCODE` NUMBER NN · `DESCR` VARCHAR2(50) NN · `USRID` VARCHAR2(6) NN · `SNAME` VARCHAR2(20) · `ORDBY` VARCHAR2(3) · `STATS` VARCHAR2(1) · `OUTYN` VARCHAR2(1) · `RTYPE` VARCHAR2(2) · `REGIONCODE` VARCHAR2(30) · `UNVRF_CUS_INV` NUMBER · `UNVRF_VST_INV` NUMBER · `UNVRF_SLMAN_DY` NUMBER · `UNVRF_SLMAN_COUNT` NUMBER · `UNVRF_VAN_DY` NUMBER · `UNVRF_VAN_COUNT` NUMBER · `UNVRF_SLMAN_DO` NUMBER · `UNVRF_VAN_DO` NUMBER · `W_HIGHT` NUMBER · `W_WIDTH` NUMBER · `W_LENGTH` NUMBER · `DIST_TYPE` VARCHAR2(30) · `TOWNCODE` VARCHAR2(30) · `SYNC_ID` VARCHAR2(50) · `R_TYPE` VARCHAR2(10) · `DEF_CUSTOMER` VARCHAR2(30) · `HOLIDAY_FRI_SUN` VARCHAR2(10) · `DEFLT` VARCHAR2(30) · `CITYCODE` VARCHAR2(30) · `CUSTM` VARCHAR2(50) · `ZONES` VARCHAR2(50) · `SLMAN` VARCHAR2(50) · `SUPMN` VARCHAR2(50) · `VANNO` VARCHAR2(50) · `SAP_CODE` VARCHAR2(30) · `FINOSYS` VARCHAR2(50) · `MERGED` VARCHAR2(50) · `START_DATE` DATE · `LAST_DATE` DATE · `DSTATS` VARCHAR2(1) · `TRANS_STATS` VARCHAR2(1) · `TOWN_TYPE` VARCHAR2(200) · `PERSON_TYPE` VARCHAR2(200) · `PR_CODE` VARCHAR2(30) · `E_MAIL` VARCHAR2(100) · `UNVRF_CUS_COUNT` NUMBER · `UNVRF_VST_COUNT` NUMBER · `BRNCH_MAST` VARCHAR2(1) · `TAX_SS` NUMBER · `GST` NUMBER · `TAX_FUR` NUMBER · `COMPC` NUMBER · `QUOT_EMAIL` VARCHAR2(100) · `QUOT_SERVICE_ADVR` VARCHAR2(100) · `QUOT_TEL` VARCHAR2(100) · `QUOT_FAX` VARCHAR2(100) · `NIC` NUMBER · `CITY` VARCHAR2(20)

**HR_BRANCH** _( table, 8 cols )_  
`BNKCODE` VARCHAR2(3) NN · `BRNCODE` VARCHAR2(3) NN · `BRNNAME` VARCHAR2(30) · `ADDRESS1` VARCHAR2(50) · `ADDRESS2` VARCHAR2(30) · `UNIT_ID` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE

**HR_BANK** _( table, 6 cols )_  
`BNKCODE` VARCHAR2(3) NN · `BNKNAME` VARCHAR2(30) · `BNKABRV` VARCHAR2(10) · `UNIT_ID` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE

### Attendance & Location

**ATTENDANCE_RECORDS** _( table, 29 cols )_  
`ID` NUMBER NN · `EMPCODE` VARCHAR2(30) NN · `ENTRY_TIME` VARCHAR2(20) · `EXIT_TIME` VARCHAR2(20) · `TIME_SPENT` NUMBER · `LONGITUDE` VARCHAR2(50) · `LATITUDE` VARCHAR2(50) · `ATTENDANCE_DATE` DATE NN · `SCREENSHOT_FILENAME` VARCHAR2(255) · `DEVICE_TYPE` VARCHAR2(50) · `CLIENT_IP` VARCHAR2(50) · `DEVICE_INFO` VARCHAR2(400) · `LOCATION_NAME` VARCHAR2(400) · `CARD_NO` VARCHAR2(100) · `ATTENDANCE_TYPE` VARCHAR2(100) · `ACCURACY` VARCHAR2(100) · `ADDRESS` VARCHAR2(100) · `FORMATTED_ADDRESS` VARCHAR2(400) · `TIMESTAMP` VARCHAR2(400) · `DEVICE_ID` VARCHAR2(400) · `DEVICE_MODEL` VARCHAR2(400) · `APP_VERSION` VARCHAR2(400) · `CHECKOUT_LATS` VARCHAR2(50) · `CHECKOUT_LONGS` VARCHAR2(50) · `CHECKOUT_ADDRESS` VARCHAR2(400) · `EXIT_DATE` DATE · `IN_DT` VARCHAR2(30) · `OUT_DT` VARCHAR2(30) · `TOTAL_HOURS` VARCHAR2(20)

**DUTY_ROSTER** _( table, 57 cols )_  
`DUTY_ROSTER_PK` NUMBER NN · `EMP_FK` NUMBER NN · `CARD_NO` NUMBER NN · `ROSTER_DATE` DATE NN · `ROSTER_SHIFT` CHAR(1) · `ROSTER_MONTH` VARCHAR2(20) · `SHIFT_START_TIME` VARCHAR2(20) · `SHIFT_END_TIME` VARCHAR2(20) · `OVERTIME_START_TIME` DATE · `ENTRY_DATE` VARCHAR2(30) · `ENTRY_BY` VARCHAR2(20) · `UPDATED` VARCHAR2(50) · `DAY_NAME` VARCHAR2(20) · `IN_TIME` VARCHAR2(20) · `OUT_TIME` VARCHAR2(20) · `DUTY_HRS` NUMBER · `STATUS` VARCHAR2(100) · `IN_DT_TM` DATE · `OUT_DT_TM` DATE · `IN_DATE` DATE · `OUT_DATE` DATE · `W_HRS` NUMBER · `W_MNT` NUMBER · `OT_HRS` NUMBER · `OT_MNT` NUMBER · `LEAVE_APPLICATION_FK` NUMBER · `HOLIDAY_FK` NUMBER · `ALLOW_IN_TIME` VARCHAR2(20) · `LATE_HRS` NUMBER · `LATE_MNT` NUMBER · `LATE_START_TM_DT` DATE · `ABSENT_DAYS` NUMBER · `ROSTER_REMARKS` VARCHAR2(200) · `SANDWICH` NUMBER · `LEAVE_TYPE_FK` NUMBER · `LEAVE_DAYS` NUMBER · `LEAVE_REMARKS` VARCHAR2(100) · `LATE_FLAG` CHAR(1) · `COMPC` NUMBER NN · `BRNCH` NUMBER NN · `BREAK_OUT` VARCHAR2(20) · `BREAK_IN` VARCHAR2(20) · `BREAK_IN_DT_TM` DATE · `BREAK_OUT_DT_TM` DATE · `BREAK_IN_DT` DATE · `BREAK_OUT_DT` DATE · `SHIFT_UPD` VARCHAR2(20) · `HALF_DAY_TIME` VARCHAR2(20) · `Y_OUT_TIME` VARCHAR2(20) · `LAT_SIT_TM` VARCHAR2(20) · `LAT_SIT_ALLOW_TM` VARCHAR2(20) · `ATT_MRK_TM` VARCHAR2(30) · `HALF_DAY_LATE` CHAR(1) · `HALF_DAY_EARLY_GOING` CHAR(1) · `LATE_FLAG_OUT` CHAR(1) · `CLOSE_DT` DATE · `ABS_EARLY_OUT` VARCHAR2(20)

**MACHINEDATA** _( table, 14 cols )_  
`EMP_CODE` VARCHAR2(10) · `ADATE` VARCHAR2(20) · `HH` VARCHAR2(10) · `MM` VARCHAR2(10) · `STATUS` VARCHAR2(10) · `TERMINAL` VARCHAR2(50) · `POSTED` VARCHAR2(1) · `IP` VARCHAR2(50) · `FILE_FROM` VARCHAR2(50) · `MACHINENUM` VARCHAR2(50) · `COMPC` NUMBER · `BRNCH` NUMBER · `DATA_PK` NUMBER · `SHIFT` VARCHAR2(20)

**IMPORT_DATA** _( table, 17 cols )_  
`IMPORT_DATA_PK` NUMBER NN · `CARD_NO` NUMBER NN · `IN_OUT_DATE` DATE · `IN_OUT_TIME` VARCHAR2(20) · `MACHINE_NO` VARCHAR2(50) · `IN_OUT_NO` NUMBER · `TYPE` VARCHAR2(10) · `D_DATE` DATE · `FILE_NAME` VARCHAR2(50) · `TIME` VARCHAR2(50) · `U_NAME` VARCHAR2(50) · `SHIFT` VARCHAR2(10) · `MACHINE_DATA_FK` NUMBER · `LOG_TIME` VARCHAR2(50) · `COMPC` NUMBER NN · `BRNCH` NUMBER NN · `MACHINE_ID` VARCHAR2(50)

**LOCATION_TRACKS** _( table, 8 cols )_  
`ID` NUMBER NN · `CARD_NO` VARCHAR2(50) NN · `LATITUDE` NUMBER NN · `LONGITUDE` NUMBER NN · `ACCURACY` NUMBER · `RECORDED_AT` TIMESTAMP(6) NN · `SYNCED_AT` TIMESTAMP(6) · `ATTENDANCE_DATE` DATE

**EMP_FACE_EMBEDDINGS** _( table, 7 cols )_  
`EMBEDDING_ID` NUMBER NN · `EMPCODE` VARCHAR2(50) NN · `EMBEDDING_BLOB` BLOB · `EMBEDDING_CLOB` CLOB · `EMBEDDING_DIM` NUMBER · `CREATED_AT` TIMESTAMP(6) · `IS_ACTIVE` CHAR(1)

### Shifts

**SHIFT_HEAD** _( table, 22 cols )_  
`SHIFT_HEAD_PK` NUMBER NN · `SHIFT` CHAR(1) · `SHIFT_DESC` VARCHAR2(20) · `TIME_FROM` VARCHAR2(20) · `TIME_TO` VARCHAR2(20) · `OVERTIME_START_TIME` VARCHAR2(20) · `ALLOW_IN_TIME` VARCHAR2(20) · `LATE_START_TM` VARCHAR2(20) · `COMPC` NUMBER · `BRNCH` NUMBER · `HALF_DAY_TM` VARCHAR2(20) · `LATE_SIT_TM` VARCHAR2(20) · `LATE_SIT_ALLOW_TM` VARCHAR2(20) · `DUTY_HRS` NUMBER · `EARLY_OUT_LATE_START` VARCHAR2(20) · `EARLY_OUT_LATE_END` VARCHAR2(20) · `EARLY_OUT_HDAY_START` VARCHAR2(20) · `EARLY_OUT_HDAY_END` VARCHAR2(20) · `LATE_END_TM` VARCHAR2(20) · `HALF_DAY_END_TM` VARCHAR2(20) · `DAY_NAME` VARCHAR2(20) · `CHANGE_ST` VARCHAR2(20)

**HR_SHIFT** _( table, 3 cols )_  
`SHIFT` VARCHAR2(2) · `DESCR` VARCHAR2(100) · `STATS` VARCHAR2(1)

**EMP_SHIFTIME** _( table, 7 cols )_  
`SHIFT` VARCHAR2(4) NN · `DESCR` VARCHAR2(50) NN · `SNAME` VARCHAR2(20) NN · `STIME` DATE NN · `ETIME` DATE NN · `DUTYS` NUMBER · `ETIME2` VARCHAR2(10)

### Leave

**LEAVE_APPLICATION** _( table, 20 cols )_  
`LEAVE_APPLICATION_PK` NUMBER NN · `LEAVE_DATE_FROM` DATE · `LEAVE_DATE_TO` DATE · `LEAVE_DAYS` NUMBER · `EMP_FK` NUMBER NN · `LEAVE_TYPE_FK` NUMBER · `REASON` VARCHAR2(200) · `APPROVAL_STATUS` VARCHAR2(20) · `APPROVAL_DATE` DATE · `ENTRY_DATE` VARCHAR2(30) · `ENTRY_BY` VARCHAR2(30) · `PREVIOUS_BALANCE` NUMBER · `YEAR` NUMBER · `BALANCE` NUMBER · `HRS` NUMBER · `COMPC` NUMBER NN · `BRNCH` NUMBER NN · `TR_DATE` DATE · `TR_TYPE` VARCHAR2(20) · `LEAVE_APPLICATION_APPLY_FK` NUMBER

**ALL_LEAVE_BAL_V** _( view, 16 cols )_  
`EMP_PK` NUMBER · `CARD_NO` NUMBER · `EMP_NAME` VARCHAR2(40) · `YEAR` NUMBER · `COMPC` NUMBER · `BRNCH` NUMBER · `LEAVE_TYPE_PK` NUMBER NN · `LEAVE_TYPE` VARCHAR2(20) · `LEAVE_DESC` VARCHAR2(50) · `PREVIOUS_BAL` NUMBER · `NEW_ENTITLED` NUMBER · `TOTAL` NUMBER · `ALLOWD` NUMBER · `TOTAL_AVAILABLE` NUMBER · `AVAILED` NUMBER · `BALANCE` NUMBER

### Payroll

**HR_FINANCIAL_YEAR** _( table, 14 cols )_  
`RULE_ID` NUMBER NN · `FROM_DATE` DATE · `TO_DATE` DATE · `STATUS` VARCHAR2(1) · `UNIT_ID` NUMBER NN · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `SCODE` VARCHAR2(20) · `DESCR` VARCHAR2(100) · `RATE` NUMBER · `INTRST` NUMBER · `F_DAY` NUMBER · `FILER` NUMBER · `NONFILER` NUMBER

**HR_ATTND_PERIOD** _( table, 11 cols )_  
`RULE_ID` NUMBER · `PERIOD#` NUMBER NN · `PERIOD_FRM` DATE · `PERIOD_TO` DATE · `STATUS` VARCHAR2(1) · `BLOCK_FLAG` CHAR(1) · `UNIT_ID` NUMBER NN · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `P_DAYS` NUMBER · `SCODE` VARCHAR2(10)

**HR_TAX_MST** _( table, 6 cols )_  
`TAX_ID` NUMBER · `TAX_DESC` VARCHAR2(50) · `FYEAR` VARCHAR2(4) · `USER_ID_UPD` VARCHAR2(2) · `USER_DATE_UPD` DATE · `STATUS` VARCHAR2(1)

**HR_TAX_DTL** _( table, 11 cols )_  
`TAX_ID` NUMBER · `SRNO` NUMBER · `SLAB_FROM` NUMBER · `SLAB_TO` NUMBER · `SLAB_RATE` NUMBER · `DATE_FROM` DATE · `DATE_TO` DATE · `SLAB_DED` NUMBER · `FIXED_TAX` NUMBER · `USER_ID_UPD` VARCHAR2(2) · `USER_DATE_UPD` DATE

**HR_LOAN_TYPE** _( table, 4 cols )_  
`LOAN_CD` VARCHAR2(3) NN · `LOAN_DESC` VARCHAR2(40) · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE

**HR_LOAN_MST** _( table, 19 cols )_  
`DOC#` NUMBER NN · `DOC_DT` DATE · `UNIT_ID` NUMBER NN · `OLD_EMPCODE` VARCHAR2(8) · `LOAN_CD` VARCHAR2(3) · `LOAN_DATE` DATE · `LOAN_AMT` NUMBER · `LOAN_RECOVER` NUMBER · `INSTALMENT_AMT` NUMBER · `NOF_INSTALMENT` NUMBER · `START_DT` DATE · `CHARGE_INT` VARCHAR2(1) · `INT_RATE` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `REMARKS` VARCHAR2(50) · `LOAN_INST` VARCHAR2(1) · `CHQ_NO` VARCHAR2(50) · `CHQ_DT` DATE

**HR_LOAN_RECOVERY** _( table, 11 cols )_  
`DOC#` NUMBER · `PERIOD#` NUMBER · `RECOVERD_AMT` NUMBER · `RECOVERY_TYPE` VARCHAR2(1) · `INT_RATE_REC` NUMBER · `UNIT_ID` NUMBER · `BALANCE_AMT` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `REMARKS` VARCHAR2(50) · `OLD_EMPCODE` VARCHAR2(8)

**HR_ALLOWANCE** _( table, 29 cols )_  
`ALLOWANCE_ID` VARCHAR2(3) NN · `ALLOWANCE_DESC` VARCHAR2(40) · `INCL_PAY` VARCHAR2(1) · `TAXABLE` VARCHAR2(1) · `LIMIT` NUMBER · `INCL_EOBI` VARCHAR2(1) · `INCL_SESSI` VARCHAR2(1) · `INCL_MEDICAL` VARCHAR2(1) · `ABRV` VARCHAR2(10) · `PC_FLAG` VARCHAR2(1) · `INCL_BONUS` VARCHAR2(1) · `INCL_LCASH` VARCHAR2(1) · `ORG_NO` CHAR(1) · `INCL_OVERTIME` VARCHAR2(1) · `VD_ACC_CODE` VARCHAR2(15) · `VD_DR_CR` VARCHAR2(1) · `VD_PART` VARCHAR2(40) · `INCL_GROSS` VARCHAR2(1) · `INCL_HEAD` VARCHAR2(3) · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `ALLOWANCE_TYPE` NUMBER · `USE_ALLOWANCE` VARCHAR2(1) · `DISP_ORDER` NUMBER · `SEQ` NUMBER · `GRUP` NUMBER · `EARNED_GROSS` VARCHAR2(3) · `PAY_SEQ` NUMBER · `COL_NM` VARCHAR2(100)

**HR_DEDUCTION** _( table, 18 cols )_  
`DED_CD` VARCHAR2(3) NN · `DED_DESC` VARCHAR2(30) · `DED_ABRV` VARCHAR2(10) · `DED_ORDER` NUMBER · `FLAG` CHAR(1) · `VD_ACC_CODE` VARCHAR2(15) · `VD_DR_CR` VARCHAR2(1) · `VD_PART` VARCHAR2(40) · `INCL_HEAD` VARCHAR2(3) · `UNIT_ID` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `DED_TYPE` NUMBER · `DISP_ORDER` NUMBER · `SEQ` NUMBER · `GRUP` NUMBER · `PAY_SEQ` NUMBER · `COL_NM` VARCHAR2(100)

**HR_MONTHLY_ALLOW** _( table, 13 cols )_  
`OLD_EMPCODE` VARCHAR2(8) NN · `ALLOWANCE_ID` VARCHAR2(3) NN · `AMOUNT` NUMBER · `PERIOD#` NUMBER NN · `UNIT_ID` NUMBER NN · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `OT_HOUR` NUMBER · `REMARKS` VARCHAR2(50) · `ENTITLEMENT` NUMBER · `CLAIM` NUMBER · `BALANCE` NUMBER · `RULE_ID` NUMBER NN

**HR_MONTHLY_DED** _( table, 10 cols )_  
`OLD_EMPCODE` VARCHAR2(8) NN · `DEDUCTION_ID` VARCHAR2(3) NN · `AMOUNT` NUMBER · `PERIOD#` NUMBER NN · `UNIT_ID` NUMBER NN · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `REMARKS` VARCHAR2(50) · `RECOVERD_AMT` NUMBER · `VM_VNO` NUMBER

**HR_ABSENT_DAYS** _( table, 7 cols )_  
`OLD_EMPCODE` VARCHAR2(8) NN · `UNIT_ID` NUMBER NN · `PERIOD#` NUMBER NN · `ABSENT_DAYS` NUMBER · `USR_ID_UPD` VARCHAR2(2) · `USR_DATE_UPD` DATE · `DUMY_DAYS` NUMBER

**HR_SALARY_PROCESS_MASTER** _( table, 27 cols )_  
`OLD_EMPCODE` VARCHAR2(8) NN · `UNIT_ID` NUMBER NN · `PERIOD#` NUMBER NN · `ACTUAL_GROSS` NUMBER · `ACTUAL_BASIC` NUMBER · `EARNED_GROSS` NUMBER · `EARNED_BASIC` NUMBER · `W_DAY` NUMBER · `ABSENT_DAYS` NUMBER · `LOCATION` VARCHAR2(2) · `DEPT_NO` VARCHAR2(3) · `STATUS` VARCHAR2(1) · `EMP_STATUS` VARCHAR2(2) · `PF_IND` VARCHAR2(1) · `GRADE_CD` VARCHAR2(10) · `DESG_CD` VARCHAR2(3) · `DEPUT_LOC` VARCHAR2(4) · `BNKCODE` NUMBER · `BNKACCT` VARCHAR2(20) · `S_CODE` VARCHAR2(4) · `EOBI_CHK` CHAR(1) · `REBATE` NUMBER · `TOTAL_EARNING` NUMBER · `HOLD_SAL` VARCHAR2(1) · `OTAMT` NUMBER · `SAL` NUMBER · `TOTSAL` NUMBER

**HR_PAY_REG_V** _( view, 19 cols )_  
`RTYP` CHAR(5) · `TRANS_TYPE` VARCHAR2(1) · `PAY_SEQ` NUMBER · `PERIOD#` NUMBER · `UNIT_ID` NUMBER · `OLD_EMPCODE` VARCHAR2(8) · `W_DAY` NUMBER · `ABSENT_DAYS` NUMBER · `ACTUAL_GROSS` NUMBER · `ACTUAL_BASIC` NUMBER · `EARNED_GROSS` NUMBER · `EARNED_BASIC` NUMBER · `HOLD_SAL` VARCHAR2(1) · `LOCATION` VARCHAR2(2) · `DESG_CD` VARCHAR2(3) · `DEPT_NO` VARCHAR2(3) · `TRANS_ID` VARCHAR2(3) · `DESCR` VARCHAR2(40) · `AMONT` NUMBER

### Security / Access

**SEC_USERNAME** _( table, 28 cols )_  
`COMPC` VARCHAR2(2) NN · `USRID` VARCHAR2(2) NN · `DESCR` VARCHAR2(40) NN · `ULEVL` VARCHAR2(1) NN · `DESIG` VARCHAR2(40) · `PASWD` VARCHAR2(100) NN · `PDATE` DATE NN · `LOCKL` NUMBER NN · `CONTR` NUMBER · `STATS` VARCHAR2(1) · `FTIME` DATE · `TTIME` DATE · `SCREN` VARCHAR2(1) · `PLIFE` NUMBER · `EXPDT` DATE NN · `DCODE` VARCHAR2(3) · `VER_#` VARCHAR2(25) NN · `WEBLG` VARCHAR2(3) · `BRNCH` VARCHAR2(3) · `ECODE` VARCHAR2(10) · `MOBILE` NUMBER · `DEPT_M` NUMBER · `HOD` VARCHAR2(2) · `QUOT_EMAIL` VARCHAR2(100) · `QUOT_SERVICE_ADVR` VARCHAR2(100) · `QUOT_TEL` VARCHAR2(100) · `QUOT_FAX` VARCHAR2(100) · `HOD2` VARCHAR2(2)

**SEC_USERCMPN** _( table, 2 cols )_  
`USRID` VARCHAR2(3) · `COMPC` VARCHAR2(2)

**SEC_USERBRCH** _( table, 2 cols )_  
`USRID` VARCHAR2(10) · `BRNCH` VARCHAR2(10)

### Recruitment

**RECRUITMENT_JOBS** _( table, 12 cols )_  
`JOB_ID` NUMBER NN · `JOB_TITLE` VARCHAR2(200) NN · `DEPT_NO` NUMBER · `OPEN_POSITIONS` NUMBER · `JOB_DESC` VARCHAR2(4000) · `SKILLS_REQ` VARCHAR2(2000) · `STATUS` VARCHAR2(20) · `CREATED_BY` VARCHAR2(50) · `CREATED_AT` DATE · `UPDATED_AT` DATE · `COMPC` NUMBER · `BRNCH` NUMBER

**RECRUITMENT_APPLICATIONS** _( table, 10 cols )_  
`APP_ID` NUMBER NN · `JOB_ID` NUMBER NN · `CANDIDATE_NAME` VARCHAR2(200) NN · `MOBILE` VARCHAR2(20) · `EMAIL` VARCHAR2(200) · `SOURCE` VARCHAR2(100) · `APP_DATE` DATE · `STATUS` VARCHAR2(20) · `NOTES` VARCHAR2(1000) · `CREATED_AT` DATE

**RECRUITMENT_INTERVIEWS** _( table, 8 cols )_  
`INTERVIEW_ID` NUMBER NN · `APP_ID` NUMBER NN · `INTERVIEW_DATE` DATE · `INTERVIEW_TYPE` VARCHAR2(50) · `INTERVIEWER` VARCHAR2(200) · `STATUS` VARCHAR2(20) · `FEEDBACK` VARCHAR2(2000) · `CREATED_AT` DATE

**RECRUITMENT_OFFERS** _( table, 7 cols )_  
`OFFER_ID` NUMBER NN · `APP_ID` NUMBER NN · `OFFER_DATE` DATE · `SALARY_OFFERED` NUMBER · `STATUS` VARCHAR2(20) · `NOTES` VARCHAR2(1000) · `CREATED_AT` DATE

### Documents & App

**HR_DOCUMENT** _( table, 7 cols )_  
`DOC_ID` NUMBER NN · `OLD_EMPCODE` VARCHAR2(20) NN · `UNIT_ID` NUMBER NN · `D_TYPE` VARCHAR2(10) NN · `D_PATH` VARCHAR2(500) · `REMRK` VARCHAR2(500) · `IMG_NM` VARCHAR2(500)

**APP_VERSION** _( table, 10 cols )_  
`VERSN` VARCHAR2(100) · `PLATFORM` VARCHAR2(20) · `MIN_VERSION` VARCHAR2(100) · `LATEST_VERSION` VARCHAR2(100) · `MIN_BUILD` NUMBER · `LATEST_BUILD` NUMBER · `UPDATE_URL` VARCHAR2(400) · `FORCE_MESSAGE` VARCHAR2(400) · `SOFT_MESSAGE` VARCHAR2(400) · `UPDATED_AT` DATE

---

## 6. API Reference — endpoints (parameters, body & response)

Conventions:
- Most admin endpoints also accept `admin_card_no` (requesting HR admin) and optional `compc` / `brnch` query params; these are omitted below only where not present.
- Where an endpoint declares no response model, the response is plain JSON — typically `{ "items": [...] }` for lists, `{ "body": {...} }` for self‑service reads, or the domain object/`{ "status", "message" }` for writes.
- `req` = required, `opt` = optional. Types are from the OpenAPI schema.

### App Version

#### `GET` /app/download/latest
- **Response 200:** JSON

#### `GET` /app/version-check
- **Query:** `platform` string (opt), `version` string (opt), `build` integer (opt)
- **Response 200:** JSON

### Attendance

#### `POST` /auth/attendance/face
- **Body** (FaceAttendanceRequest):
    - `card_no` string (req)
    - `attendance_type` string (req)
    - `latitude` number (opt)
    - `longitude` number (opt)
    - `accuracy` number (opt)
    - `address` string (opt)
    - `formatted_address` string (opt)
    - `timestamp` string (opt)
    - `device_id` string (opt)
    - `device_model` string (opt)
    - `app_version` string (opt)
    - `app_build` integer (opt)
- **Response 200:** JSON

#### `GET` /auth/attendance/report-range/{card_no}
- **Path:** `card_no` string
- **Query:** `from_date` string (req), `to_date` string (req)
- **Response 200:** JSON

#### `GET` /auth/attendance/report/{card_no}/{date_str}
- **Path:** `card_no` string, `date_str` string
- **Response 200:** JSON

#### `GET` /auth/attendance/summary
- **Query:** `emp_pk` string (req), `from_date` string (req), `to_date` string (req)
- **Response 200:** JSON

#### `POST` /auth/attendance/{card_no}
- **Path:** `card_no` string
- **Body** (AttendanceRequest):
    - `latitude` number (opt)
    - `longitude` number (opt)
- **Response 200** (AttendanceResponse):
    - `status` string (req)
    - `message` string (req)

### Authentication

#### `POST` /auth/apply-leave/{card_no}
- **Path:** `card_no` string
- **Body** (LeaveApplyRequest):
    - `type` string (opt)
    - `leave_type_id` integer (opt)
    - `from_date` string (req)
    - `to_date` string (req)
    - `reason` string (req)
    - `half_day` boolean (opt)
    - `compc` integer (opt)
    - `brnch` integer (opt)
    - `emp_name` string (opt)
- **Response 200** (MessageResponse):
    - `status` string (req)
    - `message` string (req)

#### `POST` /auth/change-password/{card_no}
- **Path:** `card_no` string
- **Body** (ChangePasswordRequest):
    - `old_password` string (req)
    - `new_password` string (req)
- **Response 200** (MessageResponse):
    - `status` string (req)
    - `message` string (req)

#### `GET` /auth/dashboard/{card_no}
- **Path:** `card_no` string
- **Response 200** (DashboardResponse):
    - `emp_pk` number (opt)
    - `card_no` string (req)
    - `emp_no` string (opt)
    - `emp_name` string (req)
    - `date_of_join` string (opt)
    - `nic_no` string (opt)
    - `designation` string (opt)
    - `department` string (opt)
    - `compcnm` string (opt)
    - `compc` number (opt)
    - `branch` number (opt)
    - `brnchnm` string (opt)
    - `hod` number (opt)
    - `hod_nm` string (opt)
    - `balance` number (opt)

#### `GET` /auth/leave-balances/{card_no}
- **Path:** `card_no` string
- **Response 200:** JSON

#### `GET` /auth/leave-status/{card_no}
- **Path:** `card_no` string
- **Response 200:** JSON

#### `POST` /auth/login
- **Body** (LoginRequest):
    - `username` string (req)
    - `password` string (req)
    - `app_version` string (opt)
    - `app_build` integer (opt)
    - `platform` string (opt)
- **Response 200** (LoginResponse):
    - `status` string (req)
    - `card_no` string (req)
    - `emp_name` string (opt)
    - `face_registered` boolean (opt)
    - `hr_admin` boolean (opt)
    - `has_self_service` boolean (opt)
    - `has_employee_features` boolean (opt)
    - `allowed_companies` string[] (opt)
    - `allowed_branches` string[] (opt)
    - `company_list` CompanyItem[] (opt)
    - `branch_list` BranchItem[] (opt)
    - `can_edit_salary` boolean (opt)

#### `GET` /auth/lookup/{phone}
- **Path:** `phone` string
- **Response 200:** JSON

#### `GET` /auth/profile/{card_no}
- **Path:** `card_no` string
- **Response 200** (ProfileResponse):
    - `emp_name` string (req)
    - `department` string (req)
    - `designation` string (req)
    - `email_address` string (req)
    - `mobile_no` string (req)
    - `date_of_birth` string (req)
    - `date_of_join` string (req)
    - `father_name` string (req)
    - `nic_no` string (req)

### Employee Documents

#### `GET` /documents
- **Query:** `empcode` string (req), `admin_card_no` string (req)
- **Response 200:** JSON

#### `POST` /documents
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `GET` /documents/company-logo
- **Query:** `compc` string (req)
- **Response 200:** JSON

#### `POST` /documents/company-logo
- **Query:** `admin_card_no` string (req), `compc` string (req)
- **Response 200:** JSON

#### `GET` /documents/employee-photo
- **Query:** `admin_card_no` string (req), `empcode` string (req)
- **Response 200:** JSON

#### `POST` /documents/employee-photo
- **Query:** `admin_card_no` string (req), `empcode` string (req)
- **Response 200:** JSON

#### `GET` /documents/my-photo
- **Query:** `card_no` string (req)
- **Response 200:** JSON

#### `POST` /documents/my-photo
- **Query:** `card_no` string (req)
- **Response 200:** JSON

#### `DELETE` /documents/{doc_id}
- **Path:** `doc_id` integer
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `GET` /documents/{doc_id}/download
- **Path:** `doc_id` integer
- **Query:** `admin_card_no` string (req), `inline` boolean (opt)
- **Response 200:** JSON

### Face Authentication

#### `DELETE` /face/delete/{card_no}
- **Path:** `card_no` string
- **Response 200:** JSON

#### `POST` /face/identify
- **Body** (FaceIdentifyRequest):
    - `frames` string[] (req)
- **Response 200:** JSON

#### `POST` /face/register
- **Body** (FaceRegisterRequest):
    - `card_no` string (req)
    - `frames` string[] (req)
    - `created_at` string (opt)
- **Response 200:** JSON

#### `GET` /face/status/{card_no}
- **Path:** `card_no` string
- **Response 200:** JSON

#### `POST` /face/verify
- **Body** (FaceVerifyRequest):
    - `card_no` string (req)
    - `frames` string[] (req)
- **Response 200:** JSON

### HR Admin

#### `GET` /hr/employees/search
- **Query:** `q` string (req), `admin_card_no` string (req)
- **Response 200:** JSON

#### `POST` /hr/face/enroll
- **Query:** `admin_card_no` string (req)
- **Body** (HRFaceEnrollRequest):
    - `card_no` string (req)
    - `frames` string[] (req)
    - `created_at` string (opt)
- **Response 200:** JSON

### HRMS

#### `GET` /hrms/attendance/bulk
- **Query:** `admin_card_no` string (req), `from_date` string (req), `to_date` string (req), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /hrms/attendance/details
- **Query:** `admin_card_no` string (req), `from_date` string (req), `to_date` string (req), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /hrms/dashboard
- **Query:** `admin_card_no` string (req), `date` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /hrms/dashboard/analytics
- **Query:** `admin_card_no` string (req), `date` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `PUT` /hrms/duty-roster/entry/{pk}
- **Path:** `pk` integer
- **Query:** `admin_card_no` string (req)
- **Body** (RosterEntryUpdate):
    - `shift` string (opt)
    - `remarks` string (opt)
- **Response 200:** JSON

#### `GET` /hrms/duty-roster/{card_no}
- **Path:** `card_no` string
- **Query:** `admin_card_no` string (req), `month` string (opt)
- **Response 200:** JSON

#### `GET` /hrms/employees
- **Query:** `admin_card_no` string (req), `status` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /hrms/employees
- **Query:** `admin_card_no` string (req)
- **Body** (EmployeeCreateRequest):
    - `name` string (req)
    - `fhname` string (opt)
    - `atdtcard` string (opt)
    - `sex` string (opt)
    - `dtofbrth` string (opt)
    - `nicno` string (opt)
    - `dtofappt` string (opt)
    - `dept_no` string (opt)
    - `desg_cd` string (opt)
    - `mobile` string (opt)
    - `email` string (opt)
    - `address` string (opt)
    - `unit_id` integer (opt)
    - `status` string (opt)
    - `user_paswd` string (opt)
    - `hr_admin` string (opt)
    - `rpt_officer` string (opt)
    - `marstat` string (opt)
    - `grade_cd` string (opt)
    - `religion` string (opt)
    - `hod1` integer (opt)
    - `hod2` integer (opt)
    - `hod3` integer (opt)
    - `basic` number (opt)
    - `gross` number (opt)
    - `shift` string (opt)
    - `w_hour` number (opt)
    - `bldgrp` string (opt)
    - `location` string (opt)
    - `emp_status` string (opt)
    - `ntn` string (opt)
    - `bnkcode` string (opt)
    - `brncode` string (opt)
    - `bnkacct` string (opt)
    - `qfication` string (opt)
    - `qual_detail` string (opt)
    - `dtofconfirm` string (opt)
- **Response 200** (MessageResponse):
    - `status` string (req)
    - `message` string (req)
    - `empcode` string (opt)

#### `GET` /hrms/employees/search
- **Query:** `q` string (req), `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /hrms/employees/{empcode}
- **Path:** `empcode` string
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `PUT` /hrms/employees/{empcode}
- **Path:** `empcode` string
- **Query:** `admin_card_no` string (req)
- **Body** (EmployeeUpdateRequest):
    - `name` string (opt)
    - `fhname` string (opt)
    - `atdtcard` string (opt)
    - `sex` string (opt)
    - `dtofbrth` string (opt)
    - `nicno` string (opt)
    - `dtofappt` string (opt)
    - `dept_no` string (opt)
    - `desg_cd` string (opt)
    - `mobile` string (opt)
    - `email` string (opt)
    - `address` string (opt)
    - `unit_id` integer (opt)
    - `status` string (opt)
    - `user_paswd` string (opt)
    - `hr_admin` string (opt)
    - `rpt_officer` string (opt)
    - `marstat` string (opt)
    - `grade_cd` string (opt)
    - `religion` string (opt)
    - `hod1` integer (opt)
    - `hod2` integer (opt)
    - `hod3` integer (opt)
    - `basic` number (opt)
    - `gross` number (opt)
    - `shift` string (opt)
    - `w_hour` number (opt)
    - `bldgrp` string (opt)
    - `location` string (opt)
    - `track_location` string (opt)
    - `track_location_hr` integer (opt)
    - `emp_status` string (opt)
    - `ntn` string (opt)
    - `bnkcode` string (opt)
    - `brncode` string (opt)
    - `bnkacct` string (opt)
    - `qfication` string (opt)
    - `qual_detail` string (opt)
    - `dtofconfirm` string (opt)
- **Response 200** (MessageResponse):
    - `status` string (req)
    - `message` string (req)
    - `empcode` string (opt)

#### `GET` /hrms/employees/{empcode}/card
- **Path:** `empcode` string
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

### Location Tracking

#### `POST` /auth/location/batch
- **Body** (LocationBatchRequest):
    - `card_no` string (req)
    - `locations` LocationPoint[] (req)
- **Response 200:** JSON

#### `GET` /auth/location/history/{card_no}
- **Path:** `card_no` string
- **Query:** `date` string (req), `admin_card_no` string (req)
- **Response 200:** JSON

#### `GET` /auth/location/report/summary
- **Query:** `from_date` string (req), `to_date` string (req), `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt), `dept_no` string (opt), `desg_cd` string (opt), `empcodes` string (opt), `region` string (opt), `category` string (opt)
- **Response 200:** JSON

#### `GET` /auth/location/report/trail
- **Query:** `from_date` string (req), `to_date` string (req), `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt), `dept_no` string (opt), `desg_cd` string (opt), `empcodes` string (opt), `region` string (opt), `category` string (opt)
- **Response 200:** JSON

#### `GET` /auth/location/summary
- **Query:** `date` string (req), `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /location-tracking/active-employees
- **Response 200:** JSON

#### `GET` /location-tracking/geofence/{emp_code}
- **Path:** `emp_code` string
- **Response 200:** JSON

#### `GET` /location-tracking/settings/{emp_code}
- **Path:** `emp_code` string
- **Response 200:** JSON

#### `POST` /location-tracking/settings/{emp_code}/update
- **Path:** `emp_code` string
- **Query:** `track_location` string (req), `track_location_hr` integer (opt), `admin_card_no` string (req)
- **Response 200:** JSON

#### `GET` /location-tracking/statistics
- **Response 200:** JSON

### Payroll

#### `GET` /payroll/financial-years
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `POST` /payroll/financial-years
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (FinancialYearRequest):
    - `from_date` string (req)
    - `to_date` string (req)
    - `scode` string (opt)
    - `descr` string (opt)
    - `rate` number (opt)
    - `intrst` number (opt)
    - `filer` number (opt)
    - `nonfiler` number (opt)
    - `auto_periods` boolean (opt)
- **Response 200:** JSON

#### `PUT` /payroll/financial-years/{rule_id}
- **Path:** `rule_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (FinancialYearRequest):
    - `from_date` string (req)
    - `to_date` string (req)
    - `scode` string (opt)
    - `descr` string (opt)
    - `rate` number (opt)
    - `intrst` number (opt)
    - `filer` number (opt)
    - `nonfiler` number (opt)
    - `auto_periods` boolean (opt)
- **Response 200:** JSON

#### `PATCH` /payroll/financial-years/{rule_id}/status
- **Path:** `rule_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (StatusRequest):
    - `status` string (opt)
    - `block` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/loan-types
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `POST` /payroll/loan-types
- **Query:** `admin_card_no` string (req)
- **Body** (LoanTypeRequest):
    - `loan_desc` string (req)
- **Response 200:** JSON

#### `DELETE` /payroll/loan-types/{loan_cd}
- **Path:** `loan_cd` string
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `GET` /payroll/loans
- **Query:** `admin_card_no` string (req), `compc` string (opt), `empcode` string (opt)
- **Response 200:** JSON

#### `POST` /payroll/loans
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (LoanRequest):
    - `empcode` string (opt)
    - `loan_cd` string (opt)
    - `loan_date` string (opt)
    - `loan_amt` number (opt)
    - `instalment_amt` number (opt)
    - `nof_instalment` integer (opt)
    - `start_dt` string (opt)
    - `charge_int` string (opt)
    - `int_rate` number (opt)
    - `chq_no` string (opt)
    - `chq_dt` string (opt)
    - `remarks` string (opt)
- **Response 200:** JSON

#### `DELETE` /payroll/loans/{doc}
- **Path:** `doc` integer
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `PUT` /payroll/loans/{doc}
- **Path:** `doc` integer
- **Query:** `admin_card_no` string (req)
- **Body** (LoanRequest):
    - `empcode` string (opt)
    - `loan_cd` string (opt)
    - `loan_date` string (opt)
    - `loan_amt` number (opt)
    - `instalment_amt` number (opt)
    - `nof_instalment` integer (opt)
    - `start_dt` string (opt)
    - `charge_int` string (opt)
    - `int_rate` number (opt)
    - `chq_no` string (opt)
    - `chq_dt` string (opt)
    - `remarks` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/pay-register
- **Query:** `admin_card_no` string (req), `period` integer (req), `compc` string (opt), `location` string (opt), `dept_no` string (opt), `desg_cd` string (opt), `empcode` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/pay-register/periods
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/periods
- **Query:** `admin_card_no` string (req), `compc` string (opt), `rule_id` integer (opt)
- **Response 200:** JSON

#### `POST` /payroll/periods
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (PeriodRequest):
    - `rule_id` integer (opt)
    - `period_frm` string (req)
    - `period_to` string (req)
    - `scode` string (opt)
- **Response 200:** JSON

#### `PATCH` /payroll/periods/{period}/status
- **Path:** `period` integer
- **Query:** `admin_card_no` string (req)
- **Body** (StatusRequest):
    - `status` string (opt)
    - `block` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/salary/open-period
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/salary/payslip
- **Query:** `admin_card_no` string (req), `empcode` string (req), `period` integer (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/salary/periods
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /payroll/salary/process
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/salary/sheet
- **Query:** `admin_card_no` string (req), `period` integer (req), `compc` string (opt), `brnch` string (opt), `q` string (opt)
- **Response 200:** JSON

#### `GET` /payroll/tax-masters
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `POST` /payroll/tax-masters
- **Query:** `admin_card_no` string (req)
- **Body** (TaxMasterRequest):
    - `tax_desc` string (req)
    - `fyear` string (opt)
- **Response 200:** JSON

#### `DELETE` /payroll/tax-masters/{tax_id}
- **Path:** `tax_id` integer
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `GET` /payroll/tax-masters/{tax_id}/details
- **Path:** `tax_id` integer
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `POST` /payroll/tax-masters/{tax_id}/details
- **Path:** `tax_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (TaxDetailRequest):
    - `slab_from` number (opt)
    - `slab_to` number (opt)
    - `slab_rate` number (opt)
    - `date_from` string (opt)
    - `date_to` string (opt)
    - `slab_ded` number (opt)
    - `fixed_tax` number (opt)
- **Response 200:** JSON

#### `DELETE` /payroll/tax-masters/{tax_id}/details/{srno}
- **Path:** `tax_id` integer, `srno` integer
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `PATCH` /payroll/tax-masters/{tax_id}/status
- **Path:** `tax_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (StatusRequest):
    - `status` string (opt)
    - `block` string (opt)
- **Response 200:** JSON

### Payroll Entry

#### `DELETE` /payroll-entry/absent-days
- **Query:** `admin_card_no` string (req), `empcode` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/absent-days
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt), `empcode` string (opt)
- **Response 200:** JSON

#### `POST` /payroll-entry/absent-days
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (AbsentDaysRequest):
    - `empcode` string (req)
    - `absent_days` number (req)
- **Response 200:** JSON

#### `GET` /payroll-entry/absent-days/employee
- **Query:** `admin_card_no` string (req), `empcode` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/allowance-types
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `DELETE` /payroll-entry/allowances
- **Query:** `admin_card_no` string (req), `empcode` string (req), `allowance_id` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/allowances
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt), `empcode` string (opt)
- **Response 200:** JSON

#### `POST` /payroll-entry/allowances
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (MonthlyAllowanceRequest):
    - `empcode` string (req)
    - `allowance_id` string (req)
    - `amount` number (req)
    - `ot_hour` number (opt)
    - `remarks` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/deduction-types
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `DELETE` /payroll-entry/deductions
- **Query:** `admin_card_no` string (req), `empcode` string (req), `deduction_id` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/deductions
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt), `empcode` string (opt)
- **Response 200:** JSON

#### `POST` /payroll-entry/deductions
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (MonthlyDeductionRequest):
    - `empcode` string (req)
    - `deduction_id` string (req)
    - `amount` number (req)
    - `remarks` string (opt)
- **Response 200:** JSON

#### `DELETE` /payroll-entry/loan-recoveries
- **Query:** `admin_card_no` string (req), `rowid` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/loan-recoveries
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt), `doc` integer (opt)
- **Response 200:** JSON

#### `POST` /payroll-entry/loan-recoveries
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (LoanRecoveryRequest):
    - `doc` integer (req)
    - `recovery_type` string (opt)
    - `recovered_amt` number (req)
    - `remarks` string (opt)
    - `int_rate_rec` number (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/loans
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/open-periods
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /payroll-entry/recovery-types
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

### Recruitment

#### `GET` /recruitment/analytics
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /recruitment/applications
- **Query:** `admin_card_no` string (req), `job_id` integer (opt), `status` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /recruitment/applications
- **Query:** `admin_card_no` string (req)
- **Body** (ApplicationCreateRequest):
    - `job_id` integer (req)
    - `candidate_name` string (req)
    - `mobile` string (opt)
    - `email` string (opt)
    - `source` string (opt)
    - `notes` string (opt)
- **Response 200:** JSON

#### `GET` /recruitment/applications/{app_id}
- **Path:** `app_id` integer
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `PATCH` /recruitment/applications/{app_id}/status
- **Path:** `app_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (ApplicationStatusUpdate):
    - `status` string (req)
    - `notes` string (opt)
- **Response 200:** JSON

#### `GET` /recruitment/interviews
- **Query:** `admin_card_no` string (req), `app_id` integer (opt), `status` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /recruitment/interviews
- **Query:** `admin_card_no` string (req)
- **Body** (InterviewCreateRequest):
    - `app_id` integer (req)
    - `interview_date` string (opt)
    - `interview_type` string (opt)
    - `interviewer` string (opt)
- **Response 200:** JSON

#### `PATCH` /recruitment/interviews/{interview_id}
- **Path:** `interview_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (InterviewUpdateRequest):
    - `status` string (opt)
    - `feedback` string (opt)
    - `interview_date` string (opt)
    - `interview_type` string (opt)
    - `interviewer` string (opt)
- **Response 200:** JSON

#### `GET` /recruitment/jobs
- **Query:** `admin_card_no` string (req), `status` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /recruitment/jobs
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt)
- **Body** (JobCreateRequest):
    - `job_title` string (req)
    - `dept_no` integer (opt)
    - `open_positions` integer (opt)
    - `job_desc` string (opt)
    - `skills_req` string (opt)
- **Response 200:** JSON

#### `GET` /recruitment/jobs/{job_id}
- **Path:** `job_id` integer
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `PUT` /recruitment/jobs/{job_id}
- **Path:** `job_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (JobUpdateRequest):
    - `job_title` string (opt)
    - `dept_no` integer (opt)
    - `open_positions` integer (opt)
    - `job_desc` string (opt)
    - `skills_req` string (opt)
    - `status` string (opt)
- **Response 200:** JSON

#### `GET` /recruitment/offers
- **Query:** `admin_card_no` string (req), `status` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /recruitment/offers
- **Query:** `admin_card_no` string (req)
- **Body** (OfferCreateRequest):
    - `app_id` integer (req)
    - `salary_offered` number (opt)
    - `notes` string (opt)
- **Response 200:** JSON

#### `PATCH` /recruitment/offers/{offer_id}
- **Path:** `offer_id` integer
- **Query:** `admin_card_no` string (req)
- **Body** (OfferUpdateRequest):
    - `status` string (opt)
    - `salary_offered` number (opt)
    - `notes` string (opt)
- **Response 200:** JSON

### Reference Data

#### `GET` /reference/bank-branches
- **Query:** `bnkcode` string (opt)
- **Response 200:** JSON

#### `POST` /reference/bank-branches
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (AddBankBranchRequest):
    - `bnkcode` string (req)
    - `brnname` string (req)
- **Response 200:** JSON

#### `DELETE` /reference/bank-branches/{bnkcode}/{brncode}
- **Path:** `bnkcode` string, `brncode` string
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /reference/banks
- **Query:** `compc` string (opt)
- **Response 200:** JSON

#### `POST` /reference/banks
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (AddBankRequest):
    - `bnkname` string (req)
- **Response 200:** JSON

#### `DELETE` /reference/banks/{bnkcode}
- **Path:** `bnkcode` string
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /reference/blood-groups
- **Query:** `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /reference/blood-groups
- **Query:** `admin_card_no` string (req)
- **Body** (AddBloodGroupRequest):
    - `blood_group` string (req)
- **Response 200:** JSON

#### `GET` /reference/cadre
- **Query:** `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /reference/cadre
- **Query:** `admin_card_no` string (req)
- **Body** (AddCadreRequest):
    - `cadre` string (req)
- **Response 200:** JSON

#### `GET` /reference/departments
- **Query:** `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /reference/departments
- **Query:** `admin_card_no` string (req)
- **Body** (AddDeptRequest):
    - `dept_name` string (req)
- **Response 200:** JSON

#### `GET` /reference/designations
- **Query:** `grade_cd` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /reference/designations
- **Query:** `admin_card_no` string (req)
- **Body** (AddDesignationRequest):
    - `grade_cd` string (req)
    - `desg_desc` string (req)
- **Response 200:** JSON

#### `GET` /reference/emp-statuses
- **Query:** `compc` string (opt)
- **Response 200:** JSON

#### `POST` /reference/emp-statuses
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (AddEmpStatusRequest):
    - `descr` string (req)
- **Response 200:** JSON

#### `DELETE` /reference/emp-statuses/{emp_status}
- **Path:** `emp_status` string
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /reference/grades
- **Query:** `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /reference/grades
- **Query:** `admin_card_no` string (req)
- **Body** (AddGradeRequest):
    - `grade_cd` string (req)
    - `descr` string (req)
- **Response 200:** JSON

#### `GET` /reference/locations
- **Query:** `admin_card_no` string (opt), `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /reference/locations
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (LocationRequest):
    - `lcode` string (req)
    - `descr` string (req)
    - `sname` string (opt)
    - `regioncode` string (opt)
    - `city` string (opt)
- **Response 200:** JSON

#### `PUT` /reference/locations/{lcode}
- **Path:** `lcode` string
- **Query:** `admin_card_no` string (req)
- **Body** (LocationRequest):
    - `lcode` string (req)
    - `descr` string (req)
    - `sname` string (opt)
    - `regioncode` string (opt)
    - `city` string (opt)
- **Response 200:** JSON

#### `GET` /reference/qualifications
- **Query:** `compc` string (opt)
- **Response 200:** JSON

#### `POST` /reference/qualifications
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Body** (AddQualificationRequest):
    - `descr` string (req)
- **Response 200:** JSON

#### `DELETE` /reference/qualifications/{descr}
- **Path:** `descr` string
- **Query:** `admin_card_no` string (req), `compc` string (opt)
- **Response 200:** JSON

#### `GET` /reference/religions
- **Response 200:** JSON

#### `GET` /reference/reporting-officers
- **Query:** `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `GET` /reference/shift-lov
- **Response 200:** JSON

#### `GET` /reference/shifts
- **Query:** `compc` string (opt), `brnch` string (opt)
- **Response 200:** JSON

#### `POST` /reference/shifts
- **Query:** `admin_card_no` string (req), `compc` string (opt), `brnch` string (opt)
- **Body** (ShiftRequest):
    - `shift` string (req)
    - `shift_desc` string (opt)
    - `time_from` string (opt)
    - `time_to` string (opt)
    - `overtime_start_time` string (opt)
    - `allow_in_time` string (opt)
    - `late_start_tm` string (opt)
    - `late_end_tm` string (opt)
    - `half_day_tm` string (opt)
    - `half_day_end_tm` string (opt)
    - `sat_start_tm` string (opt)
    - `sat_end_time` string (opt)
    - `sat_allow_in_tm` string (opt)
    - `sat_haf_day_tm` string (opt)
    - `late_sit_tm` string (opt)
    - `late_sit_allow_tm` string (opt)
    - `early_out_late_start` string (opt)
    - `early_out_late_end` string (opt)
    - `early_out_hday_start` string (opt)
    - `early_out_hday_end` string (opt)
    - `duty_hrs` string (opt)
    - `day_name` string (opt)
- **Response 200:** JSON

#### `DELETE` /reference/shifts/{pk}
- **Path:** `pk` integer
- **Query:** `admin_card_no` string (req)
- **Response 200:** JSON

#### `PUT` /reference/shifts/{pk}
- **Path:** `pk` integer
- **Query:** `admin_card_no` string (req)
- **Body** (ShiftRequest):
    - `shift` string (req)
    - `shift_desc` string (opt)
    - `time_from` string (opt)
    - `time_to` string (opt)
    - `overtime_start_time` string (opt)
    - `allow_in_time` string (opt)
    - `late_start_tm` string (opt)
    - `late_end_tm` string (opt)
    - `half_day_tm` string (opt)
    - `half_day_end_tm` string (opt)
    - `sat_start_tm` string (opt)
    - `sat_end_time` string (opt)
    - `sat_allow_in_tm` string (opt)
    - `sat_haf_day_tm` string (opt)
    - `late_sit_tm` string (opt)
    - `late_sit_allow_tm` string (opt)
    - `early_out_late_start` string (opt)
    - `early_out_late_end` string (opt)
    - `early_out_hday_start` string (opt)
    - `early_out_hday_end` string (opt)
    - `duty_hrs` string (opt)
    - `day_name` string (opt)
- **Response 200:** JSON

#### `GET` /reference/units
- **Response 200:** JSON

#### `POST` /reference/units
- **Query:** `admin_card_no` string (req)
- **Body** (AddUnitRequest):
    - `unit_name` string (req)
- **Response 200:** JSON

---

*End of document.*
