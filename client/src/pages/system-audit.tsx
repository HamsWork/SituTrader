import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, FileText, Map, Braces } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: `${label} copied to clipboard` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      toast({ title: `${label} copied to clipboard` });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Button
      onClick={handleCopy}
      variant={copied ? "default" : "outline"}
      size="sm"
      data-testid={`button-copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
      {copied ? "Copied!" : `Copy ${label}`}
    </Button>
  );
}

function AuditContent({ content, isLoading }: { content: string; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-280px)]">
      <pre
        className="text-xs font-mono whitespace-pre-wrap break-words p-4 bg-muted/30 rounded-md"
        data-testid="text-audit-content"
      >
        {content}
      </pre>
    </ScrollArea>
  );
}

export default function SystemAuditPage() {
  const auditQuery = useQuery<string>({
    queryKey: ["/api/audit/system"],
    queryFn: async () => {
      const res = await fetch("/api/audit/system");
      return res.text();
    },
  });

  const featureMapQuery = useQuery<string>({
    queryKey: ["/api/audit/feature-map"],
    queryFn: async () => {
      const res = await fetch("/api/audit/feature-map");
      return res.text();
    },
  });

  const jsonQuery = useQuery<string>({
    queryKey: ["/api/audit/json"],
    queryFn: async () => {
      const res = await fetch("/api/audit/json");
      return res.text();
    },
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">System Audit</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Copy and paste these documents to share the full system architecture with another LLM or team member.
        </p>
      </div>

      <Tabs defaultValue="audit" className="w-full">
        <TabsList className="grid w-full grid-cols-3" data-testid="tabs-audit">
          <TabsTrigger value="audit" data-testid="tab-system-audit">
            <FileText className="w-4 h-4 mr-2" />
            System Audit
          </TabsTrigger>
          <TabsTrigger value="feature-map" data-testid="tab-feature-map">
            <Map className="w-4 h-4 mr-2" />
            Feature Map
          </TabsTrigger>
          <TabsTrigger value="json" data-testid="tab-json">
            <Braces className="w-4 h-4 mr-2" />
            JSON
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-lg">SYSTEM_AUDIT.md</CardTitle>
              <CopyButton text={auditQuery.data || ""} label="System Audit" />
            </CardHeader>
            <CardContent>
              <AuditContent content={auditQuery.data || ""} isLoading={auditQuery.isLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feature-map">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-lg">FEATURE_FILE_MAP.md</CardTitle>
              <CopyButton text={featureMapQuery.data || ""} label="Feature Map" />
            </CardHeader>
            <CardContent>
              <AuditContent content={featureMapQuery.data || ""} isLoading={featureMapQuery.isLoading} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="json">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-lg">SYSTEM_AUDIT.json</CardTitle>
              <CopyButton text={jsonQuery.data || ""} label="JSON" />
            </CardHeader>
            <CardContent>
              <AuditContent content={jsonQuery.data || ""} isLoading={jsonQuery.isLoading} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
