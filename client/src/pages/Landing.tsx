// FILE: client/src/pages/Landing.tsx
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Sparkles } from "lucide-react";

const features = [
  {
    title: "Resume input",
    description: "Paste your resume text or upload your resume file.",
  },
  {
    title: "Matches + score",
    description: "You’ll see the top matches, each with a match % and skill gaps.",
  },
  {
    title: "Ready-to-send outputs",
    description: "Tailored resume + cover letter + interview Q&A + lightweight PDF + apply link.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen">
      <div className="container mx-auto px-4 py-12 space-y-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" />
            <div className="text-lg font-semibold">Agent</div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login">
              <Button variant="ghost">Login</Button>
            </Link>
            <Link href="/register">
              <Button>Sign up</Button>
            </Link>
          </div>
        </header>

        <section className="grid lg:grid-cols-2 gap-10 items-center">
          <div className="space-y-5">
            <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
              Apply faster with smart matching
            </h1>
            <p className="text-muted-foreground text-lg leading-relaxed">
              Upload your resume,
              <br />
              <span className="text-foreground font-medium">get tailored application materials</span>
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/apply">
                <Button size="lg" className="w-full sm:w-auto">
                  Start Apply <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button size="lg" variant="secondary" className="w-full sm:w-auto">
                  Dashboard
                </Button>
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            {features.map((f) => (
              <Card key={f.title} className="bg-card/40 border border-white/5">
                <CardHeader>
                  <CardTitle className="text-base">{f.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{f.description}</CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
