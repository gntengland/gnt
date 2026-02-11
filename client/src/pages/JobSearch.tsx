// FILE: client/src/pages/JobSearch.tsx
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function JobSearch() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Jobs</h1>
              <p className="text-muted-foreground mt-1">MVP: Search happens inside Apply Wizard.</p>
            </div>
            <Link href="/apply">
              <Button>
                Go to Apply <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>

          <Card className="bg-card/40 border border-white/5">
            <CardHeader>
              <CardTitle className="text-base">Recommended</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <div>For stability, search and matching are handled in <span className="text-foreground">/apply</span>.</div>
              <Link href="/apply">
                <Button className="w-full sm:w-auto">Open Apply Wizard</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
