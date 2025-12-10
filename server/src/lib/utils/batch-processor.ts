/**
 * Batch Processing Utility
 * Generic helper for processing items in batches
 */

/**
 * Result of batch processing
 */
export interface BatchProcessingResult<T> {
  successful: T[];
  failed: Array<{ index: number; error: string }>;
}

/**
 * Split array into chunks of specified size
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Process items in batches
 * @param items - Items to process
 * @param batchSize - Number of items per batch
 * @param processor - Function to process each batch
 * @returns Results from all batches
 */
export async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<R[]>
): Promise<R[]> {
  const chunks = chunkArray(items, batchSize);
  const results: R[] = [];

  for (const chunk of chunks) {
    const chunkResults = await processor(chunk);
    results.push(...chunkResults);
  }

  return results;
}
