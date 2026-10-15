import { z } from "zod";

/**
 * Zod schemas for the Training Management routes (/training/*).
 *
 * HR routes: admin_card_no MUST be declared in every query schema — validate()
 * strips undeclared keys and requireHrAdmin reads it from there.
 * Employee / HOD routes: :card_no in the path must be the bearer token's own
 * card (requireEmployee enforces it).
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
const id = z.coerce.number().int().positive();
const money = z.coerce.number().min(0, "Cannot be negative");
const optText = (max) => z.string().max(max).optional().nullable();
const rating = z.coerce.number().int().min(1).max(5);
const pct = z.coerce.number().min(0).max(100);

const hrQuery = {
  admin_card_no: z.string().min(1, "admin_card_no is required"),
  compc: z.string().optional(),
  brnch: z.string().optional(),
};
const hr = (extra = {}) => z.object({ query: z.object({ ...hrQuery, ...extra }) });
const hrId = (name, extra = {}) => z.object({ params: z.object({ [name]: id }), query: z.object({ ...hrQuery, ...extra }) });
const hrBody = (body, params) => z.object({
  ...(params ? { params: z.object(params) } : {}),
  query: z.object(hrQuery),
  body,
});

const card = { card_no: z.string().min(1, "card_no is required") };
const emp = (params = {}, body) => z.object({
  params: z.object({ ...card, ...params }),
  ...(body ? { body } : {}),
});

// ── HR: masters ────────────────────────────────────────────────────────────
export const hrListSchema = hr();
export const hrCoursesSchema = hr({ active: z.enum(["1", "0"]).optional() });
export const hrEmployeesSchema = hr({ dept: z.string().optional() });

const categoryBody = z.object({ name: z.string().trim().min(1, "Name is required").max(100), is_active: z.boolean().optional() });
export const categoryCreateSchema = hrBody(categoryBody);
export const categoryUpdateSchema = hrBody(categoryBody, { category_id: id });
export const categoryDeleteSchema = hrId("category_id");

const trainerBody = z.object({
  trainer_type: z.enum(["I", "E"]),
  empcode: optText(30),
  name: optText(100),
  organization: optText(150),
  phone: optText(30),
  email: z.union([z.literal(""), z.string().email("Invalid email").max(100)]).optional().nullable(),
  expertise: optText(300),
  default_rate: money.optional().nullable(),
  is_active: z.boolean().optional(),
  bio: optText(2000),
  qualifications: optText(1000),
  rate_unit: z.enum(["SESSION", "HOUR", "DAY"]).optional(),
  is_free: z.boolean().optional(),
});
export const trainerSlotsSchema = hrId("trainer_id");
export const trainerCreateSchema = hrBody(trainerBody);
export const trainerUpdateSchema = hrBody(trainerBody, { trainer_id: id });
export const trainerDeleteSchema = hrId("trainer_id");

const courseBody = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  category_id: id.optional().nullable(),
  training_type: z.enum(["TECHNICAL", "SOFT_SKILL", "COMPLIANCE", "SAFETY", "OTHER"]),
  default_mode: z.enum(["PHYSICAL", "ONLINE"]),
  duration_hrs: z.coerce.number().min(0).max(9999).optional().nullable(),
  description: optText(2000),
  cert_required: z.boolean().optional(),
  pass_pct: pct.optional(),
  min_attend_pct: pct.optional(),
  is_active: z.boolean().optional(),
});
export const courseCreateSchema = hrBody(courseBody);
export const courseUpdateSchema = hrBody(courseBody, { course_id: id });
export const courseDeleteSchema = hrId("course_id");

export const budgetGetSchema = hr({ fy: z.coerce.number().int().min(2000).max(2100).optional() });
export const budgetSaveSchema = hrBody(z.object({
  fy_year: z.coerce.number().int().min(2000).max(2100),
  dept_no: z.coerce.number().int().optional().nullable(),
  amount: money,
  remarks: optText(300),
}));
export const budgetDeleteSchema = hrId("budget_id");

// ── HR: sessions ───────────────────────────────────────────────────────────
export const sessionsListSchema = hr({
  status: z.enum(["PLANNED", "OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  from: date.optional(), to: date.optional(),
  course_id: z.coerce.number().int().optional(),
  fy: z.coerce.number().int().optional(),
});
export const bookableSessionsSchema = hr({ course_id: z.coerce.number().int().optional() });
export const sessionGetSchema = hrId("session_id");

const sessionBody = z.object({
  course_id: id,
  trainer_id: id.optional().nullable(),
  mode: z.enum(["PHYSICAL", "ONLINE"]),
  venue: optText(200),
  online_link: z.union([z.literal(""), z.string().url("Enter a full link (https://…)").max(500)]).optional().nullable(),
  start_date: date,
  end_date: date,
  time_from: z.union([z.literal(""), time]).optional().nullable(),
  time_to: z.union([z.literal(""), time]).optional().nullable(),
  total_hours: z.coerce.number().min(0).max(9999).optional().nullable(),
  capacity: z.coerce.number().int().min(1).max(10000),
  dept_no: z.coerce.number().int().optional().nullable(),
  trainer_cost: money.optional(),
  venue_cost: money.optional(),
  material_cost: money.optional(),
  other_cost: money.optional(),
  status: z.enum(["PLANNED", "OPEN"]).optional(),
  remarks: optText(1000),
});
export const sessionCreateSchema = hrBody(sessionBody);
export const sessionUpdateSchema = hrBody(sessionBody, { session_id: id });
export const sessionStatusSchema = hrBody(
  z.object({ status: z.enum(["PLANNED", "OPEN", "IN_PROGRESS", "CANCELLED"]), remarks: optText(300) }),
  { session_id: id },
);
export const sessionCompleteSchema = hrId("session_id");
export const participantsAddSchema = hrBody(
  z.object({ empcodes: z.array(z.string().min(1)).min(1, "Pick at least one employee").max(500) }),
  { session_id: id },
);
export const participantActionSchema = hrBody(z.object({ remarks: optText(300) }).optional().default({}), { session_id: id, participant_id: id });
export const participantAttemptsSchema = hrId("participant_id");
export const attendanceSaveSchema = hrBody(z.object({
  date,
  rows: z.array(z.object({
    participant_id: id,
    status: z.enum(["P", "A", "L"]),
    hours: z.coerce.number().min(0).max(24).optional().nullable(),
  })).min(1),
}), { session_id: id });
export const sessionFeedbackSchema = hrBody(z.object({
  given_by_type: z.enum(["TRAINER", "HR", "MANAGER"]),
  rating_content: rating.optional().nullable(),
  rating_trainer: rating.optional().nullable(),
  rating_overall: rating,
  comments: optText(1000),
}), { session_id: id });
export const certificateHrSchema = hrId("participant_id");

// ── HR: requests ───────────────────────────────────────────────────────────
export const hrRequestsSchema = hr({
  status: z.enum(["OPEN", "PENDING_HOD1", "PENDING_HOD2", "PENDING_HR", "APPROVED", "BOOKED", "COMPLETED", "REJECTED", "CANCELLED"]).optional(),
});
export const hrDecisionSchema = hrBody(z.object({
  decision: z.enum(["approve", "reject"]),
  remarks: optText(500),
  session_id: id.optional().nullable(),
  course_id: id.optional().nullable(),
}), { request_id: id });
export const requestHistorySchema = hrId("request_id");

// ── HR: tests ──────────────────────────────────────────────────────────────
export const courseTestsSchema = hrId("course_id");
const testBody = z.object({
  title: optText(200),
  time_limit_min: z.coerce.number().int().min(1).max(600).optional(),
  pass_pct: pct.optional().nullable(),
  shuffle: z.boolean().optional(),
  is_active: z.boolean().optional(),
});
export const testSaveSchema = hrBody(testBody, { course_id: id, kind: z.enum(["PRE", "POST"]) });
const questionBody = z.object({
  question_text: z.string().trim().min(1, "Question is required").max(1000),
  opt_a: z.string().trim().min(1, "Option A is required").max(500),
  opt_b: z.string().trim().min(1, "Option B is required").max(500),
  opt_c: optText(500),
  opt_d: optText(500),
  correct_opt: z.enum(["A", "B", "C", "D"]),
  marks: z.coerce.number().positive().max(100).optional(),
  is_active: z.boolean().optional(),
});
export const questionCreateSchema = hrBody(questionBody, { test_id: id });
export const questionUpdateSchema = hrBody(questionBody, { test_id: id, question_id: id });
export const questionDeleteSchema = z.object({ params: z.object({ test_id: id, question_id: id }), query: z.object(hrQuery) });

// ── HR: dashboard / reports ────────────────────────────────────────────────
export const dashboardSchema = hr({ fy: z.coerce.number().int().optional() });
export const reportSchema = z.object({
  params: z.object({ type: z.enum(["conducted", "employees", "cost", "assessment", "certificates", "trainers", "history"]) }),
  query: z.object({ ...hrQuery, from: date.optional(), to: date.optional(), dept: z.string().optional(), empcode: z.string().optional() }),
});

// ── Employee ───────────────────────────────────────────────────────────────
export const myCatalogSchema = emp();
export const myRequestsSchema = emp();
const requestBody = z.object({
  course_id: id.optional().nullable(),
  requested_topic: optText(300),
  reason: z.string().trim().min(5, "Tell HR briefly why you need this training").max(1000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  preferred_from: date.optional().nullable(),
  preferred_to: date.optional().nullable(),
}).refine((b) => b.course_id || (b.requested_topic && b.requested_topic.trim()), {
  message: "Pick a course or describe the training you need", path: ["requested_topic"],
}).refine((b) => !b.preferred_from || !b.preferred_to || b.preferred_to >= b.preferred_from, {
  message: "Preferred 'to' date is before 'from'", path: ["preferred_to"],
});
export const myRequestCreateSchema = emp({}, requestBody);
export const myRequestCancelSchema = emp({ request_id: id });
export const myTrainingsSchema = emp();
export const myTestStartSchema = emp({ participant_id: id, kind: z.enum(["PRE", "POST"]) });
export const myTestSubmitSchema = emp({ attempt_id: id }, z.object({
  answers: z.record(z.string(), z.enum(["A", "B", "C", "D"])).optional().default({}),
}));
export const myFeedbackSchema = emp({ participant_id: id }, z.object({
  rating_content: rating.optional().nullable(),
  rating_trainer: rating.optional().nullable(),
  rating_overall: rating,
  comments: optText(1000),
}));
export const myCertificateSchema = emp({ participant_id: id });

// ── HOD ────────────────────────────────────────────────────────────────────
export const hodListSchema = emp();
export const hodDecisionSchema = emp({ request_id: id }, z.object({
  decision: z.enum(["approve", "reject"]),
  remarks: optText(500),
}));
export const hodMemberSchema = emp({ empcode: z.string().min(1) });
export const hodNominateSchema = emp({}, z.object({
  empcode: z.string().min(1, "Pick a team member"),
  course_id: id.optional().nullable(),
  requested_topic: optText(300),
  reason: z.string().trim().min(5, "Add a short reason").max(1000),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  preferred_from: date.optional().nullable(),
  preferred_to: date.optional().nullable(),
}).refine((b) => b.course_id || (b.requested_topic && b.requested_topic.trim()), {
  message: "Pick a course or describe the training", path: ["requested_topic"],
}));

// ── HR: session outline / trainer certificate ─────────────────────────────
const outlineText = z.object({ text: z.string().max(4000, "Keep the outline under 4000 characters — attach a document for more").optional().nullable() });
export const hrOutlineTextSchema = hrBody(outlineText, { session_id: id });
export const hrSessionFileSchema = z.object({ params: z.object({ session_id: id }), query: z.object(hrQuery), body: z.any().optional() });

// ── Employee: outline document of a session they are booked on ────────────
export const myOutlineFileSchema = emp({ session_id: id });

// ── Trainer portal (internal trainers) ────────────────────────────────────
export const trainerMeSchema = emp();
export const trainerProfileSchema = emp({}, z.object({
  expertise: optText(300),
  bio: optText(2000),
  qualifications: optText(1000),
  phone: optText(30),
  email: z.union([z.literal(""), z.string().email("Invalid email").max(100)]).optional().nullable(),
  default_rate: money.optional().nullable(),
  rate_unit: z.enum(["SESSION", "HOUR", "DAY"]).optional(),
  is_free: z.boolean().optional(),
}));
export const trainerSlotAddSchema = emp({}, z.object({
  slot_date: date, time_from: time, time_to: time, remarks: optText(300),
}));
export const trainerSlotDeleteSchema = emp({ slot_id: id });
export const trainerSessionSchema = emp({ session_id: id });
export const trainerOutlineTextSchema = emp({ session_id: id }, outlineText);
export const trainerSessionFileSchema = z.object({ params: z.object({ ...card, session_id: id }), body: z.any().optional() });
export const trainerFeedbackSchema = emp({ session_id: id }, z.object({
  rating_content: rating.optional().nullable(),
  rating_overall: rating,
  comments: optText(1000),
}));
export const trainerCourseTestsSchema = emp({ course_id: id });
export const trainerTestSaveSchema = emp({ course_id: id, kind: z.enum(["PRE", "POST"]) }, testBody);
export const trainerQuestionCreateSchema = emp({ test_id: id }, questionBody);
export const trainerQuestionUpdateSchema = emp({ test_id: id, question_id: id }, questionBody);
export const trainerQuestionDeleteSchema = emp({ test_id: id, question_id: id });
