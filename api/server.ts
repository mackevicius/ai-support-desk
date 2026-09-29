import pg from 'pg';
import express from 'express';
import { createApp } from './src/app.js';
import { prepareDatabase } from './src/schema.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let initialization: Promise<void> | undefined;
const app = express();
app.use(async (_request, response, next) => {
	initialization ??= prepareDatabase(pool).catch((error) => {
		initialization = undefined;
		console.error('Database initialization failed');
		throw error;
	});
	try {
		await initialization;
		next();
	} catch {
		response.sendStatus(503);
	}
});
app.use(createApp(pool));

export default app;
