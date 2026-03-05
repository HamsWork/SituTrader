import type { TemplateEmbed } from "./embedTemplateDefaults";
import { storage } from "../storage";
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
    const tmpl = await storage.getEmbedTemplate(instrumentType, eventType);
    if (tmpl?.isActive && tmpl.embedJson) {
      return tmpl.embedJson as unknown as TemplateEmbed;
    }
  } catch (err: any) {
    log(`Failed to load embed template ${instrumentType}/${eventType}: ${err.message}`, "discord");
  }
  return null;
}

export async function seedDefaultTemplates(): Promise<number> {
  const { getDefaultTemplates, EVENT_TYPES } = await import("./embedTemplateDefaults");
  const defaults = getDefaultTemplates();
  let seeded = 0;
  for (const t of defaults) {
    const existing = await storage.getEmbedTemplate(t.instrumentType, t.eventType);
    if (!existing) {
      await storage.upsertEmbedTemplate({
        instrumentType: t.instrumentType,
        eventType: t.eventType,
        templateName: t.templateName,
        embedJson: t.embedJson as any,
        isActive: true,
      });
      seeded++;
    } else {
      const defaultJson = JSON.stringify(t.embedJson);
      const existingJson = JSON.stringify(existing.embedJson);
      if (defaultJson !== existingJson) {
        await storage.updateEmbedTemplate(existing.id, {
          embedJson: t.embedJson as any,
          templateName: t.templateName,
        });
        log(`Updated embed template: ${t.templateName}`, "discord");
      }
    }
  }

  const validEvents = new Set<string>(EVENT_TYPES as readonly string[]);
  const allTemplates = await storage.getEmbedTemplates();
  let removed = 0;
  for (const tmpl of allTemplates) {
    if (!validEvents.has(tmpl.eventType)) {
      await storage.deleteEmbedTemplate(tmpl.id);
      removed++;
    }
  }
  if (removed > 0) {
    log(`Removed ${removed} obsolete embed templates`, "discord");
  }

  if (seeded > 0) {
    log(`Seeded ${seeded} default embed templates`, "discord");
  }
  return seeded;
}
