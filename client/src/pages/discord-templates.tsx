import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, TrendingUp, Target, ShieldAlert, AlertTriangle, MessageSquare } from "lucide-react";
import { SiDiscord } from "react-icons/si";

const CATEGORIES = ["Options", "Shares", "LETF", "LETF Option", "Crypto"] as const;
type Category = (typeof CATEGORIES)[number];

interface TemplateField {
  name: string;
  value: string;
  inline?: boolean;
}

interface TemplateData {
  type: string;
  label: string;
  content?: string;
  template: {
    description: string;
    color: string;
    fields: TemplateField[];
    footer: string;
  };
  sampleVars: Record<string, string>;
}

interface TemplateGroup {
  instrumentType: string;
  ticker: string;
  templates: TemplateData[];
}

const ZWSP = "\u200b";
const LITERAL_ZWSP = "\\u200b";

function normalizeSpacerField(s: string | undefined | null): string {
  if (s === undefined || s === null || s === "") return ZWSP;
  if (s === ZWSP || s === LITERAL_ZWSP) return ZWSP;
  return s;
}

function renderTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return data[key] ?? `{{${key}}}`;
  });
}

const SLUG_ICONS: Record<string, { icon: typeof TrendingUp; className: string }> = {
  signal_alert: { icon: TrendingUp, className: "text-green-500" },
  target_hit: { icon: Target, className: "text-green-500" },
  stop_loss_raised: { icon: ShieldAlert, className: "text-amber-500" },
  stop_loss_hit: { icon: AlertTriangle, className: "text-red-500" },
};

const SLUG_BADGE_COLORS: Record<string, string> = {
  signal_alert: "bg-green-500/10 text-green-500 border-green-500/20",
  target_hit: "bg-green-500/10 text-green-500 border-green-500/20",
  stop_loss_raised: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  stop_loss_hit: "bg-red-500/10 text-red-500 border-red-500/20",
};

function isSpacerField(f: TemplateField): boolean {
  const n = normalizeSpacerField(f.name).trim();
  const v = normalizeSpacerField(f.value).trim();
  return (n === ZWSP || n === "") && (v === "" || v === ZWSP) && !f.inline;
}

type Section = { type: "spacer" | "inline" | "block"; fields: TemplateField[] };

function buildSections(fields: TemplateField[]): Section[] {
  const sections: Section[] = [];
  let currentInline: TemplateField[] = [];

  const flushInline = () => {
    if (currentInline.length > 0) {
      sections.push({ type: "inline", fields: [...currentInline] });
      currentInline = [];
    }
  };

  for (const f of fields) {
    if (isSpacerField(f)) {
      flushInline();
      sections.push({ type: "spacer", fields: [] });
    } else if (f.inline) {
      currentInline.push(f);
    } else {
      flushInline();
      sections.push({ type: "block", fields: [f] });
    }
  }
  flushInline();
  return sections;
}

function renderMarkdown(text: string) {
  return text.split(/\*\*(.*?)\*\*/).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
  );
}

