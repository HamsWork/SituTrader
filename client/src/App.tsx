import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { DisclaimerBanner } from "@/components/disclaimer-banner";
import Dashboard from "@/pages/dashboard";
import SymbolDetail from "@/pages/symbol-detail";
import OptimizationPage from "@/pages/optimization";
import PerformancePage from "@/pages/performance";
import SettingsPage from "@/pages/settings";
import GuidePage from "@/pages/guide";
import IbkrDashboard from "@/pages/ibkr-dashboard";
import SystemAuditPage from "@/pages/system-audit";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/symbol/:ticker" component={SymbolDetail} />
      <Route path="/guide" component={GuidePage} />
      <Route path="/optimization" component={OptimizationPage} />
      <Route path="/performance" component={PerformancePage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/ibkr" component={IbkrDashboard} />
      <Route path="/audit" component={SystemAuditPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <DisclaimerBanner />
                <header className="flex items-center justify-between gap-2 px-3 py-2 border-b">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-auto">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
