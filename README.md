# Snowflake.RunSQLAction

A minimal GitHub Action that runs a single SQL statement against Snowflake and returns JSON.

## Usage

```yaml
- uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: 'select current_user() as current_user'
    return-rows: 100
  env:
    SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
    SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
    SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
    SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}
```

You can also set `RUN_SQL_STATEMENT` or `RUN_SQL_RETURN_ROWS` via environment variables instead of inputs. `return-rows` defaults to 100 (capped at 1000) and the action tries to append a `LIMIT <n>` clause for `SELECT/WITH/SHOW/DESC` statements so fewer rows ever leave Snowflake (other statement types fall back to client-side truncation). Use `SNOWFLAKE_LOG_LEVEL=VERBOSE` if you need extra logging.

### Outputs & logging

- Logs now include a compact summary (executed SQL, query id, row count, detected columns, and a preview of up to 5 rows) so large result sets don’t overwhelm GitHub logs.
- Set `SNOWFLAKE_LOG_LEVEL=VERBOSE` if you still want the full JSON payload echoed.
- Programmatic consumers can use action outputs:
  - `summary-json` – metadata summary (stringified JSON)
  - `result-json` – full payload (stringified JSON)
