"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Target, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/training/TrainingUi";
import { StagePill } from "./AppraisalUi";
import { apprMeApi, scoreText, type MyAppraisalRow, type History } from "@/services/appraisalService";

/** Latest appraisal and last final rating on My Profile — hidden when the employee has none. */
export function AppraisalProfileCard({ card, token }: { card: string; token: string }) {
  const [rows, setRows] = useState<MyAppraisalRow[] | null>(null);
  const [hist, setHist] = useState<History["history"]>([]);

  useEffect(() => {
    if (!card || !token) return;
    apprMeApi.list(card, token).then((r) => setRows(r.items)).catch(() => setRows(null));
    apprMeApi.history(card, token).then((r) => setHist(r.history)).catch(() => setHist([]));
  }, [card, token]);

  if (!rows?.length) return null;
  const current = rows[0];
  const last = hist[hist.length - 1];
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-indigo-600" />
          <h3 className="font-semibold text-ink">Performance appraisal</h3>
          <Link href="/appraisal" className="ml-auto inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
            Open My Appraisal<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-gray-500">{current.cycle.name}:</span>
          <StagePill stage={current.stage} />
          {current.my_turn && <Pill tone="red">Action needed</Pill>}
        </div>
        {last && (
          <p><span className="text-gray-500">Last rating: </span><b>{last.final_rating}</b> ({scoreText(last.final_score)}) — {last.cycle_name}</p>
        )}
      </CardContent>
    </Card>
  );
}
