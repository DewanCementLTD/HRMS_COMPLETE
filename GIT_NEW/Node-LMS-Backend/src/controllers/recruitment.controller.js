import fs from 'fs';
import path from 'path';
import * as recruitmentService from "../services/recruitment.service.js";
import { resolveFilterLists, getAdminRights } from "../services/adminRights.service.js";

import { logger } from '../utils/logger.js';
const handleResult = (res, result) => {
  if (result.status === "error") {
    return res.status(result.code || 400).json({ detail: result.message });
  }
  return res.json(result);
};

const _getScope = async (req, res) => {
  const validatedQuery = res.locals?.validated?.query || {};
  const validatedBody = res.locals?.validated?.body || {};
  
  const admin_card = validatedQuery.admin_card_no || req.query.admin_card_no || validatedBody.admin_card_no || req.body?.admin_card_no;
  const c = validatedQuery.compc || req.query.compc || validatedBody.compc || req.body?.compc;
  const b = validatedQuery.brnch || req.query.brnch || validatedBody.brnch || req.body?.brnch;

  const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card, c, b);
  return { final_c: finalCompanies, final_b: finalBranches, req_c: c, req_b: b, admin_card };
};

// Which company/branch to STAMP on a newly created row — a scalar, not the
// filter lists used for reads. Faithful port of the identical block in FastAPI's
// create_job / create_candidate (routers/recruitment_router.py):
//   - company: the admin's selection when it is within their rights, otherwise
//     their FIRST allowed company. Never null when the admin has any rights, or
//     the row is created company-less and disappears from every scoped listing.
//   - branch: stamped only when a specific branch is selected; under
//     "All Branches" it stays NULL so the row is company-wide.
const _stampScope = async (adminCard, compc, brnch) => {
  const { allowedCompanies, allowedBranches } = await getAdminRights(adminCard);
  const comp =
    compc && (!allowedCompanies.length || allowedCompanies.includes(String(compc)))
      ? compc
      : (allowedCompanies.length ? allowedCompanies[0] : null);
  const brn =
    brnch && (!allowedBranches.length || allowedBranches.includes(String(brnch)))
      ? brnch
      : null;
  return { comp, brn };
};

// Port of FastAPI _require_candidate_access: 404 "Candidate not found" when the
// candidate is missing OR belongs to a company outside the admin's scope (mirrors
// the inline check used by getCandidate/updateCandidate). Returns the candidate
// row on success, or null after having already sent the 404 response.
const _requireCandidateAccess = async (req, res, candidateId) => {
  const cand = await recruitmentService.getCandidate(candidateId);
  if (!cand) {
    res.status(404).json({ detail: "Candidate not found" });
    return null;
  }
  const { final_c } = await _getScope(req, res);
  if (final_c.length > 0 && cand.compc && !final_c.includes(String(cand.compc))) {
    res.status(404).json({ detail: "Candidate not found" });
    return null;
  }
  return cand;
};

// ===================================
// JOBS
// ===================================

export const listJobs = async (req, res, next) => {
  try {
    const { status } = req.query;
    const { final_c, final_b } = await _getScope(req, res);
    const items = await recruitmentService.listJobs(status, final_c, final_b);
    res.json({ items });
  } catch (err) {
    next(err);
  }
};

export const createJob = async (req, res, next) => {
  try {
    const data = res.locals.validated.body;
    const { req_c, req_b, admin_card } = await _getScope(req, res);

    // Stamp COMPC/BRNCH on the new job. These were previously not passed at all,
    // so the service fell back to its `compc = null` default and every job was
    // written company-less — created "successfully" (200) but invisible in the
    // company-scoped job list.
    const { comp, brn } = await _stampScope(admin_card, req_c, req_b);

    handleResult(res, await recruitmentService.createJob(data, admin_card, comp, brn));
  } catch (err) {
    next(err);
  }
};

