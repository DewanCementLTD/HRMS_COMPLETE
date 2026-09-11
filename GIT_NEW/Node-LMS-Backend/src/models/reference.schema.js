import { z } from "zod";

export const readFilterSchema = z.object({
  query: z.object({
    compc: z.string().optional(),
    brnch: z.string().optional(),
    admin_card_no: z.string().optional()
  }).passthrough()
});

const baseQuery = z.object({
  query: z.object({
    admin_card_no: z.string().optional(),
    compc: z.string().optional(),
    brnch: z.string().optional()
  }).passthrough()
});

export const addDeptSchema = z.object({
  body: z.object({
    dept_name: z.string().min(1)
  })
}).merge(baseQuery);

export const addGradeSchema = z.object({
  body: z.object({
    grade_cd: z.string().min(1),
    descr: z.string().min(1)
  })
}).merge(baseQuery);

export const addDesignationSchema = z.object({
  body: z.object({
    grade_cd: z.string().min(1),
    desg_desc: z.string().min(1)
  })
}).merge(baseQuery);

export const addEmpStatusSchema = z.object({
  body: z.object({
    descr: z.string().min(1)
  })
}).merge(baseQuery);

export const removeEmpStatusSchema = z.object({
  params: z.object({
    emp_status: z.string().min(1)
  })
}).merge(baseQuery);

export const addBankSchema = z.object({
  body: z.object({
    bnkname: z.string().min(1)
  })
}).merge(baseQuery);

export const removeBankSchema = z.object({
  params: z.object({
    bnkcode: z.string().min(1)
  })
}).merge(baseQuery);

export const addBankBranchSchema = z.object({
  body: z.object({
    bnkcode: z.string().min(1),
    brnname: z.string().min(1)
  })
}).merge(baseQuery);

export const removeBankBranchSchema = z.object({
  params: z.object({
    bnkcode: z.string().min(1),
    brncode: z.string().min(1)
  })
}).merge(baseQuery);

export const addQualificationSchema = z.object({
  body: z.object({
    descr: z.string().min(1)
  })
}).merge(baseQuery);

export const shiftSchema = z.object({
  body: z.object({
    shift: z.string().min(1),
    shift_desc: z.string().min(1)
  }).passthrough()
}).merge(baseQuery);

export const shiftUpdateSchema = z.object({
  params: z.object({
    pk: z.string().regex(/^\d+$/, "Input should be a valid integer, unable to parse string as an integer")
  }),
  body: z.object({
    shift: z.string().min(1),
    shift_desc: z.string().min(1)
  }).passthrough()
}).merge(baseQuery);

export const shiftIdSchema = z.object({
  params: z.object({
    pk: z.string().regex(/^\d+$/, "Input should be a valid integer, unable to parse string as an integer")
  })
}).merge(baseQuery);


export const addBloodGroupSchema = z.object({
  body: z.object({
    blood_group: z.string().min(1)
  })
}).merge(baseQuery);

export const addCadreSchema = z.object({
  body: z.object({
    cadre: z.string().min(1)
  })
}).merge(baseQuery);

export const addUnitSchema = z.object({
  body: z.object({
    unit_name: z.string().min(1)
  })
}).merge(baseQuery);

export const locationSchema = z.object({
  body: z.object({
    descr: z.string().min(1)
  }).passthrough()
}).merge(baseQuery);

export const locationUpdateSchema = z.object({
  params: z.object({
    lcode: z.string().min(1)
  }),
  body: z.object({
    lcode: z.string().min(1),
    descr: z.string().min(1)
  }).passthrough()
}).merge(baseQuery);

export const removeQualificationSchema = z.object({ params: z.object({ descr: z.string().min(1) }) }).merge(baseQuery);

export const addInterviewTypeSchema = z.object({
  body: z.object({
    descr: z.string().min(1)
  })
}).merge(baseQuery);

export const removeInterviewTypeSchema = z.object({
  params: z.object({
    type_id: z.string().regex(/^\d+$/, "Input should be a valid integer, unable to parse string as an integer")
  })
}).merge(baseQuery);

// ── Reference-data edits ──────────────────────────────────────────
const editQuery = z.object({
  admin_card_no: z.string().optional(),
  compc: z.string().optional(),
  brnch: z.string().optional(),
}).passthrough();

const editSchema = (params, body) => z.object({ params: z.object(params), query: editQuery, body: z.object(body) });

export const editEmpStatusSchema = editSchema(
  { emp_status: z.string().min(1) }, { descr: z.string().min(1, "Description is required") });
export const editQualificationSchema = editSchema(
  { descr: z.string().min(1) }, { descr: z.string().min(1, "Description is required") });
export const editBankSchema = editSchema(
  { bnkcode: z.string().min(1) }, { bnkname: z.string().min(1, "Bank name is required") });
export const editBankBranchSchema = editSchema(
  { bnkcode: z.string().min(1), brncode: z.string().min(1) },
  { brnname: z.string().min(1, "Branch name is required") });
export const editInterviewTypeSchema = editSchema(
  { type_id: z.string().min(1) }, { descr: z.string().min(1, "Description is required") });
export const editBloodGroupSchema = editSchema(
  { pk: z.string().min(1) }, { blood_group: z.string().min(1, "Blood group is required") });
export const removeBloodGroupSchema = z.object({
  params: z.object({ pk: z.string().min(1) }),
  query: editQuery,
});

// ── Leave types (master setup, per company/branch) ────────────────
// entitlement and allowed arrive as strings from the form and may be blank —
// "no entitlement" is a real state for types like WITHOUT PAY.
const optionalNumberText = z
  .string()
  .regex(/^\d*(\.\d+)?$/, "Must be a number")
  .optional();

export const addLeaveTypeSchema = z.object({
  body: z.object({
    leave_type: z.string().min(1, "A leave code is required").max(20),
    leave_desc: z.string().min(1, "A description is required").max(50),
    entitlement: optionalNumberText,
    allowed: optionalNumberText,
  }),
}).merge(baseQuery);

export const editLeaveTypeSchema = z.object({
  params: z.object({ pk: z.string().regex(/^\d+$/, "Invalid leave type") }),
  query: editQuery,
  body: z.object({
    leave_desc: z.string().min(1, "A description is required").max(50),
    entitlement: optionalNumberText,
    allowed: optionalNumberText,
  }),
});

export const removeLeaveTypeSchema = z.object({
  params: z.object({ pk: z.string().regex(/^\d+$/, "Invalid leave type") }),
  query: editQuery,
});
