import { Router, Route, Switch } from "wouter";
import Landing from "@/pages/Landing";
import Dashboard from "@/pages/Dashboard";
import JobSearch from "@/pages/JobSearch";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ApplyWizard from "@/pages/ApplyWizard";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/use-auth";

export default function App() {
  const { user, isLoading } = useAuth();

  // Until auth status is known, render nothing (you can show a loading state instead).
  if (isLoading) return null;

  const authed = !!user;

  return (
    <>
      <Router>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/dashboard">{() => (authed ? <Dashboard /> : <Landing />)}</Route>
          <Route path="/jobs">{() => (authed ? <JobSearch /> : <Landing />)}</Route>
          <Route path="/apply">{() => (authed ? <ApplyWizard /> : <Landing />)}</Route>
          <Route path="/login">{() => (!authed ? <Login /> : <Dashboard />)}</Route>
          <Route path="/register">{() => (!authed ? <Register /> : <Dashboard />)}</Route>
          <Route>{() => <Landing />}</Route>
        </Switch>
      </Router>

      <Toaster />
    </>
  );
}
