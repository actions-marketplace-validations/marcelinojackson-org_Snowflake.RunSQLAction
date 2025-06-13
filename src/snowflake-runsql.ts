import * as core from '@actions/core';
import { promises as fs } from 'fs';
import * as path from 'path';
import { runSql, SnowflakeConnectionConfig } from '@marcelinojackson-org/snowflake-common';

type LogLevel = 'MINIMAL' | 'VERBOSE';

const LIMITABLE_PREFIXES = new Set(['SELECT', 'WITH', 'SHOW', 'DESC', 'DESCRIBE']);

function gatherConfig(): SnowflakeConnectionConfig {
  const logLevel = normalizeLogLevel(process.env.SNOWFLAKE_LOG_LEVEL);
  return {
    account: process.env.SNOWFLAKE_ACCOUNT || process.env.SNOWFLAKE_ACCOUNT_URL,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    privateKeyPath: process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
    role: process.env.SNOWFLAKE_ROLE,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    logLevel
  };
}

function normalizeLogLevel(value?: string): LogLevel {
  const upper = (value ?? 'MINIMAL').toUpperCase();
  return upper === 'VERBOSE' ? 'VERBOSE' : 'MINIMAL';
}

function clampRows(value?: string): number {
  const raw = Number(value ?? '');
  if (Number.isNaN(raw) || raw <= 0) {
    return 100;
  }
  return Math.min(10000, raw);
}

interface LimitPlan {
  sql: string;
  applied: boolean;
  reason?: string;
}

interface PersistenceOptions {
  enabled: boolean;
  filename: string;
  directory?: string;
}

interface PersistedFiles {
  csvPath: string;
  metadataPath: string;
}

function enforceSqlLimit(sqlText: string, maxRows: number): LimitPlan {
  const trimmed = sqlText.trim();
  if (!trimmed) {
    return { sql: trimmed, applied: false, reason: 'empty-sql' };
  }

  const normalized = stripSqlComments(trimmed);
  if (/\blimit\s+\d+/i.test(normalized)) {
    return { sql: trimmed, applied: false, reason: 'existing-limit-detected' };
  }

  const firstTokenMatch = trimmed.match(/^[^\s(]+/);
  const firstToken = firstTokenMatch ? firstTokenMatch[0].toUpperCase() : '';

  if (LIMITABLE_PREFIXES.has(firstToken)) {
    const { body, semicolon } = stripTrailingSemicolons(trimmed);
    return {
      sql: `${body} limit ${maxRows}${semicolon ? ';' : ''}`,
      applied: true
    };
  }

  if (firstToken.startsWith('SELECT') || trimmed.startsWith('(')) {
    return {
      sql: `select * from (\n${trimmed}\n) limit ${maxRows}`,
      applied: true
    };
  }

  return { sql: trimmed, applied: false, reason: 'statement-type-not-supported-for-limit' };
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripTrailingSemicolons(sql: string): { body: string; semicolon: boolean } {
  let body = sql.trimEnd();
  let hadSemicolon = false;
  while (body.endsWith(';')) {
    body = body.slice(0, -1).trimEnd();
    hadSemicolon = true;
  }
  return { body, semicolon: hadSemicolon };
}

async function main(): Promise<void> {
  try {
    const inputSql = core.getInput('sql', { required: false });
    const envSql = process.env.RUN_SQL_STATEMENT;
    const sqlText = selectSqlText(inputSql, envSql);

    const maxRows = clampRows(core.getInput('return-rows') || process.env.RUN_SQL_RETURN_ROWS);
    const config = gatherConfig();
    const verbose = config.logLevel === 'VERBOSE';
    const limitPlan = enforceSqlLimit(sqlText, maxRows);
    const persistence = resolvePersistenceOptions();

    if (verbose) {
      console.log(`[VERBOSE] SQL: ${sqlText}`);
      console.log(`[VERBOSE] Executed SQL: ${limitPlan.sql}`);
      console.log(`[VERBOSE] Return rows: ${maxRows}`);
      console.log(`[VERBOSE] LIMIT applied in SQL: ${limitPlan.applied} (${limitPlan.reason ?? 'appended'})`);
    }

    const result = await runSql(limitPlan.sql, config);
    const trimmedRows = result.rows.slice(0, maxRows);
    const trimmed = result.rows.length > maxRows;

    const output = {
      ...result,
      requestedSql: sqlText,
      executedSql: limitPlan.sql,
      rows: trimmedRows,
      rowCount: trimmedRows.length,
      limit: {
        requestedRows: maxRows,
        enforcedInSql: limitPlan.applied,
        reason: limitPlan.reason
      },
      notice: trimmed ? `Result truncated to ${maxRows} rows.` : undefined
    };

    const summary = buildSummary(output);
    console.log('Snowflake query succeeded ✅');
    console.log('Summary:', JSON.stringify(summary, null, 2));

    let persistedCsv = '';
    let persistedMeta = '';
    if (persistence.enabled) {
      try {
        const files = await persistResults(output, trimmedRows, persistence);
        persistedCsv = files.csvPath;
        persistedMeta = files.metadataPath;
        console.log(`Full row set written to ${persistedCsv}`);
        console.log(`Result metadata written to ${persistedMeta}`);
      } catch (persistErr) {
        console.warn('Failed to persist result file:', persistErr);
      }
    } else {
      const csvOutput = buildCsvPayload(trimmedRows);
      if (csvOutput) {
        console.log('Rows (CSV):');
        console.log(csvOutput);
      } else {
        console.log('Rows (CSV): [no rows returned]');
      }
    }

    core.setOutput('result-file', persistedCsv);
    core.setOutput('result-metadata-file', persistedMeta);
  } catch (error) {
    console.error('Snowflake query failed:');
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
      core.setFailed(error.message);
    } else {
      console.error(error);
      core.setFailed('Unknown error when running SQL');
    }
  }
}

void main();

function selectSqlText(inputSql?: string, envSql?: string): string {
  const trimmedInput = inputSql?.trim();
  const trimmedEnv = envSql?.trim();
  const candidate = trimmedInput && trimmedInput.length > 0 ? trimmedInput : trimmedEnv;
  if (!candidate) {
    throw new Error('SQL input missing. Provide the `sql` input or set RUN_SQL_STATEMENT.');
  }
  return candidate;
}

function resolvePersistenceOptions(): PersistenceOptions {
  const inputValue = core.getInput('persist-results');
  const envValue = process.env.RUN_SQL_PERSIST_RESULTS;
  const enabled = parseBoolean(inputValue) ?? parseBoolean(envValue) ?? false;

  const filenameInput = core.getInput('result-filename') || process.env.RUN_SQL_RESULT_FILENAME || 'snowflake-result.csv';
  const filename = filenameInput.trim() || 'snowflake-result.csv';

  const directory = process.env.RUN_SQL_RESULT_DIR;

  return { enabled, filename, directory };
}

function parseBoolean(value?: string): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return undefined;
}

