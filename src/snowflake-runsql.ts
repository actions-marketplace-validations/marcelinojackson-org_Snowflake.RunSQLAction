import * as core from '@actions/core';
import { runSql, SnowflakeConnectionConfig } from '@marcelinojackson-org/snowflake-common';

function gatherConfig(): SnowflakeConnectionConfig {
  return {
    account: process.env.SNOWFLAKE_ACCOUNT || process.env.SNOWFLAKE_ACCOUNT_URL,
    username: process.env.SNOWFLAKE_USER,
    password: process.env.SNOWFLAKE_PASSWORD,
    privateKeyPath: process.env.SNOWFLAKE_PRIVATE_KEY_PATH,
    role: process.env.SNOWFLAKE_ROLE,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE,
    database: process.env.SNOWFLAKE_DATABASE,
    schema: process.env.SNOWFLAKE_SCHEMA,
    logLevel: (process.env.SNOWFLAKE_LOG_LEVEL as 'MINIMAL' | 'VERBOSE' | undefined) ?? 'MINIMAL'
  };
}

async function main(): Promise<void> {
  try {
    const inputSql = core.getInput('sql', { required: false });
    const envSql = process.env.RUN_SQL_STATEMENT;
    const sqlText = (inputSql || envSql || 'select current_user() as current_user').trim();

    const config = gatherConfig();
    const result = await runSql(sqlText, config);

    console.log('Snowflake query succeeded ✅');
    console.log(JSON.stringify(result, null, 2));
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
