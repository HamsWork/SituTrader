import type { IntradayBar } from "@shared/schema";

export function filterRTHBars(
  bars: Array<{ ts: string; open: number; high: number; low: number; close: number; volume: number }>,
  sessionStart: string = "09:30",
  sessionEnd: string = "16:00"
): typeof bars {
  const [startH, startM] = sessionStart.split(":").map(Number);
  const [endH, endM] = sessionEnd.split(":").map(Number);
  const startMin = startH * 60 + startM;
  const endMin = endH * 60 + endM;

  return bars.filter((bar) => {
    const ts = new Date(bar.ts);
    const etStr = ts.toLocaleString("en-US", { timeZone: "America/New_York" });
    const et = new Date(etStr);
    const totalMin = et.getHours() * 60 + et.getMinutes();
    return totalMin >= startMin && totalMin < endMin;
  });
}

export function timestampToET(ts: string | number): Date {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  const etStr = d.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etStr);
}

export function validateMagnetTouch(
  intradayBars: Array<{ ts: string; high: number; low: number }>,
  magnetPrice: number,
  direction: string,
  sessionStart: string = "09:30",
  sessionEnd: string = "16:00"
): { hit: boolean; hitTs?: string; timeToHitMin?: number } {
  const rthBars = filterRTHBars(intradayBars as any, sessionStart, sessionEnd);

  for (const bar of rthBars) {
    let touched = false;
    if (direction.includes("down") || direction === "SELL") {
      touched = bar.low <= magnetPrice;
    } else {
      touched = bar.high >= magnetPrice;
    }

    if (touched) {
      const barTime = timestampToET(bar.ts);
      const [startH, startM] = sessionStart.split(":").map(Number);
      const sessionStartDate = new Date(barTime);
      sessionStartDate.setHours(startH, startM, 0, 0);
      const timeToHitMin = Math.round((barTime.getTime() - sessionStartDate.getTime()) / 60000);

      return { hit: true, hitTs: bar.ts, timeToHitMin: Math.max(0, timeToHitMin) };
    }
  }

  return { hit: false };
}

export function computeMAEMFE(
  intradayBars: Array<{ ts: string; high: number; low: number; open: number; close: number }>,
  entryPrice: number,
  direction: string,
  sessionStart: string = "09:30",
  sessionEnd: string = "16:00"
): { mae: number; mfe: number } {
  const rthBars = filterRTHBars(intradayBars as any, sessionStart, sessionEnd);
  let mae = 0;
  let mfe = 0;

  for (const bar of rthBars) {
    if (direction.includes("down") || direction === "SELL") {
      const adverseMove = (bar.high - entryPrice) / entryPrice;
      const favorableMove = (entryPrice - bar.low) / entryPrice;
      mae = Math.max(mae, adverseMove);
      mfe = Math.max(mfe, favorableMove);
    } else {
      const adverseMove = (entryPrice - bar.low) / entryPrice;
      const favorableMove = (bar.high - entryPrice) / entryPrice;
      mae = Math.max(mae, adverseMove);
      mfe = Math.max(mfe, favorableMove);
    }
  }

  return { mae, mfe };
}
