// End-to-end smoke test of the Training module against the real database.
// Runs the whole flow through the service layer, then deletes everything it
// created (even when a step fails). Run after scripts/run_training_ddl.mjs:
//   cd Node-LMS-Backend && node scripts/training_smoke_test.mjs
import 'dotenv/config';
import { getDirectConnection } from '../src/config/database.js';
import * as master from '../src/services/trainingMaster.service.js';
import * as sessions from '../src/services/trainingSession.service.js';
import * as requests from '../src/services/trainingRequest.service.js';
import * as tests from '../src/services/trainingTest.service.js';
import * as reports from '../src/services/trainingReports.service.js';
import * as trainerSvc from '../src/services/trainingTrainer.service.js';
import { loadCertificate, loadTrainerCertificate, buildCertificatePdf } from '../src/services/trainingCertificatePdf.service.js';
import fs from 'node:fs';
import path from 'node:path';
import { fyOf } from '../src/services/trainingShared.service.js';

const ACTOR = 'SMOKE';
const created = { categories: [], trainers: [], courses: [], budgets: [], sessions: [], requests: [] };
let failures = 0;
const check = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`);
  if (!cond) failures++;
};

const q = async (sql, binds = {}) => {
  const c = await getDirectConnection();
  try { return (await c.execute(sql, binds, { outFormat: 4001 })).rows ?? []; } finally { await c.close(); }
};

async function findEmployeeWithHod() {
  // An active employee whose HOD1 mobile belongs to another active employee.
  const rows = await q(`
    SELECT e.EMPCODE, h.EMPCODE, m.UNIT_ID
      FROM EMPLOYEE e
      JOIN HR_EMP_MASTER m ON m.EMPCODE = e.EMPCODE AND NVL(m.STATUS,'A') = 'A'
      JOIN HR_EMP_MASTER h ON SUBSTR(REGEXP_REPLACE(TO_CHAR(h."MOBILE#"), '[^0-9]', ''), -10)
                            = SUBSTR(REGEXP_REPLACE(TO_CHAR(e.HOD1), '[^0-9]', ''), -10)
                          AND h.EMPCODE <> e.EMPCODE AND NVL(h.STATUS,'A') = 'A'
     WHERE e.HOD1 IS NOT NULL AND e.HOD2 IS NULL
     FETCH FIRST 1 ROWS ONLY`);
  return rows[0] ? { emp: String(rows[0][0]), hod: String(rows[0][1]), compc: Number(rows[0][2]) } : null;
}

async function cleanup() {
  const c = await getDirectConnection();
  const del = async (sql, binds) => { try { await c.execute(sql, binds); } catch (e) { console.log(`cleanup: ${e.message.split('\n')[0]}`); } };
  try {
    for (const sid of created.sessions) {
      await del(`DELETE FROM HR_TRAINING_ANSWER WHERE ATTEMPT_ID IN (SELECT a.ATTEMPT_ID FROM HR_TRAINING_ATTEMPT a JOIN HR_TRAINING_PARTICIPANT p ON p.PARTICIPANT_ID = a.PARTICIPANT_ID WHERE p.SESSION_ID = :s)`, { s: sid });
      await del(`DELETE FROM HR_TRAINING_ATTEMPT WHERE PARTICIPANT_ID IN (SELECT PARTICIPANT_ID FROM HR_TRAINING_PARTICIPANT WHERE SESSION_ID = :s)`, { s: sid });
      await del(`DELETE FROM HR_TRAINING_ATTENDANCE WHERE PARTICIPANT_ID IN (SELECT PARTICIPANT_ID FROM HR_TRAINING_PARTICIPANT WHERE SESSION_ID = :s)`, { s: sid });
      await del(`DELETE FROM HR_TRAINING_FEEDBACK WHERE SESSION_ID = :s`, { s: sid });
    }
    for (const rid of created.requests) await del(`UPDATE HR_TRAINING_REQUEST SET SESSION_ID = NULL WHERE REQUEST_ID = :r`, { r: rid });
    for (const sid of created.sessions) await del(`DELETE FROM HR_TRAINING_PARTICIPANT WHERE SESSION_ID = :s`, { s: sid });
    for (const rid of created.requests) await del(`DELETE FROM HR_TRAINING_REQUEST WHERE REQUEST_ID = :r`, { r: rid });
    for (const sid of created.sessions) {
      const f = await c.execute(`SELECT OUTLINE_FILE_PATH FROM HR_TRAINING_SESSION WHERE SESSION_ID = :s`, { s: sid }).catch(() => ({ rows: [] }));
      const stored = f.rows?.[0]?.[0];
      if (stored) fs.rmSync(path.join(trainerSvc.OUTLINE_DIR, path.basename(stored)), { force: true });
      await del(`DELETE FROM HR_TRAINING_SESSION WHERE SESSION_ID = :s`, { s: sid });
    }
    for (const cid of created.courses) {
      await del(`DELETE FROM HR_TRAINING_QUESTION WHERE TEST_ID IN (SELECT TEST_ID FROM HR_TRAINING_TEST WHERE COURSE_ID = :c)`, { c: cid });
      await del(`DELETE FROM HR_TRAINING_TEST WHERE COURSE_ID = :c`, { c: cid });
      await del(`DELETE FROM HR_TRAINING_COURSE WHERE COURSE_ID = :c`, { c: cid });
    }
    for (const id of created.trainers) await del(`DELETE FROM HR_TRAINER_SLOT WHERE TRAINER_ID = :i`, { i: id });
    for (const id of created.trainers) await del(`DELETE FROM HR_TRAINER WHERE TRAINER_ID = :i`, { i: id });
    for (const id of created.categories) await del(`DELETE FROM HR_TRAINING_CATEGORY WHERE CATEGORY_ID = :i`, { i: id });
    for (const id of created.budgets) await del(`DELETE FROM HR_TRAINING_BUDGET WHERE BUDGET_ID = :i`, { i: id });
    for (const id of created.trainers) await del(`DELETE FROM HR_TRAINING_LOG WHERE ENTITY = 'TRAINER' AND ENTITY_ID = :i`, { i: id });
    await del(`DELETE FROM HR_TRAINING_LOG WHERE ACTOR = :a
                  OR (ENTITY = 'REQUEST' AND ENTITY_ID IN (SELECT COLUMN_VALUE FROM TABLE(SYS.ODCINUMBERLIST(${[...created.requests, 0].join(',')}))))`, { a: ACTOR });
    await c.commit();
    console.log('cleanup done');
  } finally {
    await c.close();
  }
}

async function main() {
  const pair = await findEmployeeWithHod();
  if (!pair) { console.log('No employee with a resolvable HOD 1 found — cannot run the approval flow.'); return; }
  const { emp, hod, compc } = pair;
  // The internal trainer is a third employee who is not a trainer yet, so real
  // trainer records are never touched.
  const trnRow = await q(`
    SELECT m.EMPCODE FROM HR_EMP_MASTER m
     WHERE m.UNIT_ID = :c AND NVL(m.STATUS,'A') = 'A' AND m.EMPCODE NOT IN (:e, :h)
       AND NOT EXISTS (SELECT 1 FROM HR_TRAINER t WHERE t.EMPCODE = m.EMPCODE)
     FETCH FIRST 1 ROWS ONLY`, { c: compc, e: emp, h: hod });
  if (!trnRow.length) { console.log('No spare employee to act as trainer.'); return; }
  const trn = String(trnRow[0][0]);
  console.log(`employee ${emp}, HOD ${hod}, trainer ${trn}, company ${compc}\n`);
  const fy = fyOf();

  // Masters
  const cat = await master.saveCategory(compc, ACTOR, null, { name: `SMOKE ${Date.now()}` });
  created.categories.push(cat.category_id);
  const tr = await master.saveTrainer(compc, ACTOR, null, { trainer_type: 'I', empcode: trn, default_rate: 5000 });
  created.trainers.push(tr.trainer_id);
  let dupTrainer = false;
  try { await master.saveTrainer(compc, ACTOR, null, { trainer_type: 'I', empcode: trn }); } catch { dupTrainer = true; }
  check('one trainer record per internal employee', dupTrainer);

  // Trainer portal — profile, rate / free, slots
  const notTrainer = await trainerSvc.getProfile(emp);
  check('non-trainer has no portal', notTrainer.is_trainer === false);
  await trainerSvc.updateProfile(trn, { expertise: 'Excel', bio: 'Ten years of finance', qualifications: 'ACCA', is_free: true, rate_unit: 'HOUR' });
  const prof = await trainerSvc.getProfile(trn);
  check('trainer updates own profile (free)', prof.is_trainer && prof.trainer.is_free && prof.trainer.default_rate === 0 && prof.trainer.bio === 'Ten years of finance');
  const slotDay = new Date(Date.now() + 3 * 86400000);
  const slotYmd = `${slotDay.getFullYear()}-${String(slotDay.getMonth() + 1).padStart(2, '0')}-${String(slotDay.getDate()).padStart(2, '0')}`;
  await trainerSvc.addSlot(trn, { slot_date: slotYmd, time_from: '10:00', time_to: '12:00', remarks: 'smoke' });
  let overlap = false;
  try { await trainerSvc.addSlot(trn, { slot_date: slotYmd, time_from: '11:00', time_to: '13:00' }); } catch { overlap = true; }
  check('overlapping slot rejected', overlap);
  const hrSlots = await master.listTrainerSlots(compc, tr.trainer_id);
  check('HR sees trainer free slots', hrSlots.length === 1 && hrSlots[0].time_from === '10:00');
  const course = await master.saveCourse(compc, ACTOR, null, {
    title: 'SMOKE Excel Advanced', category_id: cat.category_id, training_type: 'TECHNICAL', default_mode: 'PHYSICAL',
    duration_hrs: 8, cert_required: true, pass_pct: 70, min_attend_pct: 80,
  });
  created.courses.push(course.course_id);
  check('course code generated', /^TRN-\d{4}$/.test(course.course_code), course.course_code);

  const existingBudget = (await master.getBudget(compc, fy)).lines.find((l) => l.dept_no === null);
  if (!existingBudget) {
    const b = await master.saveBudget(compc, ACTOR, { fy_year: fy, dept_no: null, amount: 1000 });
    created.budgets.push(b.budget_id);
  }

  // Tests
  const post = await tests.saveTest(compc, ACTOR, course.course_id, 'POST', { time_limit_min: 5 });
  const q1 = await tests.saveQuestion(compc, post.test_id, null, { question_text: '2+2?', opt_a: '3', opt_b: '4', correct_opt: 'B', marks: 1 });
  const q2 = await tests.saveQuestion(compc, post.test_id, null, { question_text: 'Sum shortcut?', opt_a: 'Alt+=', opt_b: 'Ctrl+S', opt_c: 'F5', correct_opt: 'A', marks: 1 });
  const ct = await tests.getCourseTests(compc, course.course_id);
  check('post test has 2 questions', ct.post?.questions.length === 2);

  // Employee request → HOD → HR
  const cat2 = await requests.employeeCatalog(emp);
  check('catalog lists the course', cat2.courses.some((c) => c.course_id === course.course_id));
  const req = await requests.createMyRequest(emp, { course_id: course.course_id, reason: 'smoke test request', priority: 'HIGH' });
  created.requests.push(req.request_id);
  check('request starts with HOD 1', req.status === 'PENDING_HOD1', req.status);
  let dup = false;
  try { await requests.createMyRequest(emp, { course_id: course.course_id, reason: 'duplicate' }); } catch { dup = true; }
  check('duplicate open request rejected', dup);

  const hodView = await requests.hodRequests(hod);
  const mine = hodView.items.find((i) => i.request_id === req.request_id);
  check('HOD sees request as their turn', !!mine?.my_turn);
  let notHod = false;
  try { await requests.hodDecide(emp, req.request_id, { decision: 'approve' }); } catch { notHod = true; }
  check('employee cannot approve own request', notHod);
  const d1 = await requests.hodDecide(hod, req.request_id, { decision: 'approve', remarks: 'ok' });
  check('HOD approval moves to HR', d1.status === 'PENDING_HR', d1.status);

  // Session + booking
  const today = new Date();
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const tomorrow = new Date(today.getTime() + 86400000);
  const ses = await sessions.saveSession(compc, ACTOR, null, {
    course_id: course.course_id, trainer_id: tr.trainer_id, mode: 'PHYSICAL', venue: 'Board room',
    start_date: ymd(today), end_date: ymd(tomorrow), capacity: 1, trainer_cost: 5000, status: 'OPEN',
  });
  created.sessions.push(ses.session_id);

  // Trainer builds the pre-test and writes the outline
  const tc = await trainerSvc.myTestCourses(trn);
  check('trainer sees course they teach for tests', tc.some((x) => x.course_id === course.course_id));
  const pre = await trainerSvc.saveTest(trn, course.course_id, 'PRE', { time_limit_min: 5 });
  await trainerSvc.saveQuestion(trn, pre.test_id, null, { question_text: 'Excel is a?', opt_a: 'Spreadsheet', opt_b: 'Browser', correct_opt: 'A' });
  let foreignTest = false;
  try { await trainerSvc.courseTests(emp, course.course_id); } catch { foreignTest = true; }
  check('non-trainer cannot edit tests', foreignTest);
  await trainerSvc.saveOutlineText(ses.session_id, { empcode: trn, actor: trn }, 'Day 1: formulas\nDay 2: pivot tables');
  await trainerSvc.saveOutlineFile(ses.session_id, { empcode: trn, actor: trn }, { originalname: 'roadmap.txt', buffer: Buffer.from('roadmap') });
  let badExt = false;
  try { await trainerSvc.saveOutlineFile(ses.session_id, { empcode: trn, actor: trn }, { originalname: 'x.exe', buffer: Buffer.from('x') }); } catch { badExt = true; }
  check('outline rejects disallowed file types', badExt);
  let otherOutline = false;
  try { await trainerSvc.saveOutlineText(ses.session_id, { empcode: emp, actor: emp }, 'hack'); } catch { otherOutline = true; }
  check('only the session trainer edits the outline', otherOutline);
  check('budget warning raised when over budget', existingBudget ? true : ses.warnings.length > 0, ses.warnings.join(' | '));

  const d2 = await requests.hrDecide(compc, ACTOR, req.request_id, { decision: 'approve', session_id: ses.session_id });
  check('HR approve + book', d2.status === 'BOOKED', d2.status);
  const add = await sessions.addParticipants(compc, ACTOR, ses.session_id, [hod]);
  check('capacity enforced on direct assignment', add.added.length === 0 && add.skipped.length === 1, add.skipped[0]?.reason);

  const detail = await sessions.getSession(compc, ses.session_id);
  const part = detail.participants.find((p) => p.empcode === emp);
  check('participant booked from request', part?.request_id === req.request_id);

  // Attendance (both days present), post-test, completion
  for (const d of [today, tomorrow]) {
    await sessions.saveAttendance(compc, ACTOR, ses.session_id, { date: ymd(d), rows: [{ participant_id: part.participant_id, status: 'P', hours: 4 }] });
  }
  const mt = (await sessions.listMyTrainings(emp)).find((t) => t.participant_id === part.participant_id);
  check('post-test available once in progress', !!mt?.can_take_post);
  check('participant sees the trainer outline', mt?.outline_text.startsWith('Day 1') && mt?.outline_file_name === 'roadmap.txt');
  const of = await trainerSvc.outlineFileFor(ses.session_id, { empcode: emp });
  check('participant can download outline document', fs.readFileSync(of.abs, 'utf8') === 'roadmap');
  let strangerFile = false;
  try { await trainerSvc.outlineFileFor(ses.session_id, { empcode: '0000000' }); } catch { strangerFile = true; }
  check('outsiders cannot download the outline', strangerFile);
  const tview = await trainerSvc.getMySession(trn, ses.session_id);
  check('trainer sees their participants', tview.participants.length === 1);
  await trainerSvc.addMyFeedback(trn, ses.session_id, { rating_overall: 4, comments: 'engaged group' });
  const attempt = await tests.startAttempt(emp, part.participant_id, 'POST');
  check('attempt hides correct answers', attempt.questions.every((x) => !('correct' in x) && !('correct_opt' in x)));
  const resumed = await tests.startAttempt(emp, part.participant_id, 'POST');
  check('restart resumes the same attempt', resumed.attempt_id === attempt.attempt_id);
  const res = await tests.submitAttempt(emp, attempt.attempt_id, { [q1.question_id]: 'B', [q2.question_id]: 'A' });
  check('full marks scored', res.pct === 100 && res.passed, JSON.stringify(res));
  let again = false;
  try { await tests.startAttempt(emp, part.participant_id, 'POST'); } catch { again = true; }
  check('no second attempt without retest', again);

  await sessions.submitMyFeedback(emp, part.participant_id, { rating_overall: 5, rating_trainer: 4, comments: 'smoke' });
  const done = await sessions.completeSession(compc, ACTOR, ses.session_id);
  check('completion evaluates participant', done.completed === 1 && done.certificates === 1, JSON.stringify(done));
  check('trainer certificate issued', /^TCERT-\d+-\d{4}-\d{5}$/.test(done.trainer_certificate || ''), done.trainer_certificate);
  const tcert = await loadTrainerCertificate(ses.session_id, { empcode: trn });
  const tpdf = await buildCertificatePdf(tcert);
  check('trainer certificate PDF generated', tpdf.subarray(0, 4).toString() === '%PDF', `${tpdf.length} bytes`);
  let notTheirs = false;
  try { await loadTrainerCertificate(ses.session_id, { empcode: emp }); } catch { notTheirs = true; }
  check('only the trainer downloads the trainer certificate', notTheirs);
  const fbTrainer = (await sessions.getSession(compc, ses.session_id)).feedback.filter((f) => f.given_by_type === 'TRAINER');
  check('HR sees trainer feedback', fbTrainer.length === 1);

  const reqAfter = (await requests.listMyRequests(emp)).find((r) => r.request_id === req.request_id);
  check('request marked completed', reqAfter?.status === 'COMPLETED', reqAfter?.status);

  const cert = await loadCertificate(part.participant_id, { empcode: emp });
  check('certificate number format', /^CERT-\d+-\d{4}-\d{5}$/.test(cert.cert_no), cert.cert_no);
  const pdf = await buildCertificatePdf(cert);
  check('certificate PDF generated', pdf.length > 1000 && pdf.subarray(0, 4).toString() === '%PDF', `${pdf.length} bytes`);
  let foreign = false;
  try { await loadCertificate(part.participant_id, { empcode: hod }); } catch { foreign = true; }
  check("another employee cannot load someone's certificate", foreign);

  // Dashboard + every report must run
  const dash = await reports.dashboard(compc, fy);
  check('dashboard runs', typeof dash.employees_trained === 'number');
  for (const type of reports.REPORT_TYPES) {
    const r = await reports.runReport(compc, type, { empcode: emp, from: `${fy}-07-01`, to: `${fy + 1}-06-30` });
    check(`report ${type}`, Array.isArray(r.rows), `${r.rows.length} row(s)`);
  }
  const hist = await requests.requestHistory(compc, req.request_id);
  check('audit trail recorded', hist.length >= 3, hist.map((h) => h.action).join(', '));
}

try {
  await main();
} catch (e) {
  failures++;
  console.error('ERROR', e);
} finally {
  await cleanup();
  console.log(`\n${failures ? `${failures} FAILED` : 'ALL PASSED'}`);
  process.exit(failures ? 1 : 0);
}
