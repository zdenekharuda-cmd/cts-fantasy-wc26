import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_DATA_DIR = __dirname;
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : DEFAULT_DATA_DIR;

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readJson(fileName, fallback) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error.code === 'ENOENT') {
      // When DATA_DIR points to a cloud persistent disk, seed missing files from the bundled app data.
      if (DATA_DIR !== DEFAULT_DATA_DIR) {
        try {
          const bundledRaw = await fs.readFile(path.join(DEFAULT_DATA_DIR, fileName), 'utf8');
          const bundledData = bundledRaw.trim() ? JSON.parse(bundledRaw) : fallback;
          await writeJson(fileName, bundledData);
          return bundledData;
        } catch {
          // Fall back to the provided default below.
        }
      }
      await writeJson(fileName, fallback);
      return fallback;
    }
    throw error;
  }
}

export async function writeJson(fileName, data) {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, fileName);
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
  await fs.rename(tempPath, filePath);
}

export async function nextId(fileName) {
  const items = await readJson(fileName, []);
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}
