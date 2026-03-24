import type { Signal, TradePlan } from "@shared/schema";
import { storage } from "../storage";

interface OnDeckFilterable {
    status: string;
    activationStatus: string;
}

export async function getAllSignals(): Promise<Signal[]>;
export async function getAllSignals<T extends OnDeckFilterable>(simSignals: Map<number, T>): Promise<T[]>;
export async function getAllSignals<T extends OnDeckFilterable>(simSignals?: Map<number, T>): Promise<(Signal | T)[]> {
    if (!simSignals) {
        return await storage.getSignals(undefined, 5000);
    }
    return Array.from(simSignals.values());
}

export async function getOnDeckSignals(): Promise<Signal[]>;
export async function getOnDeckSignals<T extends OnDeckFilterable>(simSignals: Map<number, T>): Promise<T[]>;
export async function getOnDeckSignals<T extends OnDeckFilterable>(simSignals?: Map<number, T>): Promise<(Signal | T)[]> {
    if (!simSignals) {
        const all = await storage.getSignals(undefined, 5000);
        return all.filter(
            (s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE",
        );
    }
    const all = Array.from(simSignals.values());
    return all.filter(
        (s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE",
    );
}

export function checkInvalidation(
    currentPrice: number,
    tradePlan: TradePlan,
    entryPrice: number,
    stopPrice: number | null,
): boolean {
    if (stopPrice == null) {
        const stopDistance = tradePlan.stopDistance;
        if (!stopDistance || stopDistance <= 0) return false;
        if (tradePlan.bias === "SELL") {
            return currentPrice > entryPrice + stopDistance * 1.5;
        }
        return currentPrice < entryPrice - stopDistance * 1.5;
    }
    if (tradePlan.bias === "SELL") {
        return currentPrice > stopPrice;
    }
    return currentPrice < stopPrice;
}