export const getJob = async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const job = await recruitmentService.getJob(job_id);
    if (!job) return res.status(404).json({ detail: "Job not found" });
    
    const { final_c } = await _getScope(req, res);
    if (final_c.length > 0 && job.compc && !final_c.includes(String(job.compc))) {
      return res.status(404).json({ detail: "Job not found" });
    }
    
    res.json(job);
  } catch (err) {
    next(err);
  }
};

export const updateJob = async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const data = res.locals.validated.body;
    
    const job = await recruitmentService.getJob(job_id);
    if (!job) return res.status(404).json({ detail: "Job not found" });
    
    const { final_c } = await _getScope(req, res);
    if (final_c.length > 0 && job.compc && !final_c.includes(String(job.compc))) {
      return res.status(404).json({ detail: "Job not found" });
    }
    
    handleResult(res, await recruitmentService.updateJob(job_id, data));
  } catch (err) {
    next(err);
  }
};

// ===================================
// APPLICATIONS
// ===================================

export const listApplications = async (req, res, next) => {
  try {
    const { status, job_id } = req.query;
    const { final_c, final_b } = await _getScope(req, res);
    // Argument order is (jobId, status) — passing them the other way round binds
    // the status text to the numeric JOB_ID column and fails with ORA-01722.
    const items = await recruitmentService.listApplications(job_id, status, final_c, final_b);
    res.json({ items: recruitmentService.lowerKeys(items) });
  } catch (err) {
    next(err);
  }
};

export const createApplication = async (req, res, next) => {
  try {
    const data = res.locals.validated.body;
    const { admin_card } = await _getScope(req, res);
    handleResult(res, await recruitmentService.createApplication(data, admin_card));
  } catch (err) {
    next(err);
  }
};

export const getApplication = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const app = await recruitmentService.getApplication(app_id);
    if (!app) return res.status(404).json({ detail: "Application not found" });
    res.json(recruitmentService.lowerKeys(app));
  } catch (err) {
    next(err);
  }
};

export const updateApplicationStatus = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const { status, notes } = res.locals.validated.body;
    handleResult(res, await recruitmentService.updateApplicationStatus(app_id, status, notes));
  } catch (err) {
    next(err);
  }
};

// ===================================
// INTERVIEWS
// ===================================

export const listInterviews = async (req, res, next) => {
  try {
    const { status, app_id } = req.query;
    const { final_c, final_b } = await _getScope(req, res);
    // Argument order is (appId, status) — see listApplications above.
    const items = await recruitmentService.listInterviews(app_id, status, final_c, final_b);
    res.json({ items: recruitmentService.lowerKeys(items) });
  } catch (err) {
    next(err);
  }
};

export const createInterview = async (req, res, next) => {
  try {
    const data = res.locals.validated.body;
    const { admin_card } = await _getScope(req, res);
    handleResult(res, await recruitmentService.createInterview(data, admin_card));
  } catch (err) {
    next(err);
  }
};

export const updateInterview = async (req, res, next) => {
  try {
    const { interview_id } = req.params;
    const data = res.locals.validated.body;
    handleResult(res, await recruitmentService.updateInterview(interview_id, data));
  } catch (err) {
    next(err);
  }
};

// ===================================
// OFFERS
// ===================================

export const listOffers = async (req, res, next) => {
  try {
    const { status } = req.query;
    const { final_c, final_b } = await _getScope(req, res);
    const items = await recruitmentService.listOffers(status, final_c, final_b);
    res.json({ items: recruitmentService.lowerKeys(items) });
  } catch (err) {
    next(err);
  }
};

export const createOffer = async (req, res, next) => {
  try {
    const data = res.locals.validated.body;
    const { admin_card } = await _getScope(req, res);
    handleResult(res, await recruitmentService.createOffer(data, admin_card));
  } catch (err) {
    next(err);
  }
};

