import * as core from '@actions/core';
import { runSql, SnowflakeConnectionConfig } from '@marcelinojackson-org/snowflake-common';

type DebugLevel = 'MINIMAL' | 'VERBOSE';

function gatherConfig(debugLevel: DebugLevel): SnowflakeConnectionConfig {
  return {
    account: process.env.SNOWFLAKE_ACCOUNT || process.env.SNOWFLAKE_ACCOUNT_URL,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    privateKeyPath: process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
    role: process.env.SNOWFLAKE_ROLE,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    logLevel: debugLevel
  };
}

function normalizeDebug(value?: string): DebugLevel {
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

async function main(): Promise<void> {
  try {
    const inputSql = core.getInput('sql', { required: false });
    const envSql = process.env.RUN_SQL_STATEMENT;
    const sqlText = (inputSql || envSql || 'select current_user() as current_user').trim();

    const debugLevel = normalizeDebug(core.getInput('debug') || process.env.RUN_SQL_DEBUG);
    const maxRows = clampRows(core.getInput('max-rows') || process.env.RUN_SQL_MAX_ROWS);
    const config = gatherConfig(debugLevel);

    if (debugLevel === 'VERBOSE') {
      console.log(`[VERBOSE] Executing SQL: ${sqlText}`);
      console.log(`[VERBOSE] Max rows: ${maxRows}`);
    }

    const result = await runSql(sqlText, config);
    const trimmedRows = result.rows.slice(0, maxRows);
    const trimmed = result.rows.length > maxRows;

    const output = {
      ...result,
      rows: trimmedRows,
      rowCount: trimmedRows.length,
      notice: trimmed ? `Result truncated to ${maxRows} rows.` : undefined
    };

    console.log('Snowflake query succeeded ✅');
    console.log(JSON.stringify(output, null, 2));
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
