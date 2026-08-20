# Report SQL — Deviations from the root `.txt` files

The 9 `.txt` files in this folder are the authoritative Oracle report queries. They are
implemented in `Node-LMS-Backend/src/services/reports.service.js`. This lists **every**
place the running SQL differs from the file, and why.

Two things to know up front, because they explain most of the list:

- **The `.txt` files are Oracle Reports Builder extracts, not standalone SQL.** Each file has a
  `query 1` (data) and a `query 2` (`FROM DUAL` page-header labels). Reports Builder joined
  and laid these out; a JSON API has to do that work itself.
- **They were written against the production database.** Several assumptions that hold there
  (reference data present, columns present, no NULLs in key filter columns) do not hold on
  this instance — and Oracle *silently returns fewer rows* rather than erroring, so nothing
  looked broken in SQL Developer.

---

## 1. `codename('LOC_ID' / 'PERIOD#', …)` returns NULL

**Files:** `Allowance List.txt`, `employee deduction detail.txt`, `PF Detail.txt`, and every `query 2`.

**Issue.** `CODENAME` is a lookup function that resolves a code to its display name. On this
database `codename('LOC_ID', 1, null)` and `codename('PERIOD#', 61, 1)` both return `NULL`, so
the Location and Month columns printed blank. (`codename('ORG',…)` and `codename('COPYR',…)`
still work — only the `LOC_ID`/`PERIOD#` forms are affected.)

**Why it didn't show in SQL Developer.** The function exists and executes fine — it just
returns `NULL` because the backing lookup rows for those code types aren't present on this
instance. No error, no warning; on production the rows exist and it returns the name.

**Mitigation.** Wrap it in `NVL()` with a direct lookup, so the real function still wins where
it works:

```sql
NVL(codename('LOC_ID', c.location, null),
    (SELECT l.loc_name FROM hr_location l WHERE l.loc_id = c.location))
```

A **scalar subquery**, not an added table in the `FROM` list — an inner join to `HR_LOCATION`
would silently drop employees whose location has no matching row, changing the result set.
Period labels are resolved in JS from `HR_ATTND_PERIOD.PERIOD_FRM` instead (`periodLabelMap`).

---

## 2. `ORA-22818: subquery expressions not allowed here`

**Files:** `Allowance List.txt`, `employee deduction detail.txt`.

**Issue.** Both queries `GROUP BY codename('LOC_ID', c.location, null)`. Once that expression
became a scalar subquery (deviation 1), Oracle rejected it — subqueries are illegal in
`GROUP BY`.

**Why it didn't show in SQL Developer.** It didn't exist there. A plain function call in
`GROUP BY` is legal; this error is a *consequence of deviation 1*, not a pre-existing fault.

**Mitigation.** Group by the raw `c.location` column and apply the label once in an outer
`SELECT`. `location` determines its own name 1:1, so the partitioning is identical.

---

## 3. `sec_nm` does not exist

**File:** `Employee Detail (Active).txt` (all three `UNION ALL` branches).

**Issue.** The query selects `sec_nm` from `hr_emp_master_view`. That column does not exist on
this database's view — the whole report failed with `ORA-00904: invalid identifier`.

**Why it didn't show in SQL Developer.** The production view definition has the column; this
instance's is older. A hard error, not a silent one — it would have failed there too.

**Mitigation.** `NULL AS sec_nm`. The Section column still renders (blank) so the report
matches the reference layout instead of failing outright. Restore the real column by adding
`SEC_NM` to the view.

---

## 4. The `query 2` header statements are not ported

**Files:** all of them.

**Issue.** Each file's `query 2` is a `FROM DUAL` select producing page-header strings —
`codename('ORG',…)`, `DECODE(:mloc, null, 'ALL Locations', …)`, `'Dewan Cement Limited.'`.

**Why it didn't show in SQL Developer.** It works, but it's a Reports Builder construct: a
second query feeding the header frame. It also hardcodes one company name and depends on the
same `codename` calls that return NULL here (deviation 1).

**Mitigation.** Dropped. The API returns a `meta` block built from values already resolved
server-side (company, branch, period labels, active filters, run timestamp). This is cheaper —
no extra round trip — correct where `codename` is NULL, and multi-company safe: the header
shows the HR user's selected company, not a hardcoded one.

---

## 5. ⚠ `col = NVL(:bind, col)` drops rows with NULL columns

**Files:** all reports with optional filters. **This is the most consequential one.**

**Issue.** Every optional filter is written `col = NVL(:bind, col)`, intended as "no filter
when the bind is NULL". It isn't. When **`col` itself is NULL**, the expression becomes
`NULL = NULL`, which SQL evaluates to `UNKNOWN` — not `TRUE` — so the row is discarded even
though the user left the filter blank.

Measured on this database:

| Column | NULL rows | Effect |
|---|---|---|
| `HR_EMP_MASTER_VIEW.DESG_GRP` | **all** active employees of units 2 and 3 | Active Employee Detail returned **0 rows** for those companies |
| `HR_EMP_MASTER_VIEW.EMP_STATUS` | 1 of 3 (unit 1) | employee silently missing |
| `HR_DESG.DESG_GRP` | 72 of 166 | Bank Advice dropped those designations |
| `HR_EMP_MASTER.DEPT_NO` | 45 of 898 | Month Wise Deduction dropped those employees |

