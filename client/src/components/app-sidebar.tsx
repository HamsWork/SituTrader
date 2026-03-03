import { BarChart3, BookOpen, Home, LineChart, Settings, TrendingUp, Wallet, FlaskConical, Activity, FileSearch, Layers, MessageSquare, ArrowRightLeft, Trophy } from "lucide-react";
import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", url: "/", icon: Home },
  { title: "Performance", url: "/performance", icon: Activity },
  { title: "Performance ½", url: "/performance-half", icon: ArrowRightLeft },
  { title: "ROI Insights", url: "/roi-insights", icon: Trophy },
  { title: "Profit Windows", url: "/profit-windows", icon: Layers },
  { title: "Optimization", url: "/optimization", icon: FlaskConical },
  { title: "IBKR", url: "/ibkr", icon: Wallet },
  { title: "Discord Trades", url: "/discord-trades", icon: MessageSquare },
  { title: "Guide", url: "/guide", icon: BookOpen },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "System Audit", url: "/audit", icon: FileSearch },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
              <TrendingUp className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-semibold leading-tight" data-testid="text-app-title">
                SITU GOAT Trader
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">Market Analysis</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.url === "/"
                  ? location === "/"
                  : location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Quick Stats</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-2 py-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <LineChart className="w-3 h-3" />
                <span>RTH: 09:30 - 16:00 ET</span>
              </div>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3">
        <div className="rounded-md bg-muted/50 p-2">
          <p className="text-xs text-muted-foreground text-center leading-tight">
            Education only. Not financial advice.
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
