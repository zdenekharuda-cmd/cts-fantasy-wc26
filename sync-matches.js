import 'dotenv/config';
import { syncOpenFootball } from '../src/syncOpenFootball.js';

try {
  const result = await syncOpenFootball();
  console.log(`Synced ${result.count} matches (${result.finished} finished) from ${result.source}`);
} catch (error) {
  console.error('Could not sync matches:', error.message);
  process.exit(1);
}
