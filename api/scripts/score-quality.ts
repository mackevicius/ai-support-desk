import { readFile, writeFile } from 'node:fs/promises';
import { scoreQualityReport } from '../src/quality.js';

const filename = process.argv[2];
if (!filename) throw new Error('Pass the evaluation report path');
const report = scoreQualityReport(JSON.parse(await readFile(filename, 'utf8')));
await writeFile(filename, `${JSON.stringify(report, null, 2)}\n`);