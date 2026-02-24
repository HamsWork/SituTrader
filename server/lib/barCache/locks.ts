type Resolver = () => void;

const locks = new Map<string, Promise<void>>();
const queues = new Map<string, Resolver[]>();

export function makeLockKey(
  symbol: string,
  timeframe: string,
  adjusted: boolean,
): string {
  return `${symbol}|${timeframe}|${adjusted ? 1 : 0}`;
}

export async function acquireLock(key: string): Promise<() => void> {
  while (locks.has(key)) {
    await locks.get(key);
  }

  let release!: Resolver;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(key, promise);

  return () => {
    locks.delete(key);
    release();
  };
}
