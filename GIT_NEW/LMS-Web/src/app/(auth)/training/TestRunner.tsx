"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Timer, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import { meApi, type Attempt, type AttemptResult } from "@/services/trainingService";

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * Takes one pre/post test. The server owns the clock: we count down from the
 * seconds it reports and auto-submit at zero; it discards anything that
 * arrives after its own deadline.
 */
export function TestRunner({ card, token, participantId, kind, onClose }: {
  card: string; token: string; participantId: number; kind: "PRE" | "POST"; onClose: (submitted: boolean) => void;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [left, setLeft] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const submittedRef = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  useEffect(() => {
    let cancelled = false;
    meApi.startTest(card, token, participantId, kind)
      .then((a) => { if (!cancelled) { setAttempt(a); setLeft(a.seconds_left); } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not start the test"); });
    return () => { cancelled = true; };
  }, [card, token, participantId, kind]);

  const submit = useCallback(async () => {
    if (!attempt || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      setResult(await meApi.submitTest(card, token, attempt.attempt_id, answersRef.current));
    } catch (e) {
      submittedRef.current = false;
      setError(e instanceof Error ? e.message : "Submit failed — try again");
    } finally {
      setSubmitting(false);
    }
  }, [attempt, card, token]);

  useEffect(() => {
    if (!attempt || result) return;
    if (left <= 0) { submit(); return; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [attempt, left, result, submit]);

  const answered = Object.keys(answers).length;
  const total = attempt?.questions.length ?? 0;

  const confirmSubmit = () => {
    if (answered < total && !confirm(`You have answered ${answered} of ${total} questions. Submit anyway?`)) return;
    submit();
  };

  const close = () => {
    if (attempt && !result && !confirm("Leave the test? The timer keeps running and the attempt will be submitted as it is when time runs out.")) return;
    onClose(!!result);
  };

  return (
    <Modal size="lg" title={attempt?.title || (kind === "PRE" ? "Pre-training test" : "Post-training test")}
      subtitle={attempt ? `${attempt.course_title} · ${total} question(s) · pass mark ${attempt.pass_pct}%` : undefined}
      onClose={close}
      footer={result ? <Button onClick={() => onClose(true)}>Done</Button> : attempt ? (
        <>
          <span className="mr-auto text-sm text-gray-500">{answered} / {total} answered</span>
          <Button onClick={confirmSubmit} loading={submitting}>Submit test</Button>
        </>
      ) : undefined}>
      {error && <div className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>}
      {!attempt && !error && <Spinner />}

      {result && (
        <div className="py-8 text-center">
          {result.passed
            ? <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto mb-3" />
            : <XCircle className="h-14 w-14 text-red-400 mx-auto mb-3" />}
          <p className="text-3xl font-extrabold text-ink">{result.pct}%</p>
          <p className="text-sm text-gray-500 mt-1">{result.score} of {result.total} marks · pass mark {result.pass_pct}%</p>
          <p className={cn("mt-3 font-semibold", result.passed ? "text-emerald-700" : "text-red-600")}>
            {kind === "PRE" ? "Pre-test recorded. Good luck with the training!" : result.passed ? "You passed." : "You did not reach the pass mark."}
          </p>
          {result.late && <p className="text-xs text-amber-700 mt-2">Time had run out, so answers could not be counted.</p>}
        </div>
      )}

      {attempt && !result && (
        <div className="space-y-4">
          <div className={cn("sticky top-0 z-10 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
            left <= 60 ? "bg-red-50 text-red-700" : "bg-indigo-50 text-indigo-700")}>
            <Timer className="h-4 w-4" /> Time left {mmss(Math.max(left, 0))}
            {submitting && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
          </div>
          {attempt.questions.map((q, i) => (
            <div key={q.question_id} className="rounded-xl border border-gray-100 p-4">
              <p className="font-medium text-gray-900">
                <span className="text-gray-400 mr-1.5">{i + 1}.</span>{q.question_text}
                <span className="ml-2 text-[11px] text-gray-400">({q.marks} mark{q.marks === 1 ? "" : "s"})</span>
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {q.options.map((o) => {
                  const on = answers[q.question_id] === o.key;
                  return (
                    <button key={o.key} type="button" onClick={() => setAnswers((a) => ({ ...a, [q.question_id]: o.key }))}
                      className={cn("text-left rounded-lg border px-3 py-2 text-sm transition",
                        on ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-gray-200 hover:bg-gray-50")}>
                      <span className="font-semibold mr-2">{o.key}.</span>{o.text}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
