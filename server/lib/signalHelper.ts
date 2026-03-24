import type { Signal } from "@shared/schema";
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
    const allSignals = await getAllSignals(simSignals as any);
    return allSignals.filter(
        (s) => s.status === "pending" && s.activationStatus === "NOT_ACTIVE",
    );
}
