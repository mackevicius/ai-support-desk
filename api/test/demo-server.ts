import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import { createApp } from '../src/app.js';

const database = newDb();
database.public.none(
  readFileSync(new URL('../../db/seed.sql', import.meta.url), 'utf8'),
);
const { Pool } = database.adapters.createPg();
const pool = new Pool();
createApp(pool).listen(3101, '127.0.0.1');
