import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app.js';
import { prepareDatabase } from '../src/schema.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './fake-provider.js';

process.env.PYTHON_URL = `http://127.0.0.1:${process.env.DEMO_AI_PORT ?? 3103}`;
process.env.AI_SERVICE_SECRET = 'test-service-secret';
const python = spawn(
  'python3',
  ['-u', fileURLToPath(new URL('../../ai/server.py', import.meta.url))],
  {
    env: {
      ...process.env,
      PORT: process.env.DEMO_AI_PORT ?? '3103',
      OPENAI_BASE_URL: `http://127.0.0.1:${process.env.DEMO_PROVIDER_PORT ?? 3102}`,
      OPENAI_API_KEY: 'fake-key',
    },
    stdio: 'inherit',
  },
);
process.on('exit', () => python.kill());

const database = newDb();
database.public.none(
  readFileSync(new URL('../seed.sql', import.meta.url), 'utf8'),
);
const { Pool } = database.adapters.createPg();
const pool = new Pool();
await prepareDatabase(pool);
createApp(pool).listen(Number(process.env.DEMO_API_PORT ?? 3101), '127.0.0.1');