export const updateOffer = async (req, res, next) => {
  try {
    const { offer_id } = req.params;
    const data = res.locals.validated.body;
    handleResult(res, await recruitmentService.updateOffer(offer_id, data));
  } catch (err) {
    next(err);
  }
};

// ===================================
// ANALYTICS
// ===================================

export const getAnalytics = async (req, res, next) => {
  try {
    const { final_c, final_b } = await _getScope(req, res);
    res.json(await recruitmentService.getAnalytics(final_c, final_b));
  } catch (err) {
    next(err);
  }
};

// ===================================
// CANDIDATES (Talent Pool)
// ===================================

export const listCandidates = async (req, res, next) => {
  try {
    const { search } = req.query;
    const { final_c, final_b } = await _getScope(req, res);
    const items = await recruitmentService.listCandidates(search, final_c, final_b);
    res.json({ items: recruitmentService.lowerKeys(items) });
  } catch (err) {
    next(err);
  }
};

export const createCandidate = async (req, res, next) => {
  try {
    const data = res.locals.validated.body;
    const { req_c, req_b, admin_card } = await _getScope(req, res);

    // Same stamping rules as createJob. This previously passed the final_c /
    // final_b ARRAYS into a scalar parameter, which only produced the right
    // COMPC by accident (rToInt(['1']) === 1) and picked the wrong company as
    // soon as the admin had rights to more than one.
    const { comp, brn } = await _stampScope(admin_card, req_c, req_b);

    const result = await recruitmentService.createCandidate(data, comp, brn);
    if (result.status === "duplicate") {
      return res.status(409).json({ detail: result.message, candidate_id: result.candidate_id });
    }
    handleResult(res, result);
  } catch (err) {
    next(err);
  }
};

export const getCandidate = async (req, res, next) => {
  try {
    const { candidate_id } = req.params;
    const cand = await recruitmentService.getCandidate(candidate_id);
    if (!cand) return res.status(404).json({ detail: "Candidate not found" });
    
    const { final_c } = await _getScope(req, res);
    if (final_c.length > 0 && cand.compc && !final_c.includes(String(cand.compc))) {
      return res.status(404).json({ detail: "Candidate not found" });
    }
    
    res.json(recruitmentService.lowerKeys(cand));
  } catch (err) {
    next(err);
  }
};

export const updateCandidate = async (req, res, next) => {
  try {
    const { candidate_id } = req.params;
    const data = res.locals.validated.body;
    handleResult(res, await recruitmentService.updateCandidate(candidate_id, data));
  } catch (err) {
    next(err);
  }
};

// ===================================
// INTERVIEW PANEL
// ===================================

export const listPanelPool = async (req, res, next) => {
  try {
    const { final_c, final_b } = await _getScope(req, res);
    // FastAPI exposes include_inactive as a query param; it was being dropped
    // here, so the flag silently had no effect.
    const includeInactive = ['true', '1', 'yes'].includes(String(req.query.include_inactive).toLowerCase());
    const items = await recruitmentService.listPanelPool(final_c, final_b, includeInactive);
    res.json(recruitmentService.lowerKeys(items));
  } catch (err) {
    next(err);
  }
};

export const addPanelMembers = async (req, res, next) => {
  try {
    const { empcodes } = res.locals.validated.body;
    const { final_c, final_b, admin_card } = await _getScope(req, res);
    handleResult(res, await recruitmentService.addPanelMembers(empcodes, final_c, final_b, admin_card));
  } catch (err) {
    next(err);
  }
};

export const deactivatePanelRow = async (req, res, next) => {
  try {
    const { id } = req.params;
    handleResult(res, await recruitmentService.deactivatePanelRow(id));
  } catch (err) {
    next(err);
  }
};

export const deactivatePanelMember = async (req, res, next) => {
  try {
    const { empcode } = res.locals.validated.body;
    const { final_c, final_b } = await _getScope(req, res);
    handleResult(res, await recruitmentService.deactivatePanelMember(empcode, final_c, final_b));
  } catch (err) {
    next(err);
  }
};