async function persistResults(
  result: {
    queryId: string;
    requestedSql: string;
    executedSql: string;
  },
  rows: Array<Record<string, unknown>>,
  options: PersistenceOptions
): Promise<PersistedFiles> {
  const rootDir =
    options.directory ||
    process.env.RUN_SQL_RESULT_DIR ||
    path.join(process.env.RUNNER_TEMP || path.join(process.cwd(), 'snowflake-results'), 'snowflake-results');
  const resolvedDir = path.isAbsolute(rootDir) ? rootDir : path.join(process.cwd(), rootDir);
  const paths = buildPersistedPaths(result.queryId, options.filename, resolvedDir);

  await fs.rm(resolvedDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(resolvedDir, { recursive: true });

  await writeRowsToCsv(rows, paths.csvPath);

  const metadata = {
    queryId: result.queryId,
    requestedSql: result.requestedSql,
    executedSql: result.executedSql,
    rowCount: rows.length,
    generatedAt: new Date().toISOString()
  };
  await fs.writeFile(paths.metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

  return paths;
}

function buildPersistedPaths(queryId: string, filename: string, baseDir: string): PersistedFiles {
  const parsed = path.parse(filename);
  const baseName = parsed.name || 'snowflake-result';
  const ext = parsed.ext || '.csv';
  const idToken = (queryId || 'result').split('-').pop() || 'result';
  const safeId = sanitizeForFilename(idToken);

  const csvName = `${baseName}-${safeId}${ext}`;
  const metadataName = `${baseName}-${safeId}.meta.json`;

  return {
    csvPath: path.join(baseDir, csvName),
    metadataPath: path.join(baseDir, metadataName)
  };
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-');
}

async function writeRowsToCsv(rows: Array<Record<string, unknown>>, destination: string): Promise<void> {
  const payload = buildCsvPayload(rows);
  await fs.writeFile(destination, payload, 'utf8');
}

function buildCsvPayload(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }

  const columns: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    });
  });

  const lines: string[] = [];
  lines.push(columns.map((col) => csvEscape(col)).join(','));

  for (const row of rows) {
    const values = columns.map((col) => csvEscape(row[col]));
    lines.push(values.join(','));
  }

  return `${lines.join('\n')}\n`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  let str: string;
  if (value instanceof Date) {
    str = value.toISOString();
  } else if (typeof value === 'object') {
    str = JSON.stringify(value);
  } else {
    str = String(value);
  }

  if (/[",\n\r]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildSummary(output: {
  queryId: string;
  requestedSql: string;
  executedSql: string;
  rowCount: number;
  limit: { requestedRows: number; enforcedInSql: boolean; reason?: string };
  notice?: string;
}) {
  return {
    queryId: output.queryId,
    requestedSql: output.requestedSql,
    executedSql: output.executedSql,
    rowCount: output.rowCount,
    limit: output.limit,
    notice: output.notice
  };
}
