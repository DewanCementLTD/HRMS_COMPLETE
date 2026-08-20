"""One-off fix: correct 2026-06-15 attendance punches that were stamped with a
wrong (≈6h30m ahead) server clock. Truth = ATTENDANCE_RECORDS.TIMESTAMP (the
device's real time). Only rows whose server time is >= THRESHOLD minutes ahead
of their device time are touched; already-correct rows are left alone.

Run `python _att_fix_20260615.py`         -> DRY RUN (backup + preview, no changes)
Run `python _att_fix_20260615.py apply`   -> APPLY (updates + commit)
"""
import sys, json, datetime
import oracledb

D = "2026-06-15"
THRESHOLD = 120          # minutes; separates the wrong (~389) rows from correct (~0)
APPLY = len(sys.argv) > 1 and sys.argv[1] == "apply"

conn = oracledb.connect(user="hrms", password="oracle123", dsn="127.0.0.1:1521/orcl")
cur = conn.cursor()

def to_min(hhmm):
    s = (hhmm or "").strip()
    if len(s) < 4 or ":" not in s:
        return None
    try:
        h, m = s[:5].split(":"); return int(h) * 60 + int(m)
    except Exception:
        return None

def fmt(m):
    m %= 24 * 60
    return f"{m // 60:02d}:{m % 60:02d}"

cur.execute("SELECT TO_CHAR(SYSTIMESTAMP,'YYYY-MM-DD HH24:MI:SS') FROM DUAL")
print("server clock now:", cur.fetchone()[0], "| mode:", "APPLY" if APPLY else "DRY RUN")

# ---- read ATTENDANCE_RECORDS ----
cur.execute(f"""SELECT ID, TO_CHAR(CARD_NO), ENTRY_TIME, EXIT_TIME, TIMESTAMP
                FROM ATTENDANCE_RECORDS WHERE TRUNC(ATTENDANCE_DATE)=DATE '{D}' ORDER BY ID""")
ar = cur.fetchall()

# per-card correction: card -> {offset, new_in}
card_fix = {}
ar_updates = []   # (id, new_entry, new_exit_or_None)
for ID, card, entry, exit_, ts in ar:
    entry = (entry or "").strip(); exit_ = (exit_ or "").strip(); ts = (ts or "").strip()
    ts_hhmi = ts[11:16] if len(ts) >= 16 and ts[:10] == D else ""
    em, cm = to_min(entry), to_min(ts_hhmi)
    if em is None or cm is None:
        continue
    offset = em - cm
    if offset < THRESHOLD:
        continue                      # already correct -> skip
    new_entry = ts_hhmi
    new_exit = None
    xm = to_min(exit_)
    if xm is not None:
        new_exit = fmt(xm - offset)
    ar_updates.append((ID, entry, exit_, new_entry, new_exit, offset))
    card_fix[str(card)] = {"offset": offset, "new_in": new_entry}

# ---- read DUTY_ROSTER ----
cur.execute(f"""SELECT DUTY_ROSTER_PK, TO_CHAR(CARD_NO), IN_TIME, OUT_TIME, ATT_MRK_TM
                FROM DUTY_ROSTER WHERE TRUNC(ROSTER_DATE)=DATE '{D}' AND IN_TIME IS NOT NULL
                ORDER BY DUTY_ROSTER_PK""")
dr = cur.fetchall()
dr_updates = []   # (pk, new_in, new_out_or_None, new_att_mrk)
for pk, card, in_t, out_t, mrk in dr:
    f = card_fix.get(str(card))
    if not f:
        continue
    in_t = (in_t or "").strip(); out_t = (out_t or "").strip()
    new_in = f["new_in"]; new_out = None
    xm = to_min(out_t)
    if xm is not None:
        new_out = fmt(xm - f["offset"])
    dr_updates.append((pk, in_t, out_t, mrk, new_in, new_out))

print(f"\nATTENDANCE_RECORDS to correct: {len(ar_updates)} (of {len(ar)})")
print(f"{'ID':>5} {'entry->new':>16} {'exit->new':>16}")
for ID, oe, ox, ne, nx, off in ar_updates:
    print(f"{ID:>5} {oe+' -> '+ne:>16} {((ox+' -> '+nx) if nx else ''):>16}")

print(f"\nDUTY_ROSTER to correct: {len(dr_updates)} (of {len(dr)})")
for pk, oi, oo, om, ni, no in dr_updates[:6]:
    print(f"  PK {pk}: IN {oi}->{ni}  OUT {oo or '-'}->{no or '-'}  ATT_MRK {om}->{ni}")
print("  ...") if len(dr_updates) > 6 else None

# ---- backup ----
backup = {
    "generated": datetime.datetime.now().isoformat(),
    "attendance_records": [{"id": u[0], "old_entry": u[1], "old_exit": u[2]} for u in ar_updates],
    "duty_roster": [{"pk": u[0], "old_in": u[1], "old_out": u[2], "old_att_mrk": u[3]} for u in dr_updates],
}
with open("_att_backup_20260615.json", "w") as f:
    json.dump(backup, f, indent=2)
print("\nbackup written: _att_backup_20260615.json")

if not APPLY:
    print("\nDRY RUN — no changes made. Re-run with 'apply' to commit.")
    cur.close(); conn.close(); sys.exit(0)

# ---- apply ----
for ID, oe, ox, ne, nx, off in ar_updates:
    if nx is not None:
        cur.execute("UPDATE ATTENDANCE_RECORDS SET ENTRY_TIME=:e, EXIT_TIME=:x WHERE ID=:id",
                    {"e": ne, "x": nx, "id": ID})
    else:
        cur.execute("UPDATE ATTENDANCE_RECORDS SET ENTRY_TIME=:e WHERE ID=:id", {"e": ne, "id": ID})
for pk, oi, oo, om, ni, no in dr_updates:
    if no is not None:
        cur.execute("UPDATE DUTY_ROSTER SET IN_TIME=:i, OUT_TIME=:o, ATT_MRK_TM=:m WHERE DUTY_ROSTER_PK=:pk",
                    {"i": ni, "o": no, "m": ni, "pk": pk})
    else:
        cur.execute("UPDATE DUTY_ROSTER SET IN_TIME=:i, ATT_MRK_TM=:m WHERE DUTY_ROSTER_PK=:pk",
                    {"i": ni, "m": ni, "pk": pk})
conn.commit()
print(f"\nAPPLIED & COMMITTED: {len(ar_updates)} ATTENDANCE_RECORDS, {len(dr_updates)} DUTY_ROSTER rows.")
cur.close(); conn.close()