export const panelOptionsForApp = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const result = await recruitmentService.panelOptionsForApp(app_id);
    if (result.status === "error") {
      return res.status(404).json({ detail: result.message });
    }
    result.items = recruitmentService.lowerKeys(result.items);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createInterviewAssignments = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const data = res.locals.validated.body;
    const { admin_card } = await _getScope(req, res);
    handleResult(res, await recruitmentService.createInterviewAssignments(app_id, data, admin_card));
  } catch (err) {
    next(err);
  }
};

export const listInterviewAssignments = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const items = await recruitmentService.listInterviewAssignments(app_id);
    res.json({ items: recruitmentService.lowerKeys(items) });
  } catch (err) {
    next(err);
  }
};

// ===================================
// NOTIFICATIONS
// ===================================

export const listNotificationTemplates = async (req, res, next) => {
  try {
    const { event_type, notification_type, recipient_type } = req.query;
    const items = await recruitmentService.listNotificationTemplates(event_type, notification_type, recipient_type);
    res.json({ items: recruitmentService.lowerKeys(items) });
  } catch (err) {
    next(err);
  }
};

export const createNotificationSelections = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const data = res.locals.validated.body;
    const { admin_card } = await _getScope(req, res);
    handleResult(res, await recruitmentService.createNotificationSelections(app_id, data, admin_card));
  } catch (err) {
    next(err);
  }
};

export const listNotificationSelections = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const items = await recruitmentService.listNotificationSelections(app_id);
    res.json({ items: recruitmentService.lowerKeys(items) });
  } catch (err) {
    next(err);
  }
};


// ===================================
// AI CV EVALUATION & MATCHING PIPELINE
// ===================================



