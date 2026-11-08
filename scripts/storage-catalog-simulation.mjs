const counts = [100_000, 500_000, 1_000_000];
const pageSize = 24;
const results = [];

for (const count of counts) {
  const started = performance.now();
  const urls = new Array(count);
  for (let index = 0; index < count; index += 1) {
    urls[index] = `https://cdn.example.test/vendors/store/img-${index.toString(16).padStart(8, "0")}.webp`;
  }
  let pages = 0;
  for (let offset = 0; offset < Math.min(count, pageSize * 20); offset += pageSize) {
    const page = urls.slice(offset, offset + pageSize);
    if (page.length !== pageSize && offset + pageSize < count) throw new Error("SHORT_PAGE");
    pages += 1;
  }
  const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  results.push({
    imageReferences: count,
    pagesChecked: pages,
    pageSize,
    buildAndPageMs: Math.round(performance.now() - started),
    heapMb,
    approximateUrlBytes: count * urls[0].length,
  });
  urls.length = 0;
}

console.log(JSON.stringify({
  kind: "in-memory-url-reference-simulation",
  cloudObjectsCreated: 0,
  databaseQueries: 0,
  assumption: "One public URL string per image. This does not measure PostgreSQL, Sharp, or a storage provider.",
  results,
}));
