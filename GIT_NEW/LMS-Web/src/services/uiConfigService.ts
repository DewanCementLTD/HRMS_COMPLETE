import { apiRequest } from "./api";

// Per-tenant switches served by the backend this domain talks to (sysnovix vs
// YDC run the same web build against different backends). See
// Node-LMS-Backend/src/config/tenant.js.
export interface UiConfig {
  hod1_required: boolean;
  approver_picker_scope: "company" | "all";
  /** Religion / marital-status codes: "text" (ISLM, S/M/W/D) or the YDC ERP's "numeric" ones. */
  emp_code_style: "text" | "numeric";
}

// Original behaviour; used until the config arrives and if it cannot be read.
export const DEFAULT_UI_CONFIG: UiConfig = { hod1_required: true, approver_picker_scope: "company", emp_code_style: "text" };

let cached: Promise<UiConfig> | null = null;

export const fetchUiConfig = (): Promise<UiConfig> => {
  if (!cached) {
    cached = apiRequest<UiConfig>("/app/ui-config")
      .then((c) => ({ ...DEFAULT_UI_CONFIG, ...c }))
      .catch(() => {
        cached = null; // retry on the next call
        return DEFAULT_UI_CONFIG;
      });
  }
  return cached;
};
