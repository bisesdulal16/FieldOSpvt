import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

async function copyDir(source, destination) {
  if (!existsSync(source)) {
    console.warn(`[build] Skipping missing asset directory: ${source}`);
    return;
  }
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
  console.log(`[build] Copied ${source} -> ${destination}`);
}

await copyDir('.next/static', '.next/standalone/.next/static');
await copyDir('public', '.next/standalone/public');
