import type { TemplateEmbed } from "./embedTemplateDefaults";
import { getDefaultTemplates } from "./embedTemplateDefaults";
import { log } from "../log";

interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: DiscordField[];
  footer?: { text: string };
  timestamp?: string;
}

const COLOR_MAP: Record<string, number> = {
  "#22c55e": 0x22c55e,
  "#ef4444": 0xef4444,
  "#eab308": 0xeab308,
  "#3b82f6": 0x3b82f6,
  "#a855f7": 0xa855f7,
  "#06b6d4": 0x06b6d4,
  "#f97316": 0xf97316,
  "#5865f2": 0x5865f2,
  green: 0x22c55e,
  red: 0xef4444,
  gold: 0xeab308,
  blue: 0x3b82f6,
};

function resolveColor(colorStr: string): number {
  const lower = colorStr.toLowerCase().trim();
  if (COLOR_MAP[lower] !== undefined) return COLOR_MAP[lower];
  if (lower.startsWith("#")) {
    const parsed = parseInt(lower.slice(1), 16);
    if (!isNaN(parsed)) return parsed;
  }
  if (lower.startsWith("0x")) {
    const parsed = parseInt(lower, 16);
    if (!isNaN(parsed)) return parsed;
  }
  return 0x3b82f6;
}

function replaceVars(text: string, vars: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

export function renderTemplate(
  template: TemplateEmbed,
  vars: Record<string, string>,
): DiscordEmbed {
  const colorStr = replaceVars(template.color, vars);
  const color = resolveColor(colorStr);

  const fields: DiscordField[] = (template.fields || []).map((f) => ({
    name: replaceVars(f.name, vars),
    value: replaceVars(f.value, vars),
    inline: f.inline,
  }));

  return {
    description: replaceVars(template.description, vars),
    color,
    fields: fields.length > 0 ? fields : undefined,
    footer: template.footer ? { text: replaceVars(template.footer, vars) } : undefined,
  };
}

export async function getTemplateForEvent(
  instrumentType: string,
  eventType: string,
): Promise<TemplateEmbed | null> {
  try {
    const defaults = getDefaultTemplates();
    const t = defaults.find(
      (d) => d.instrumentType === instrumentType && d.eventType === eventType,
    );
    return t ? (t.embedJson as TemplateEmbed) : null;
  } catch (err: any) {
    log(`Failed to load embed template ${instrumentType}/${eventType}: ${err.message}`, "discord");
    return null;
  }
}
