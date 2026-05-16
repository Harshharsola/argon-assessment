import app from './app';
import { startAllWorkers } from './workers/index';

const PORT = process.env.PORT ?? 3001;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Start BullMQ workers in-process.
// For production scale: extract to separate worker process/container
// pointing at the same Redis, and scale each independently.
startAllWorkers();