**Why it didn't show in SQL Developer.** This is the important part: **it does the same thing
there.** It never errors — it just returns fewer rows. On production these columns were
populated, so the bug was invisible. It only surfaced here because this instance has NULLs.

**Mitigation.** A helper (`optEq`) generating the correct predicate, applied to every optional
filter across all reports:

```sql
-- was:  col = NVL(:bind, col)
(:bind IS NULL OR col = :bind)
```

Identical behaviour when a value is supplied; stops discarding NULL-column rows when blank.
Verified: unit 3 Active Employee went 0 → 79 rows, unit 1 went 2 → 3, and every filter still
narrows correctly (`grade_cd=WR` → 79, `grade_cd=ZZZ` → 0, `empcode` → 1).

**Left alone deliberately:** `D.TRANS_TYPE || D.TRANS_ID = NVL(:maid1, …)` in `BAnk Advice.txt`
(a concatenation of two NOT NULL key columns, and its `!=` twin is the intentional "Other"
branch) and `b.unit_id = NVL(:munit, …)` in `PF Detail.txt` (`UNIT_ID` is never NULL).

---

## 6. `GROSS BETWEEN NVL(:g1,0) AND NVL(:g2,999999)`

**File:** `Employee Detail (Active).txt`.

**Issue.** Same class as 5, twice over. An unfiltered report is silently capped at **999,999** —
anyone earning more vanishes — and employees with a NULL `GROSS` (2 of 83 here) are dropped.

**Why it didn't show in SQL Developer.** Same reason: no error, and no production salary
exceeded the cap at the time it was written.

**Mitigation.** `optRange`: `(:g1 IS NULL OR col >= :g1) AND (:g2 IS NULL OR col <= :g2)`.
No arbitrary ceiling; NULL-gross employees appear in an unfiltered run.

---

## 7. OT Hours column added

**File:** `Allowance List.txt`.

**Issue.** The reference output (`Reports/…12.36.27 PM (1).jpeg`) has an OT Hours column. The
query does not select it.

**Why it didn't show in SQL Developer.** The `.txt` is only `query 1`. In Reports Builder the
OT figure came from a different data group that wasn't part of this extract.

**Mitigation.** Added a scalar subquery onto `HR_MONTHLY_ALLOW.OT_HOUR` (allowance `19` =
OVER TIME), summed over the same period span the branch used — `p1..p2` for Posted, `p1` only
for Current, matching the source query's own asymmetry:

```sql
(select sum(nvl(ma.OT_HOUR, 0)) from HR_MONTHLY_ALLOW ma
  where ma.OLD_EMPCODE = v.empcode and ma.UNIT_ID = v.unitid
    and ma.ALLOWANCE_ID = '19' and ma.period# between :ot_p1 and :ot_p2)
```

Scalar subquery again, so the aggregated row set is unchanged. Verified against real data:
employee `100103.1` returns 15 for period 8, 79 for period 11, and 94 across the 8–11 range.

---

## 8. Reconciliation reports needed display labels

**Files:** `Payroll Reconciliation Detail Report (Allwoance ).txt`, `Dedudction Variance.txt`.

**Issue.** The allowance variant selects only `OLD_EMPCODE, UNIT_ID, TRANS_ID` and amounts, but
the printed report shows employee names and an allowance-name section header
("Total Of L.F.A").

**Why it didn't show in SQL Developer.** Reports Builder linked the name in via a separate
group; the `.txt` holds only the aggregation query.

**Mitigation.** The file's query is used **verbatim as an inline view**, with `HR_EMP_MASTER`
(name) and `HR_ALLOWANCE` (description) joined on the *outside* as scalar subqueries. The
`GROUP BY … HAVING` logic is untouched.

---

## 9. `PHONE#` alias renamed

**File:** `Employee Detail (Active).txt`.

**Issue.** Selects `substr(NVL(PHONE#,'Nill'),1,13) PHONE#` — aliasing a column to a name
containing `#`, which becomes the JSON key `phone#`.

**Why it didn't show in SQL Developer.** Oracle accepts `#` in identifiers; it's only awkward
once the result becomes a JSON property.

**Mitigation.** Aliased to `PHONE_NO`. Values identical.

---

## Not a deviation, but worth recording

- **`HR_SALARY_PROCESS_FINAL` is empty on this instance.** Any report run with **Salary Data =
  Posted (Final)** correctly returns nothing. `Month wise deduction report.txt` reads *only*
  that table — it has no Current/Posted switch in its source SQL, so it returns nothing until
  payroll is posted. Left faithful; adding a switch would change the report's meaning.
- **This database has no monthly allowances** (`HR_ALLOWANCE.USE_ALLOWANCE = 'M'`) in
  `HR_SALARY_PROCESS`, so the Allowance Detail report is legitimately empty here.
- **Company/branch scoping is applied outside the SQL.** `compc` → `UNIT_ID` and `brnch` →
  `LOCATION` are re-resolved against the HR admin's rights in `reports.controller.js` via
  `resolveCompany`/`resolveBranch`, then passed into the existing `:munit*` / `:mloc*` binds.
  The queries are unchanged; a client cannot widen its own scope.
