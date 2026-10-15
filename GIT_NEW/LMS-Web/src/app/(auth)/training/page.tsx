"use client";

import { useState } from "react";
import { BookOpen, ClipboardList, GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { useAuth } from "@/context/AuthContext";
import { Tabs, SignInAgain } from "@/components/training/TrainingUi";
import { RequestTrainingPanel, MyRequestsPanel, MyTrainingsPanel } from "./EmployeePanels";

type Tab = "trainings" | "request" | "requests";

// The employee's own training. Every call carries the signed session token, so
// the API only ever returns and changes the token holder's data.
export default function MyTrainingPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("trainings");
  if (!user) return null;

  const token = user.session_token || "";
  const card = user.card_no;

  return (
    <div className="animate-fade-in">
      <PageHeader title="My Training" subtitle="Request training, follow approvals, take tests and download certificates" />
      {!token ? <Card><SignInAgain /></Card> : (
        <>
          <Tabs<Tab> value={tab} onChange={setTab} tabs={[
            { id: "trainings", label: "My Trainings", icon: GraduationCap },
            { id: "request", label: "Request Training", icon: BookOpen },
            { id: "requests", label: "My Requests", icon: ClipboardList },
          ]} />
          {tab === "trainings" && <MyTrainingsPanel card={card} token={token} />}
          {tab === "request" && <RequestTrainingPanel card={card} token={token} onSubmitted={() => setTab("requests")} />}
          {tab === "requests" && <MyRequestsPanel card={card} token={token} />}
        </>
      )}
    </div>
  );
}
