# Snowflake.RunSQLAction

A minimal GitHub Action that runs a single SQL statement against Snowflake using the shared `@marcelinojackson-org/snowflake-common` helper.

## Usage

```yaml
- uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: 'select current_user() as current_user'
  env:
    SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
    SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
    SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
    SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}
```

You can also set `RUN_SQL_STATEMENT` in the environment instead of passing an input.

## Local development

```bash
npm install
npm run build
RUN_SQL_STATEMENT='select current_version()' node dist/snowflake-runsql.js
```
