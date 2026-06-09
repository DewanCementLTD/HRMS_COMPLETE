-- ============================================
-- LMS Backend - Database Setup Scripts
-- Run these against your Oracle database
-- ============================================

-- 1. Add HR_ADMIN column to EMPLOYEE (if not exists)
-- Check first: SELECT column_name FROM all_tab_columns WHERE table_name='EMPLOYEE' AND column_name='HR_ADMIN';
ALTER TABLE EMPLOYEE ADD (HR_ADMIN VARCHAR2(1) DEFAULT 'N');

-- 2. Add FACE_REGISTERED column to EMPLOYEE (if not exists)
ALTER TABLE EMPLOYEE ADD (FACE_REGISTERED VARCHAR2(1) DEFAULT 'N');

-- 3. Create ATTENDANCE sequence (if not exists)
-- Check first: SELECT sequence_name FROM all_sequences WHERE sequence_name='ATTENDANCE_SEQ';
CREATE SEQUENCE ATTENDANCE_SEQ START WITH 1 INCREMENT BY 1 NOCACHE;

-- 4. EMP_FACE_DATA table (user confirmed it already exists — skip if so)
-- CREATE TABLE EMP_FACE_DATA (
--     ID          NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
--     CARD_NO     VARCHAR2(100) NOT NULL,
--     EMBEDDING   CLOB NOT NULL,
--     IMAGE_INDEX NUMBER NOT NULL,
--     CREATED_AT  TIMESTAMP DEFAULT SYSTIMESTAMP
-- );
-- CREATE INDEX idx_face_card_no ON EMP_FACE_DATA(CARD_NO);
