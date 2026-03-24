import type {Signal} from "@shared/schema";
import { storage } from "../storage";
import type { SimDayContext } from "../simulation";

export async function getAllSignals(ctx?: SimDayContext): Promise<Signal[]> {
    if (!ctx) {
        return await storage.getSignals(undefined, 5000);
    }

    return Array.from(ctx.allSignals.values());
}

export async function getOnDeckSignals(ctx?: SimDayContext): Promise<Signal[]> {
    const allSignals = await getAllSignals(ctx);
    return allSignals.filter(
        (s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE",
    );
}