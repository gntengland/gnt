// FILE: client/src/pages/ApplyWizard.tsx
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

import ProfileStep from "@/components/apply/ProfileStep";
import MatchStep from "@/components/apply/MatchStep";
import GenerateStep from "@/components/apply/GenerateStep";
import type { JobMatchItem, ProfilePayload } from "@/components/apply/types";

type StepId = 1 | 2 | 3;

export default function ApplyWizard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<StepId>(1);
  const [profile, setProfile] = useState<ProfilePayload>({
    resumeText: "",
    keywords: "",
    location: "United Kingdom",
  });
  const [jobs, setJobs] = useState<JobMatchItem[]>([]);

  const progress = useMemo(() => (step === 1 ? 20 : step === 2 ? 60 : 100), [step]);

  function goNext() {
    if (step === 1) {
      const ok = (profile.resumeText?.trim()?.length ?? 0) > 30;
      if (!ok) {
        toast({
          title: "Resume is incomplete",
          description: "Paste your resume text or upload a resume file to continue.",
          variant: "destructive",
        });
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const selectedCount = jobs.filter((j) => j.selected).length;
      if (selectedCount === 0) {
        toast({
          title: "No job selected",
          description: "Select at least one job to continue.",
          variant: "destructive",
        });
        return;
      }
      setStep(3);
    }
  }

  function goBack() {
    if (step === 1) setLocation("/");
    else setStep((s) => (s === 3 ? 2 : 1));
  }

  function resetAll() {
    setStep(1);
    setJobs([]);
    setProfile({ resumeText: "", keywords: "", location: "United Kingdom" });
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Apply Wizard</h1>
          <div className="text-sm text-muted-foreground">Resume → Matches → Outputs + PDF</div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={resetAll}>
            Reset
          </Button>
          <Button variant="secondary" onClick={goBack}>
            Back
          </Button>
          <Button onClick={goNext}>{step === 3 ? "Done" : "Next"}</Button>
        </div>
      </div>

      <Progress value={progress} />

      <Card className="glass-panel">
        <CardHeader>
          <CardTitle>Step {step} / 3</CardTitle>
        </CardHeader>
        <CardContent className="pb-8">
          {step === 1 && <ProfileStep value={profile} onChange={setProfile} />}
          {step === 2 && <MatchStep profile={profile} jobs={jobs} onJobsChange={setJobs} />}
          {step === 3 && <GenerateStep profile={profile} jobs={jobs} onJobsChange={setJobs} />}
        </CardContent>
      </Card>
    </div>
  );
}
