import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './db/database.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const database = openDatabase();
const app = await createApp({
  database,
  staticRoot: join(currentDirectory, '../client'),
});

app.addHook('onClose', async () => {
  database.close();
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exit(1);
}
