"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { fetchHodApprovals, decideHodApproval } from "@/services/leaveService";
import type { HodApproval } from "@/models/leave";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import { CheckCircle2, XCircle, Clock, UserCheck } from "lucide-react";

type Tab = "pending" | "decided";

/** Where an application stands, in the approver's terms. */
function StatusPill({ a }: { a: HodApproval }) {
  const status = (a.status || "").toLowerCase();
  if (status === "approved") return <Badge status="Approved" />;
  if (status === "rejected") return <Badge status="Rejected" />;
  if (a.my_decision === "approved" && a.total_steps === 2) {
    return <Badge status="Awaiting HOD 2" className="bg-amber-100 text-amber-800" />;
  }
  if (!a.my_turn && a.waiting_on) {
    return <Badge status={`Waiting on ${a.waiting_on}`} className="bg-amber-100 text-amber-800" />;
  }
  return <Badge status="Waiting" className="bg-amber-100 text-amber-800" />;
}

export default function LeaveApprovalsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<HodApproval[]>([]);
  const [isHod, setIsHod] = useState(true);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [busyPk, setBusyPk] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetchHodApprovals(user.card_no);
      setItems(res.items || []);
      setIsHod(res.is_hod);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  async function decide(pk: number, decision: "approve" | "reject") {
    if (!user) return;
    setBusyPk(pk);
    setError(null);
    setSuccess(null);
    try {
      const res = await decideHodApproval(user.card_no, pk, decision);
      setSuccess(res.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record the decision");
    } finally {
      setBusyPk(null);
    }
  }

  if (loading) return <Spinner />;

  // "Pending" is what this approver can still act on; everything else — already
  // decided by them, or finished — sits under Decided.
  const pending = items.filter((a) => !a.my_decision && !/^(approved|rejected)$/i.test(a.status));
  const decided = items.filter((a) => a.my_decision || /^(approved|rejected)$/i.test(a.status));
  const visible = tab === "pending" ? pending : decided;

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Leave Approvals"
        subtitle="Leave applications from the employees who report to you"
      />

      {error && <div className="mb-4"><Alert type="error" message={error} onClose={() => setError(null)} /></div>}
      {success && <div className="mb-4"><Alert type="success" message={success} onClose={() => setSuccess(null)} /></div>}

      {!isHod ? (
        <Card>
          <CardContent>
            <div className="py-12 text-center">
              <UserCheck className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                You are not set as HOD 1 or HOD 2 for any employee, so there is nothing to approve here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            {(["pending", "decided"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3.5 py-1.5 rounded-xl text-sm font-medium transition-colors ${
                  tab === t ? "bg-indigo-600 text-white" : "bg-white/90 text-gray-600 hover:bg-white"
                }`}
              >
                {t === "pending" ? `Pending (${pending.length})` : `Decided (${decided.length})`}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <Card>
              <CardContent>
                <div className="py-12 text-center">
                  <Clock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">
                    {tab === "pending" ? "No leave applications waiting on you." : "Nothing decided yet."}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {visible.map((a) => (
                <Card key={a.leave_application_pk}>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-gray-900 truncate">
                          {a.emp_name || a.emp_fk}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {a.leave_desc || a.leave_type}
                          {a.leave_days != null && ` · ${a.leave_days} day${a.leave_days === 1 ? "" : "s"}`}
                          {" · "}
                          {a.from_date === a.to_date ? a.from_date : `${a.from_date} → ${a.to_date}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {a.total_steps === 2 && (
                          <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                            You are HOD {a.step} of 2
                          </span>
                        )}
                        <StatusPill a={a} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {a.reason && (
                      <p className="text-sm text-gray-700 mb-3">
                        <span className="font-medium text-gray-500">Reason: </span>{a.reason}
                      </p>
                    )}

                    {/* Two-step trail, so an approver can see who else has acted. */}
                    {a.total_steps === 2 && (
                      <div className="flex flex-wrap gap-4 text-xs text-gray-500 mb-3">
                        <span>
                          HOD 1: {a.hod1_app_flag === "Y" ? `approved${a.hod1_name ? ` by ${a.hod1_name}` : ""}`
                            : a.hod1_app_flag === "N" ? "rejected" : "pending"}
                        </span>
                        <span>
                          HOD 2: {a.hod2_app_flag === "Y" ? `approved${a.hod2_name ? ` by ${a.hod2_name}` : ""}`
                            : a.hod2_app_flag === "N" ? "rejected" : "pending"}
                        </span>
                      </div>
                    )}

                    {a.my_decision ? (
                      <p className="text-sm text-gray-500">
                        You {a.my_decision} this application.
                      </p>
                    ) : !a.my_turn ? (
                      <p className="text-sm text-gray-500">
                        Waiting on {a.waiting_on || "the previous approver"} before you can act.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => decide(a.leave_application_pk, "approve")}
                          loading={busyPk === a.leave_application_pk}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-1.5" />
                          {a.total_steps === 2 && a.step === 1 ? "Approve & forward" : "Approve"}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => decide(a.leave_application_pk, "reject")}
                          disabled={busyPk === a.leave_application_pk}
                          className="text-red-600 hover:bg-red-50"
                        >
                          <XCircle className="h-4 w-4 mr-1.5" /> Reject
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
