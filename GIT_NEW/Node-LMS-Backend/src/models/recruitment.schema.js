import { z } from "zod";

export const jobCreateSchema = z.object({
  body: z.object({
    job_title: z.string().min(1, "job_title is required"),
    dept_no: z.number().int().optional().nullable(),
    open_positions: z.number().int().default(1),
    job_desc: z.string().optional().nullable(),
    skills_req: z.string().optional().nullable(),
    employment_type: z.string().optional().nullable(),
    work_mode: z.string().optional().nullable(),
    nice_to_have_skills: z.string().optional().nullable(),
    min_experience_years: z.number().int().optional().nullable(),
    education_req: z.string().optional().nullable(),
    salary_min: z.number().optional().nullable(),
    salary_max: z.number().optional().nullable(),
  }),
});

export const jobUpdateSchema = z.object({
  body: z.object({
    job_title: z.string().optional().nullable(),
    dept_no: z.number().int().optional().nullable(),
    open_positions: z.number().int().optional().nullable(),
    job_desc: z.string().optional().nullable(),
    skills_req: z.string().optional().nullable(),
    employment_type: z.string().optional().nullable(),
    work_mode: z.string().optional().nullable(),
    nice_to_have_skills: z.string().optional().nullable(),
    min_experience_years: z.number().int().optional().nullable(),
    education_req: z.string().optional().nullable(),
    salary_min: z.number().optional().nullable(),
    salary_max: z.number().optional().nullable(),
    status: z.string().optional().nullable(),
  }),
});

export const applicationCreateSchema = z.object({
  body: z.object({
    job_id: z.number().int(),
    candidate_id: z.number().int().optional().nullable(),
    candidate_name: z.string().optional().nullable(),
    mobile: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    source: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});

export const applicationStatusUpdateSchema = z.object({
  body: z.object({
    status: z.string().min(1, "status is required"),
    notes: z.string().optional().nullable(),
  }),
});

export const interviewCreateSchema = z.object({
  body: z.object({
    app_id: z.number().int(),
    interview_date: z.string().optional().nullable(),
    interview_type: z.string().optional().nullable(),
    interviewer: z.string().optional().nullable(),
    feedback_owner: z.string().optional().nullable(),
  }),
});

export const interviewUpdateSchema = z.object({
  body: z.object({
    status: z.string().optional().nullable(),
    feedback: z.string().optional().nullable(),
    interview_date: z.string().optional().nullable(),
    interview_type: z.string().optional().nullable(),
    interviewer: z.string().optional().nullable(),
    feedback_owner: z.string().optional().nullable(),
    technical_rating: z.string().optional().nullable(),
    communication_rating: z.string().optional().nullable(),
    culture_fit_rating: z.string().optional().nullable(),
    recommendation: z.string().optional().nullable(),
  }),
});

export const offerCreateSchema = z.object({
  body: z.object({
    app_id: z.number().int(),
    salary_offered: z.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});

export const offerUpdateSchema = z.object({
  body: z.object({
    status: z.string().optional().nullable(),
    salary_offered: z.number().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});

// Candidate Sub-Schemas
const candidateEducationSchema = z.object({
  institution: z.string().optional().nullable(),
  degree: z.string().optional().nullable(),
  graduation_year: z.string().optional().nullable(),
});

const candidateExperienceSchema = z.object({
  company: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  duration: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export const candidateCreateSchema = z.object({
  body: z.object({
    candidate_name: z.string().min(1, "candidate_name is required"),
    email: z.string().optional().nullable(),
    mobile: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    preferred_job_title: z.string().optional().nullable(),
    profile_summary: z.string().optional().nullable(),
    education: z.array(candidateEducationSchema).optional().nullable(),
    experience: z.array(candidateExperienceSchema).optional().nullable(),
    skills: z.array(z.string()).optional().nullable(),
  }),
});

export const candidateUpdateSchema = z.object({
  body: z.object({
    candidate_name: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    mobile: z.string().optional().nullable(),
    location: z.string().optional().nullable(),
    preferred_job_title: z.string().optional().nullable(),
    profile_summary: z.string().optional().nullable(),
    education: z.array(candidateEducationSchema).optional().nullable(),
    experience: z.array(candidateExperienceSchema).optional().nullable(),
    skills: z.array(z.string()).optional().nullable(),
  }),
});

export const candidateApplySchema = z.object({
  body: z.object({
    job_id: z.number().int(),
    source: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }),
});

export const panelPoolAddSchema = z.object({
  body: z.object({
    empcodes: z.array(z.string()).min(1, "At least one empcode is required"),
  }),
});

export const panelPoolDeactivateSchema = z.object({
  body: z.object({
    empcode: z.string().min(1, "empcode is required"),
  }),
});

export const interviewAssignmentCreateSchema = z.object({
  body: z.object({
    empcodes: z.array(z.string()).min(1, "At least one empcode is required"),
    interview_type: z.string().min(1, "interview_type is required"),
    interview_date: z.string().min(1, "interview_date is required"),
    start_time: z.string().min(1, "start_time is required"),
    end_time: z.string().optional().nullable(),
    remarks: z.string().optional().nullable(),
    location_or_link: z.string().optional().nullable(),
    interview_mode: z.string().optional().nullable(),
  }),
});

const notificationSelectionItemSchema = z.object({
  template_id: z.number().int(),
  notification_type: z.string().min(1),
  recipient_type: z.string().min(1),
  empcodes: z.array(z.string()).optional().nullable(),
});

export const notificationSelectionsCreateSchema = z.object({
  body: z.object({
    selections: z.array(notificationSelectionItemSchema),
  }),
});

// Query-only schemas that enforce the numeric bounds FastAPI declares via
// Query(..., ge=1, le=200). Only the query is validated; params/body pass through
// the controller unchanged (unknown keys are stripped from res.locals.validated).
export const matchQuerySchema = z.object({
  query: z.object({
    top: z.coerce.number().int().min(1).max(200).default(20),
    deep: z.string().optional().nullable(),
  }).loose(),
});

export const topCandidatesQuerySchema = z.object({
  query: z.object({
    top_k: z.coerce.number().int().min(1).max(200).optional(),
  }).loose(),
});
