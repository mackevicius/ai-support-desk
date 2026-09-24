import pg from 'pg';
import { createApp } from './app.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const port = Number(process.env.PORT ?? 3001);
createApp(pool).listen(port, '0.0.0.0', () => {
  console.log(`Support API listening on ${port}`);
});