export const matchCandidates = async (req, res, next) => {
  try {
    const { job_id } = req.params;
    const { top = 20, deep = false } = req.query;
    const { final_c, final_b } = await _getScope(req, res);
    
    let result;
    if (deep === 'true' || deep === true) {
      result = await recruitmentService.matchCandidatesDeep(job_id, top, final_c, final_b);
    } else {
      result = await recruitmentService.matchCandidatesForJob(job_id, top, final_c, final_b);
    }
    
    if (result.status === "error") {
      return res.status(404).json({ detail: result.message });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const topCandidates = async (req, res, next) => {
  try {
    const { job_id } = req.params;
    let top_k = req.query.top_k ? parseInt(req.query.top_k, 10) : parseInt(process.env.TOP_K || '10', 10);
    const { final_c, final_b } = await _getScope(req, res);
    
    const result = await recruitmentService.rankJobApplicants(job_id, top_k, final_c, final_b);
    if (result.status === "error") {
      return res.status(404).json({ detail: result.message });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getApplicationEvaluation = async (req, res, next) => {
  try {
    const { app_id } = req.params;
    const app = await recruitmentService.getApplication(app_id);
    if (!app) return res.status(404).json({ detail: "Application not found" });
    
    const ev = await recruitmentService.getApplicationEvaluation(app_id);
    if (!ev) return res.status(404).json({ detail: "This application has not been AI-evaluated yet" });
    
    res.json(ev);
  } catch (err) {
    next(err);
  }
};

const safeCvFilename = (name) => {
  const base = path.basename(name || "cv.pdf");
  const ext = path.extname(base);
  let stem = path.basename(base, ext) || "cv";
  stem = stem.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "cv";
  return `${stem}_${Date.now()}.pdf`;
};

const resolveDropDirs = async (req, res, job_id) => {
  const { final_c, final_b, admin_card } = await _getScope(req, res);
  let dirs;
  
  if (job_id) {
    const scope = await recruitmentService.getJobScope(job_id);
    if (!scope) throw { status: 404, detail: "Job not found" };
    
    const { finalCompanies } = await resolveFilterLists(admin_card, null, null);
    if (finalCompanies.length > 0 && scope.compc !== null && !finalCompanies.includes(String(scope.compc))) {
      throw { status: 404, detail: "Job not found" };
    }
    
    dirs = await recruitmentService.jobCvDirs(job_id);
    if (!dirs) throw { status: 404, detail: "Job not found" };
  } else {
    // If no compc is specified, use the first allowed company (same as python fallback)
    let targetComp = req.query.compc || req.body?.compc;
    const { finalCompanies, finalBranches } = await resolveFilterLists(admin_card, targetComp, null);
    if (finalCompanies.length > 0 && (!targetComp || !finalCompanies.includes(String(targetComp)))) {
      targetComp = finalCompanies[0];
    }
    
    let targetBranch = req.query.brnch || req.body?.brnch;
    if (finalBranches.length > 0 && (!targetBranch || !finalBranches.includes(String(targetBranch)))) {
      targetBranch = null; // Default to company-wide for pool
    }
    
    dirs = await recruitmentService.poolCvDirs(targetComp, targetBranch);
  }
  
  fs.mkdirSync(dirs.buffer_dir, { recursive: true });
  
  try {
    fs.writeFileSync(path.join(dirs.buffer_dir, "_scope.json"), JSON.stringify({
      compc: dirs.compc,
      brnch: dirs.brnch,
      job_id: job_id ? parseInt(job_id, 10) : null
    }));
  } catch (e) {
    // pass
  }
  
  return dirs;
};

const writeCvToBuffer = async (bufferDir, file) => {
  const ext = path.extname(file.originalname || "").replace(/^\./, "").toLowerCase();
  if (ext !== "pdf") {
    return { filename: file.originalname, saved_as: null, queued: false, error: "Only PDF CVs can be AI-screened" };
  }
  
  const saved = safeCvFilename(file.originalname);
  try {
    fs.writeFileSync(path.join(bufferDir, saved), file.buffer);
  } catch (e) {
    return { filename: file.originalname, saved_as: null, queued: false, error: `Failed to queue: ${e.message}` };
  }
  return { filename: file.originalname, saved_as: saved, queued: true };
};

export const uploadCvs = async (req, res, next) => {
  try {
    const job_id = req.query.job_id ? parseInt(req.query.job_id, 10) : null;
    const files = req.files || [];
    
    if (files.length === 0) {
      return res.status(400).json({ detail: "No files uploaded" });
    }
    if (files.length > 20) {
      return res.status(400).json({ detail: "Upload at most 20 CVs at once" });
    }
    
    let dirs;
    try {
      dirs = await resolveDropDirs(req, res, job_id);
    } catch (e) {
      return res.status(e.status || 400).json({ detail: e.detail || e.message });
    }
    
    const results = [];
    for (const f of files) {
      results.push(await writeCvToBuffer(dirs.buffer_dir, f));
    }
    
    const queued = results.filter(r => r.queued).length;
    res.json({ status: "success", job_id, queued, total: results.length, results });
  } catch (err) {
    next(err);
  }
};

export const cvStatus = async (req, res, next) => {
  try {
    const job_id = req.query.job_id ? parseInt(req.query.job_id, 10) : null;
    const filenamesStr = req.query.files || "";
    
    let dirs;
    try {
      dirs = await resolveDropDirs(req, res, job_id);
    } catch (e) {
      return res.status(e.status || 400).json({ detail: e.detail || e.message });
    }
    
    const names = filenamesStr.split(",").map(n => n.trim()).filter(Boolean);
    const result = recruitmentService.cvStatusInDirs(dirs.buffer_dir, dirs.archive_dir, names);
    
    res.json({ job_id, ...result });
  } catch (err) {
    next(err);
  }
};

export const uploadCandidateCv = async (req, res, next) => {
  try {
    const { candidate_id } = req.params;
    const file = req.file;
    if (!file) return res.status(400).json({ detail: "No file uploaded" });

    const cand = await _requireCandidateAccess(req, res, candidate_id);
    if (!cand) return;

    const ext = path.extname(file.originalname || "").replace(/^\./, "").toLowerCase();
    if (ext !== "pdf") {
      return res.status(400).json({ detail: "Only PDF CVs can be AI-screened" });
    }

    let job_id = req.query.job_id || req.body?.job_id ? parseInt(req.query.job_id || req.body?.job_id, 10) : null;
    if (!job_id) {
      job_id = await recruitmentService.getCandidateLatestJobId(candidate_id);
    }

    let dirs;
    if (job_id) {
      dirs = await recruitmentService.jobCvDirs(job_id);
    }
    if (!dirs) {
      dirs = await recruitmentService.poolCvDirs(cand.compc, cand.brnch);
    }

    fs.mkdirSync(dirs.buffer_dir, { recursive: true });

    try {
      fs.writeFileSync(path.join(dirs.buffer_dir, "_scope.json"), JSON.stringify({
        compc: dirs.compc,
        brnch: dirs.brnch,
        job_id: job_id ? parseInt(job_id, 10) : null
      }));
    } catch (e) {
      // pass
    }

    const saved = safeCvFilename(file.originalname);
    const absPath = path.join(dirs.buffer_dir, saved);
    fs.writeFileSync(absPath, file.buffer);

    const { DOCS_BASE } = await import('../services/documents.service.js');
    const relPath = path.relative(DOCS_BASE, absPath);

    const result = await recruitmentService.setCandidateCv(candidate_id, file.originalname || saved, relPath);
    if (result.status === "error") {
      return res.status(400).json({ detail: result.message });
    }

    res.json({
      status: "success",
      queued: true,
      candidate_id: parseInt(candidate_id, 10),
      job_id: job_id || null,
      cv_file_name: file.originalname || saved,
      saved_as: saved,
      message: "CV queued for AI screening and profile updating"
    });
  } catch (err) {
    next(err);
  }
};

export const downloadCandidateCv = async (req, res, next) => {
  try {
    const { candidate_id } = req.params;
    const { inline } = req.query;

    if (!(await _requireCandidateAccess(req, res, candidate_id))) return;

    const row = await recruitmentService.getCandidateCvPath(candidate_id);
    if (!row || !row[1]) return res.status(404).json({ detail: "No CV uploaded for this candidate" });
    
    const { DOCS_BASE } = await import('../services/documents.service.js');
    const absPath = path.isAbsolute(row[1]) ? row[1] : path.join(DOCS_BASE, row[1]);
    
    if (!fs.existsSync(absPath)) return res.status(404).json({ detail: "CV file not found on disk" });
    
    const fname = row[0] || path.basename(absPath);
    if (inline === 'true' || inline === true) {
      res.setHeader("Content-Disposition", `inline; filename="${fname}"`);
    } else {
      res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    }
    res.sendFile(absPath);
  } catch (err) {
    next(err);
  }
};

export const applyCandidate = async (req, res, next) => {
  try {
    const { candidate_id } = req.params;
    const { job_id, source } = res.locals.validated.body;

    if (!(await _requireCandidateAccess(req, res, candidate_id))) return;

    const result = await recruitmentService.createApplicationForCandidate(candidate_id, job_id, source);
    if (result.status === "error") {
      return res.status(400).json({ detail: result.message });
    }
    
    const app_id = result.application_id;
    
    // Kick off evaluation in background (Promises don't block Express response)
    recruitmentService.evaluateApplication(app_id, candidate_id, job_id).catch(err => {
      logger.error({ err }, `Background evaluation failed for app ${app_id}`);
    });
    
    res.json({
      status: "success",
      application_id: app_id,
      created: result.created,
      evaluating: true,
      message: "Application created — AI is scoring the candidate for this job."
    });
  } catch (err) {
    next(err);
  }
};
