// FILE: client/src/pages/Dashboard.tsx
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

export default function Dashboard() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
              <p className="text-muted-foreground mt-1">Main flow is Apply Wizard.</p>
            </div>
            <Link href="/apply">
              <Button>
                Start Apply <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>

          <Card className="bg-card/40 border border-white/5">
            <CardHeader>
              <CardTitle className="text-base">Use Apply Wizard</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Everything happens in <span className="text-foreground">/apply</span>: input → 6 matches → outputs + PDF.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
