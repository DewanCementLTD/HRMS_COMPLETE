-- ============================================================================
-- Employment status: two values only — 'A' Active and 'L' Left
-- ============================================================================
-- HR_EMP_MASTER.STATUS had four codes in use on 2026-09-15:
--
--   A  791  Active
--   L   73  Left
--   D   61  retired code — every one of them carries a resignation date
--   I    2  the old "Inactive"
--
-- The UI showed both 'D' and 'I' as "Inactive", and nothing anywhere enforced
-- any of it: until the change that accompanies this script, an employee marked
-- Left could still log in, mark attendance and be location-tracked. Eight of
-- them punched in the thirty days to 2026-09-15.
--
-- From now on 'A' means the person works here and 'L' means they do not, and
-- the application enforces that at login, at the attendance mark and in
-- location tracking. The code already reads 'D' and 'I' as Left, so this script
-- is about cleaning the stored values, not about changing behaviour — with one
-- exception, see step 2.
--
-- Run each step, check the count, then COMMIT.
-- ============================================================================

-- 1. PREVIEW — what is about to change
SELECT STATUS AS status_now,
       COUNT(*) AS employees,
       COUNT(DTOFRESIGN) AS with_resignation_date
  FROM HR_EMP_MASTER
 GROUP BY STATUS
 ORDER BY STATUS;

-- ---------------------------------------------------------------------------
-- 2. The two 'I' rows become ACTIVE.
--
-- Neither has a resignation date and both were still punching in September
-- (GHAFRULLAH and AHSAAN ALI, Soorty Nooriabad, joined 2026-06-20). Since the
-- application now treats 'I' as Left, leaving them would lock two working
-- people out of the app tomorrow. This is the one step that changes behaviour
-- rather than just tidying a code: it keeps them working.
--
-- If HR did intend them to be gone, set them to 'L' in the employee screen —
-- it is two clicks, and it is reversible either way.
-- ---------------------------------------------------------------------------
UPDATE HR_EMP_MASTER
   SET STATUS = 'A'
 WHERE STATUS = 'I'
   AND DTOFRESIGN IS NULL;          -- expect 2 rows

-- Any 'I' row that DOES carry a resignation date is a departure, not an
-- oversight, so it follows the 'D' rows below.
UPDATE HR_EMP_MASTER
   SET STATUS = 'L'
 WHERE STATUS = 'I'
   AND DTOFRESIGN IS NOT NULL;      -- expect 0 rows today

-- ---------------------------------------------------------------------------
-- 3. The 61 'D' rows become LEFT. Every one has a resignation date on file.
-- ---------------------------------------------------------------------------
UPDATE HR_EMP_MASTER
   SET STATUS = 'L'
 WHERE STATUS = 'D';                -- expect 61 rows

-- ---------------------------------------------------------------------------
-- 4. Turn location tracking off for everyone who has left.
--
-- 28 employees marked Left still carried TRACK_LOCATION = 'Y'. The application
-- ignores the flag for a Left employee regardless, so this is tidying the
-- stored value to match what actually happens — and it means the flag reads
-- true if tracking is ever driven from it directly.
-- ---------------------------------------------------------------------------
UPDATE HR_EMP_MASTER
   SET TRACK_LOCATION = 'N'
 WHERE STATUS = 'L'
   AND NVL(TRACK_LOCATION, 'N') <> 'N';   -- expect ~29 rows

-- COMMIT;

-- ---------------------------------------------------------------------------
-- 5. VERIFY — only 'A' and 'L' should remain, and no Left employee should
--    still be flagged for tracking.
-- ---------------------------------------------------------------------------
SELECT STATUS AS status_now, COUNT(*) AS employees
  FROM HR_EMP_MASTER GROUP BY STATUS ORDER BY STATUS;

SELECT COUNT(*) AS left_employees_still_tracked
  FROM HR_EMP_MASTER
 WHERE STATUS = 'L' AND NVL(TRACK_LOCATION, 'N') <> 'N';
