# Snowflake.RunSQLAction

A minimal GitHub Action that runs a single SQL statement against Snowflake and returns JSON.

## Inputs & environment

| Input / Env | Required? | Description |
|-------------|-----------|-------------|
| `sql` / `RUN_SQL_STATEMENT` | **Required** | SQL text to execute. You must supply the input or set the env variable—there is no default query. |
| `return-rows` / `RUN_SQL_RETURN_ROWS` | Optional (`100`, max `10000`) | Maximum number of rows to *print*. The action attempts to append `LIMIT <n>` to SELECT/WITH/SHOW/DESC statements so fewer rows leave Snowflake. |
| `persist-results` / `RUN_SQL_PERSIST_RESULTS` | Optional (`false`) | When `true`, skips printing every row and instead writes two files (CSV + metadata JSON) for artifact upload. |
| `result-filename` / `RUN_SQL_RESULT_FILENAME` | Optional (`snowflake-result.csv`) | Base filename used when persisting results. The action appends the Snowflake query id suffix and keeps the `.csv` extension unless you specify a different one. |
| `RUN_SQL_RESULT_DIR` | Optional | Directory where persisted files will be written. Defaults to `RUNNER_TEMP` (or `snowflake-results/` for local runs). |
| `SNOWFLAKE_*` env vars | **Required** | Provide your account credentials (account URL, user, password/private key, role, warehouse, database, schema). Set `SNOWFLAKE_LOG_LEVEL=VERBOSE` to see the full JSON payload in the logs even when persistence is enabled. |

> **Note:** The action always requires Snowflake credentials via environment variables. Use repository or organization secrets for sensitive values (`SNOWFLAKE_PASSWORD`, `SNOWFLAKE_PAT, etc.).

## Basic usage

```yaml
- name: Run Snowflake SQL
  uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: "select current_user() as current_user"
    return-rows: 25
  env:
    SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
    SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
    SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
    SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}
```

You can omit the `sql` input only if you provide `RUN_SQL_STATEMENT`. `sql`/`RUN_SQL_STATEMENT` is mandatory—if both are empty, the action fails. Any query type is supported; the action will still execute even if it cannot append a `LIMIT` clause, but large result sets will be truncated client-side to respect `return-rows`.

## Advanced usage

```yaml
- name: Run Snowflake SQL (advanced)
  id: runsql
  uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: ${{ inputs.dynamic_sql }}
    return-rows: 500
    persist-results: true
    result-filename: nightly-report.csv
  env:
    RUN_SQL_RESULT_DIR: ${{ runner.temp }}/snowflake-artifacts
    SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
    SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
    SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
    SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}

- name: Publish artifacts
  if: ${{ steps.runsql.outputs.result-file != '' }}
  uses: actions/upload-artifact@v4
  with:
    name: nightly-snowflake-export
    path: |
      ${{ steps.runsql.outputs.result-file }}
      ${{ steps.runsql.outputs.result-metadata-file }}
```

## Persisting large result sets

Set `persist-results: true` (or `RUN_SQL_PERSIST_RESULTS=true`) to write the full row set to disk as CSV (UTF‑8). The runner appends the last token of the Snowflake query id to the base filename (e.g., `snowflake-result-<idSuffix>.csv`) and also emits a companion `<name>-<idSuffix>.meta.json` describing the SQL and row count. Control the base name via `result-filename` (or `RUN_SQL_RESULT_FILENAME`), defaulting to `snowflake-result.csv`. Files are written under `RUN_SQL_RESULT_DIR` (or a `snowflake-results` subfolder inside `RUNNER_TEMP`); that directory is recreated on each run so artifacts never pile up.

When persistence is enabled the action prints only a compact summary to the logs (query id, row count, limit info). If you need the full JSON payload in the log, leave persistence disabled.

```yaml
- name: Run Snowflake SQL
  id: runsql
  uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: "select * from information_schema.tables where table_schema = current_schema()"
    persist-results: true
    result-filename: tables.csv

- name: Upload full result
  if: ${{ steps.runsql.outputs.result-file != '' }}
  uses: actions/upload-artifact@v4
  with:
    name: snowflake-result
    path: |
      ${{ steps.runsql.outputs.result-file }}
      ${{ steps.runsql.outputs.result-metadata-file }}
```

### Outputs

- `result-file`: absolute path to the persisted CSV file (empty string when persistence is disabled).
- `result-metadata-file`: absolute path to the metadata JSON file (empty string when persistence is disabled).
