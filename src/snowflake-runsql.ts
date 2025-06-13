import * as core from '@actions/core';
import { runSql, SnowflakeConnectionConfig, SnowflakeQueryResult } from '@marcelinojackson-org/snowflake-common';

type LogLevel = 'MINIMAL' | 'VERBOSE';

const LIMITABLE_PREFIXES = new Set(['SELECT', 'WITH', 'SHOW', 'DESC', 'DESCRIBE']);
const PREVIEW_ROW_LIMIT = 5;

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
  return Math.min(1000, raw);
}

interface LimitPlan {
  sql: string;
  applied: boolean;
  reason?: string;
}

interface QuerySummary {
  executedSql: string;
  requestedSql: string;
  queryId: string;
  requestedRows: number;
  rowsReturned: number;
  limitAppliedInSql: boolean;
  limitReason?: string;
  columns: string[];
  previewRows: Array<Record<string, unknown>>;
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
    const sqlText = (inputSql || envSql || 'select current_user() as current_user').trim();

    const maxRows = clampRows(core.getInput('return-rows') || process.env.RUN_SQL_RETURN_ROWS);
    const config = gatherConfig();
    const verbose = config.logLevel === 'VERBOSE';
    const limitPlan = enforceSqlLimit(sqlText, maxRows);

    if (verbose) {
      console.log(`[VERBOSE] SQL: ${sqlText}`);
      console.log(`[VERBOSE] Executed SQL: ${limitPlan.sql}`);
      console.log(`[VERBOSE] Return rows: ${maxRows}`);
      console.log(`[VERBOSE] LIMIT applied in SQL: ${limitPlan.applied} (${limitPlan.reason ?? 'appended'})`);
    }

    const result = await runSql(limitPlan.sql, config);
    const trimmedRows = result.rows.slice(0, maxRows);
    const trimmed = result.rows.length > maxRows;

    const output: ActionResult = {
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

    const summary = buildSummary(output, maxRows);

    console.log('Snowflake query succeeded ✅');
    console.log('Summary:', JSON.stringify(summary, null, 2));
    if (summary.previewRows.length > 0) {
      console.log('Row preview:', JSON.stringify(summary.previewRows, null, 2));
    }
    if (verbose) {
      console.log('Full result payload (verbose mode):');
      console.log(JSON.stringify(output, null, 2));
    }

    core.setOutput('summary-json', JSON.stringify(summary));
    core.setOutput('result-json', JSON.stringify(output));
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

type ActionResult = SnowflakeQueryResult & {
  requestedSql: string;
  executedSql: string;
  limit: {
    requestedRows: number;
    enforcedInSql: boolean;
    reason?: string;
  };
  notice?: string;
};

function buildSummary(result: ActionResult, requestedRows: number): QuerySummary {
  const columns = new Set<string>();
  result.rows.forEach((row: Record<string, unknown>) => {
    Object.keys(row).forEach((key) => columns.add(key));
  });

  return {
    executedSql: result.executedSql,
    requestedSql: result.requestedSql,
    queryId: result.queryId,
    requestedRows,
    rowsReturned: result.rows.length,
    limitAppliedInSql: result.limit.enforcedInSql,
    limitReason: result.limit.reason,
    columns: Array.from(columns.values()),
    previewRows: result.rows.slice(0, PREVIEW_ROW_LIMIT)
  };
}
