import { after } from 'next/server';

// Ro'yxatni ko'pi bilan `limit` ta parallel ishlov bilan qayta ishlaydi. Telegram (~30 xabar/soniya)
// va baza ulanish puli chegarasidan oshib ketmaslik uchun.
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Javob qaytgandan keyin bajariladigan ish (masalan, Mini App'dan retsept qo'shilgach botda
// tasdiq xabari). So'rov kontekstidan tashqarida (skript, test) chaqirilsa — shunchaki fonda.
export function runAfterResponse(task: () => Promise<unknown>): void {
  const safeTask = async () => {
    try {
      await task();
    } catch (err) {
      console.error('[fon vazifa] xato:', err);
    }
  };

  try {
    after(safeTask);
  } catch {
    void safeTask();
  }
}
