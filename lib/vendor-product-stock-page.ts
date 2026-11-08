export type StockPageCursor = {
  id: string;
  createdAt: Date;
};

export async function collectStockFilteredPage<T extends { id: string; createdAt: Date }>(input: {
  page: number;
  pageSize: number;
  batchSize: number;
  loadBatch: (cursor?: StockPageCursor) => Promise<T[]>;
  matches: (item: T) => boolean;
}): Promise<{ items: T[]; page: number; total: number }> {
  const start = (input.page - 1) * input.pageSize;
  const end = start + input.pageSize;
  const items: T[] = [];
  const lastPageItems: T[] = [];
  let total = 0;
  let cursor: StockPageCursor | undefined;

  while (true) {
    const batch = await input.loadBatch(cursor);
    if (!batch.length) break;

    for (const item of batch) {
      if (!input.matches(item)) continue;
      if (total >= start && total < end) items.push(item);
      lastPageItems.push(item);
      if (lastPageItems.length > input.pageSize) lastPageItems.shift();
      total++;
    }

    if (batch.length < input.batchSize) break;
    const last = batch[batch.length - 1];
    cursor = { id: last.id, createdAt: last.createdAt };
  }

  const pageCount = Math.ceil(total / input.pageSize);
  const page = pageCount ? Math.min(input.page, pageCount) : 1;
  return {
    items: page === input.page ? items : lastPageItems,
    page,
    total,
  };
}
