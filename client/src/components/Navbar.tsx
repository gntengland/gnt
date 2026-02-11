import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Briefcase } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export default function Navbar() {
  const [location] = useLocation();
  const auth = useAuth();

  const authed = !!auth.user;

  const items = authed
    ? [
        { href: "/dashboard", label: "Dashboard" },
        { href: "/search", label: "Job Search" },
        { href: "/apply", label: "Apply" },
        { href: "/profile", label: "Profile" },
      ]
    : [{ href: "/", label: "Home" }];

  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-background/70 backdrop-blur">
      <div className="container mx-auto px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-primary" />
            </div>
            <div className="font-semibold tracking-tight">Job Copilot</div>
          </Link>

          <nav className="hidden md:flex items-center gap-2">
            {items.map((it) => (
              <Link key={it.href} href={it.href}>
                <Button size="sm" variant={location === it.href ? "secondary" : "ghost"}>
                  {it.label}
                </Button>
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {!authed ? (
              <>
                <Link href="/login">
                  <Button size="sm" variant="ghost">
                    Login
                  </Button>
                </Link>
                <Link href="/register">
                  <Button size="sm">Sign up</Button>
                </Link>
              </>
            ) : (
              <>
                <div className="hidden sm:block text-sm text-muted-foreground">
                  {auth.user?.name || auth.user?.email}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={auth.logout.isPending}
                  onClick={async () => {
                    await auth.logout.mutateAsync();
                  }}
                >
                  {auth.logout.isPending ? "Signing out..." : "Logout"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
