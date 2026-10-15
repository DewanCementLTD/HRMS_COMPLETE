"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Presentation, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { trainerApi, rateText, type TrainerProfile } from "@/services/trainingService";
import { Pill, Stars } from "./TrainingUi";

/** Trainer summary on My Profile — rendered only for internal trainers. */
export function TrainerProfileCard({ card, token }: { card: string; token: string }) {
  const [p, setP] = useState<TrainerProfile | null>(null);

  useEffect(() => {
    if (!card || !token) return;
    trainerApi.profile(card, token).then(setP).catch(() => setP(null));
  }, [card, token]);

  if (!p?.is_trainer || !p.trainer) return null;
  const t = p.trainer;
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Presentation className="h-5 w-5 text-indigo-600" />
          <h3 className="font-semibold text-ink">Trainer profile</h3>
          <Pill tone={t.is_free ? "green" : "gray"}>{rateText(t)}</Pill>
          <Link href="/trainer" className="ml-auto inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
            Open Trainer Portal<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {t.expertise && <p className="text-sm"><span className="text-gray-500">Expertise: </span><span className="text-gray-900">{t.expertise}</span></p>}
        {t.bio && <p className="text-sm text-gray-700 whitespace-pre-wrap">{t.bio}</p>}
        {t.qualifications && <p className="text-sm"><span className="text-gray-500">Qualifications: </span>{t.qualifications}</p>}
        <div className="flex flex-wrap gap-5 text-sm text-gray-600 pt-1">
          <span>Upcoming sessions <b className="text-ink">{p.stats?.upcoming ?? 0}</b></span>
          <span>Conducted <b className="text-ink">{p.stats?.completed ?? 0}</b></span>
          <span>People trained <b className="text-ink">{p.stats?.people_trained ?? 0}</b></span>
          <span>Free slots <b className="text-ink">{t.upcoming_slots}</b></span>
          <span className="inline-flex items-center gap-1.5">Rating <Stars value={t.avg_rating} /></span>
        </div>
      </CardContent>
    </Card>
  );
}
