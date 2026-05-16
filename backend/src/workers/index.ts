/**
 * Start all pipeline workers.
 * Imported by src/index.ts so workers run in the same process as the API.
 *
 * For production horizontal scaling, extract each worker into its own
 * process/container and point them at the same Redis instance — BullMQ
 * handles the coordination automatically.
 */

import { startConversionWorker } from './conversionWorker';
import { startCompressionWorker } from './compressionWorker';
import { startVariantWorker } from './variantWorker';
import { closeAllQueues } from '../queue/index';

export function startAllWorkers() {
  const workers = [
    startConversionWorker(),
    startCompressionWorker(),
    startVariantWorker(),
  ];

  // Graceful shutdown — close workers then queue connections.
  // Don't force process.exit; let the event loop drain naturally.
  const shutdown = async () => {
    console.log('[workers] shutting down...');
    await Promise.all(workers.map((w) => w.close()));
    await closeAllQueues();
    console.log('[workers] shutdown complete');
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
