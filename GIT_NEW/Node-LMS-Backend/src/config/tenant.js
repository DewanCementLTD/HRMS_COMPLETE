/**
 * Per-tenant behaviour switches, read from the process env (.env for
 * sysnovix, .env.ydc for YDC / hrms.d-tech.com.pk). The web app is shared by
 * both domains, so it learns these through GET /app/ui-config rather than at
 * build time. Defaults are the original (sysnovix) behaviour: a tenant only
 * differs when its env file says so.
 */
import 'dotenv/config';

const flag = (name, dflt) => {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return dflt;
  return v === 'true' || v === '1' || v === 'yes';
};

// Employee form: HOD 1 must be picked before saving. Default true.
export const HOD1_REQUIRED = flag('EMP_FORM_HOD1_REQUIRED', true);

// HOD 1/2 and Reporting Officer pickers: 'company' = only the employee's own
// company (default), 'all' = every active employee in the schema.
export const APPROVER_PICKER_SCOPE =
  String(process.env.APPROVER_PICKER_SCOPE ?? '').trim().toLowerCase() === 'all' ? 'all' : 'company';

// Codes the employee form writes for religion and marital status: 'text'
// (ISLM / S, M, W, D — default) or 'numeric', the YDC ERP's own codes
// (religion 1 Islam, 2 Hindu, 3 Christian; marital 1 Single, 2 Married).
// Writing text codes into a numeric schema breaks the ERP's forms and reports.
export const EMP_CODE_STYLE =
  String(process.env.EMP_CODE_STYLE ?? '').trim().toLowerCase() === 'numeric' ? 'numeric' : 'text';

export const uiConfig = () => ({
  hod1_required: HOD1_REQUIRED,
  approver_picker_scope: APPROVER_PICKER_SCOPE,
  emp_code_style: EMP_CODE_STYLE,
});
