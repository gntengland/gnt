// FILE: client/src/pages/Profile.tsx
import { useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { useProfile } from "../hooks/use-profile";

async function uploadCv(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/profile/upload-cv", {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function analyzeCv(resumeText: string) {
  const res = await fetch("/api/profile/analyze-cv", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cvText: resumeText }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export default function Profile() {
  const { profileQuery, updateProfile } = useProfile();
  const profile = profileQuery.data;

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const resumeText = profile?.resumeText || "";
  const skillList = useMemo(() => {
    const skills = (profile as any)?.skills || [];
    return Array.isArray(skills) ? skills : [];
  }, [(profile as any)?.skills]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      await updateProfile.mutateAsync({
        fullName: (e.target as any).fullName.value || null,
        headline: (e.target as any).headline.value || null,
        location: (e.target as any).location.value || null,
        phone: (e.target as any).phone.value || null,
        linkedinUrl: (e.target as any).linkedinUrl.value || null,
        portfolioUrl: (e.target as any).portfolioUrl.value || null,
        resumeText: (e.target as any).resumeText.value || null,
      });
      setMsg("Saved.");
    } catch (ex: any) {
      setMsg(ex?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onUpload() {
    if (!file) return;

    // 1MB check
    if (file.size > 1 * 1024 * 1024) {
      setMsg("Max file size is 1MB.");
      return;
    }

    const lower = file.name.toLowerCase();
    if (lower.endsWith(".doc")) {
      setMsg("Old .doc files are not supported. Please upload .docx, .pdf, or .txt.");
      return;
    }

    setMsg(null);
    setBusy(true);
    try {
      await uploadCv(file);
      await profileQuery.refetch();
      setMsg("CV uploaded and text extracted.");
    } catch (ex: any) {
      setMsg(ex?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onAnalyze() {
    setMsg(null);
    setBusy(true);
    try {
      const text = (document.getElementById("resumeText") as HTMLTextAreaElement)?.value || "";
      if (!text.trim()) throw new Error("Paste CV text or upload a file first.");
      const out = await analyzeCv(text);

      await updateProfile.mutateAsync({
        fullName: out?.profile?.fullName ?? profile?.fullName ?? null,
        headline: out?.profile?.headline ?? (profile as any)?.headline ?? null,
        location: out?.profile?.location ?? (profile as any)?.location ?? null,
        phone: out?.profile?.phone ?? (profile as any)?.phone ?? null,
        parsedSkills: out?.analysis?.topSkills ?? out?.analysis?.skills ?? (profile as any)?.parsedSkills ?? null,
        resumeText: text,
      });

      await profileQuery.refetch();
      setMsg("Analyzed + profile updated.");
    } catch (ex: any) {
      setMsg(ex?.message || "Analyze failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <Card className="bg-card/40 border border-white/5">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-5">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full name</Label>
                <Input name="fullName" defaultValue={(profile as any)?.fullName ?? ""} />
              </div>
              <div className="space-y-2">
                <Label>Headline</Label>
                <Input name="headline" defaultValue={(profile as any)?.headline ?? ""} />
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input name="location" defaultValue={(profile as any)?.location ?? ""} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input name="phone" defaultValue={(profile as any)?.phone ?? ""} />
              </div>
              <div className="space-y-2">
                <Label>LinkedIn URL</Label>
                <Input name="linkedinUrl" defaultValue={(profile as any)?.linkedinUrl ?? ""} />
              </div>
              <div className="space-y-2">
                <Label>Portfolio URL</Label>
                <Input name="portfolioUrl" defaultValue={(profile as any)?.portfolioUrl ?? ""} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Resume / CV text</Label>
              <Textarea id="resumeText" name="resumeText" defaultValue={resumeText} rows={10} />
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <Input
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
              <Button type="button" variant="secondary" onClick={onUpload} disabled={busy || !file}>
                Upload CV
              </Button>
              <Button type="button" variant="secondary" onClick={onAnalyze} disabled={busy}>
                Analyze CV
              </Button>
              <Button type="submit" disabled={busy}>
                Save
              </Button>
            </div>

            {msg ? <div className="text-sm text-muted-foreground">{msg}</div> : null}

            {skillList.length ? (
              <div className="text-sm text-muted-foreground">
                Skills: <span className="text-foreground">{skillList.slice(0, 20).join(", ")}</span>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