function DiscordEmbedPreview({ embed, content }: {
  embed: { title: string; description: string; fields: TemplateField[]; footer: string; color: string };
  content?: string;
}) {
  const sections = buildSections(embed.fields);

  return (
    <div className="bg-[#313338] rounded-lg p-4 font-sans text-sm" data-testid="discord-embed-preview">
      <div className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-[#5865F2] flex items-center justify-center shrink-0">
          <span className="text-white font-bold text-xs">SG</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-white text-sm">SITU GOAT</span>
            <Badge className="text-[9px] px-1 py-0 bg-[#5865F2] text-white border-0">BOT</Badge>
            <span className="text-[11px] text-gray-500">Today at {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
          </div>

          {content && (
            <p className="text-gray-300 text-sm mb-2">{content}</p>
          )}

          <div className="flex rounded overflow-hidden" style={{ borderLeft: `4px solid ${embed.color}` }}>
            <div className="bg-[#2b2d31] p-3 flex-1 min-w-0 space-y-2">
              {embed.description && (
                <div className="text-gray-200 text-sm whitespace-pre-wrap">
                  {renderMarkdown(embed.description)}
                </div>
              )}

              {sections.map((section, si) => {
                if (section.type === "spacer") {
                  return <div key={si} className="h-1" />;
                }
                if (section.type === "inline") {
                  return (
                    <div key={si} className="grid grid-cols-3 gap-2">
                      {section.fields.map((f, fi) => (
                        <div key={fi}>
                          <div className="text-xs font-semibold text-gray-400">{normalizeSpacerField(f.name)}</div>
                          <div className="text-sm text-gray-200">{normalizeSpacerField(f.value)}</div>
                        </div>
                      ))}
                    </div>
                  );
                }
                return (
                  <div key={si}>
                    {section.fields.map((f, fi) => (
                      <div key={fi}>
                        <div className="text-xs font-semibold text-gray-400">{normalizeSpacerField(f.name)}</div>
                        <div className="text-sm text-gray-200 whitespace-pre-wrap">{normalizeSpacerField(f.value)}</div>
                      </div>
                    ))}
                  </div>
                );
              })}

              {embed.footer && (
                <div className="text-[11px] text-gray-500 pt-1 border-t border-[#3f4147]">
                  {embed.footer}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateCard({ template, sampleVars, isExpanded, onToggleExpand }: {
  template: TemplateData;
  sampleVars: Record<string, string>;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const renderedFields = template.template.fields.map((f) => ({
    name: normalizeSpacerField(renderTemplate(f.name, sampleVars)),
    value: normalizeSpacerField(renderTemplate(f.value, sampleVars)),
    inline: f.inline,
  }));

  const embed = {
    title: "",
    description: renderTemplate(template.template.description, sampleVars),
    fields: renderedFields,
    footer: renderTemplate(template.template.footer, sampleVars),
    color: template.template.color,
  };

  const nonSpacerFields = template.template.fields.filter((f) => !isSpacerField(f));
  const hasVars = template.template.description.includes("{{") ||
    template.template.fields.some((f) => f.name.includes("{{") || f.value.includes("{{"));

  const slugIcon = SLUG_ICONS[template.type];
  const slugBadge = SLUG_BADGE_COLORS[template.type] || "bg-gray-500/10 text-gray-400 border-gray-500/20";
  const IconComp = slugIcon?.icon || MessageSquare;
  const iconClass = slugIcon?.className || "text-gray-400";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden" data-testid={`card-template-${template.type}`}>
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <IconComp className={`w-4 h-4 shrink-0 ${iconClass}`} />
            <span className="text-sm font-medium truncate">{template.label}</span>
            <Badge variant="outline" className={`text-[10px] shrink-0 ${slugBadge}`}>
              {template.type.replace(/_/g, " ")}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onToggleExpand}
            data-testid={`button-preview-${template.type}`}
            title={isExpanded ? "Hide Preview" : "Preview"}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {template.content && (
            <Badge variant="outline" className="text-[10px]">
              content: {template.content}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            color: {template.template.color}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {nonSpacerFields.length} fields
          </Badge>
          {hasVars && (
            <Badge variant="outline" className="text-[10px] bg-blue-500/5 text-blue-400 border-blue-500/20">
              {"{{variables}}"}
            </Badge>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border bg-[#313338] p-4">
          <DiscordEmbedPreview
            embed={embed}
            content={template.content}
          />
        </div>
      )}
    </div>
  );
}

export default function DiscordTemplatesPage() {
  const { data: templateGroups, isLoading, isError } = useQuery<TemplateGroup[]>({
    queryKey: ["/api/tradesync/templates"],
  });

  const [activeCategory, setActiveCategory] = useState<Category>("Options");
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  const groupByCategory = useMemo(() => {
    if (!templateGroups) return {};
    const map: Record<string, TemplateGroup> = {};
    for (const g of templateGroups) {
      map[g.instrumentType] = g;
    }
    return map;
  }, [templateGroups]);

  const categoryCounts = CATEGORIES.map((cat) => ({
    name: cat,
    count: groupByCategory[cat]?.templates?.length ?? 0,
  }));

  const activeGroup = groupByCategory[activeCategory];
  const activeTemplates = activeGroup?.templates ?? [];
  const sampleTicker = activeGroup?.ticker ?? "AAPL";

  return (
    <div className="p-4 space-y-4" data-testid="page-discord-templates">
      <div className="flex items-center gap-3">
        <SiDiscord className="w-6 h-6 text-[#5865F2]" />
        <h1 className="text-xl font-bold" data-testid="text-page-title">Discord Templates</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Preview Discord embed templates from Trade Sync for each instrument type and event.
      </p>

      <div className="flex flex-wrap gap-1.5" data-testid="tabs-category">
        {categoryCounts.map(({ name, count }) => (
          <Button
            key={name}
            variant={activeCategory === name ? "default" : "outline"}
            size="sm"
            className="text-xs gap-1.5"
            onClick={() => {
              setActiveCategory(name as Category);
              setExpandedTemplate(null);
            }}
            data-testid={`tab-category-${name.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {name}
            <Badge
              variant="secondary"
              className={`text-[10px] px-1 py-0 ${activeCategory === name ? "bg-primary-foreground/20 text-primary-foreground" : ""}`}
            >
              {count}
            </Badge>
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12" data-testid="loading-templates">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError || !templateGroups || templateGroups.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3" data-testid="alert-no-templates">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium">No Discord message templates</p>
            <p className="text-xs text-muted-foreground mt-1">
              Check that TradeSync API URL and API key are set correctly in your environment.
            </p>
          </div>
        </div>
      ) : activeTemplates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground" data-testid="text-no-category-templates">
          No templates for {activeCategory}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing templates for <span className="font-medium text-foreground">{activeCategory}</span> using sample ticker <span className="font-mono font-medium text-foreground">{sampleTicker}</span>
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activeTemplates.map((template) => {
              const templateKey = `${activeCategory}-${template.type}`;
              return (
                <TemplateCard
                  key={template.type}
                  template={template}
                  sampleVars={template.sampleVars}
                  isExpanded={expandedTemplate === templateKey}
                  onToggleExpand={() =>
                    setExpandedTemplate(
                      expandedTemplate === templateKey ? null : templateKey
                    )
                  }
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}