# Snowflake.RunSQLAction

A minimal GitHub Action that runs a single SQL statement against Snowflake and returns JSON.

## Usage

```yaml
- uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: 'select current_user() as current_user'
    max-rows: 100
    debug: MINIMAL
  env:
    SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
    SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
    SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
    SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}
```

You can also set `RUN_SQL_STATEMENT`, `RUN_SQL_MAX_ROWS`, or `RUN_SQL_DEBUG` via environment variables instead of inputs. `max-rows` defaults to 100 (capped at 1000). Set `debug: VERBOSE` to echo extra logs and enable verbose Snowflake client logging.
