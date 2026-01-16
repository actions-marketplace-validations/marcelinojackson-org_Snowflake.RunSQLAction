# Shipping AI-Powered Snowflake Workflows with GitHub Actions

How I use four open-source actions to run SQL, search data, and call Snowflake Cortex AI directly from CI/CD.

Running ad-hoc Snowflake queries from my laptop doesn’t scale.

As a DevSecOps-GenAI Architect, I care a lot about putting data access and AI in controlled, auditable paths—not random notebooks and terminal sessions.

I kept getting the same requests:

- "Can you rerun that query and send me the CSV?"
- "Can we get a daily KPI summary in Slack?"
- "Can non-SQL folks ask questions in plain English?"

So I pushed all of that into GitHub Actions, where everything else already lives. That led me to build four open-source actions:

- Snowflake.RunSQLAction – run SQL and return CSV or artifacts.  
  https://github.com/marcelinojackson-org/Snowflake.RunSQLAction
- Snowflake.CortexAI.SearchAction – semantic search over Snowflake data.  
  https://github.com/marcelinojackson-org/Snowflake.CortexAI.SearchAction
- Snowflake.CortexAI.AnalystAction – ask semantic models/views in natural language.  
  https://github.com/marcelinojackson-org/Snowflake.CortexAI.AnalystAction
- Snowflake.CortexAI.AgentAction – talk to a Cortex Agent and capture the full reasoning trace.  
  https://github.com/marcelinojackson-org/Snowflake.CortexAI.AgentAction

In this post I’ll show you the real workflows I run with these actions, with copy-paste YAML you can adapt for your own Snowflake environment.

## What you’ll learn

By the end, you’ll know how to:

- Run Snowflake SQL from GitHub Actions and export results.
- Call Snowflake Cortex Search and Cortex Analyst as part of a CI/CD workflow.
- Orchestrate Cortex Agents from Actions, including capturing all events for debugging.
- Combine all four actions into a daily "business health" pipeline.

## Prerequisites

You’ll need:

- A GitHub repo with Actions enabled.
- A Snowflake account with:
  - A user/role/warehouse that can run queries.
  - An appropriate Cortex-enabled role granted to the calling user (for example, a Cortex-capable role such as `CORTEX_USER`, depending on your setup).
  - A Cortex Search service created and available for Snowflake.CortexAI.SearchAction.
  - A Cortex Analyst semantic model or semantic view created and available for Snowflake.CortexAI.AnalystAction.
  - A Cortex Agent created, configured with tools, and available for Snowflake.CortexAI.AgentAction.

The GitHub Actions I’m using here are thin wrappers around those Snowflake capabilities—they don’t create Cortex objects for you. They assume you’ve already defined the search services, semantic models/views, and agents you want to call.

I store these in GitHub Secrets (sensitive) and Variables (non-sensitive).

Secrets:

- `SNOWFLAKE_ACCOUNT_URL`
- `SNOWFLAKE_ACCOUNT` (optional)
- `SNOWFLAKE_USER`
- `SNOWFLAKE_PASSWORD` or `SNOWFLAKE_PAT`
- `SNOWFLAKE_ROLE`
- `SNOWFLAKE_WAREHOUSE`
- `SNOWFLAKE_DATABASE`
- `SNOWFLAKE_SCHEMA`

Variables (examples):

- `SEARCH_SERVICE` – Cortex Search service name, e.g.  
  `SNOWFLAKE_SAMPLE_CORTEXAI_DB.SEARCH_DATA.CUSTOMER_REVIEW_SEARCH`
- `AGENT_DATABASE`, `AGENT_SCHEMA`
- Any semantic model/view paths you reuse

I usually start with a simple skeleton workflow:

```
name: Snowflake + Cortex AI Pipeline

on:
  workflow_dispatch:
  schedule:
    - cron: "0 6 * * *" # 6AM UTC daily

jobs:
  snowflake-cortex:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Steps added below…
```

From here, I layer in the four actions.

## Use case: Daily Snowflake + Cortex AI business health check

Let me anchor this in a real job.

Every morning at 6AM UTC, I run a workflow that:

- sanity-checks row counts in key tables
- surfaces at-risk orders via Cortex Search
- asks Cortex Analyst for KPI summaries
- lets a Cortex Agent turn that into a manager-friendly summary

Here’s the full workflow; I’ll break down each step right after.

```
name: Daily Snowflake + Cortex AI Report

on:
  workflow_dispatch:
  schedule:
    - cron: "0 6 * * *"

jobs:
  daily-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Sanity check – row counts
        id: rowcounts
        uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
        with:
          sql: |
            select table_name, row_count
            from information_schema.tables
            where table_schema = current_schema()
            order by row_count desc
          persist-results: true
          result-filename: rowcounts.csv
        env:
          SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
          SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
          SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
          SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
          SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
          SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
          SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}

      - name: Search for at-risk orders
        id: search
        uses: marcelinojackson-org/Snowflake.CortexAI.SearchAction@v1
        with:
          service-name: ${{ vars.SEARCH_SERVICE }}
          query: "orders with delivery complaints in the last 7 days"
          limit: 5
          include-scores: true
          score-threshold: 0.6
        env:
          SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
          SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}

      - name: KPI summary via Cortex Analyst
        id: kpi
        uses: marcelinojackson-org/Snowflake.CortexAI.AnalystAction@v1
        with:
          semantic-model-path: '@"SNOWFLAKE_SAMPLE_CORTEXAI_DB"."SEMANTIC"."SEMANTIC_MODELS"/tpch_sales_semantic_model.yaml'
          message: "Provide yesterday's total sales and a breakdown by nation."
          include-sql: true
          result-format: markdown
          temperature: 0.1
          max-output-tokens: 1024
        env:
          SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
          SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}

      - name: Executive summary via Cortex Agent
        id: agent
        uses: marcelinojackson-org/Snowflake.CortexAI.AgentAction@v1
        with:
          agent-name: ${{ vars.AGENT_NAME }}
          message: >
            ROLE:MANAGER
            Using our sales semantic model and order search tools, summarize
            yesterday's performance, call out any at-risk orders, and suggest
            2-3 follow-up actions for the sales team.
        env:
          SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
          SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}
          AGENT_DATABASE: ${{ vars.AGENT_DATABASE }}
          AGENT_SCHEMA: ${{ vars.AGENT_SCHEMA }}

      - name: Print final summary
        run: |
          echo "Daily manager summary:"
          echo '${{ steps.agent.outputs.answer-text }}'
```

Now let’s look at what each action is doing and how I use it.

## Step 1 – Running SQL with Snowflake.RunSQLAction

The first problem I wanted to solve was simple: “Run this Snowflake SQL in a consistent way and either show me the result or give me a CSV artifact.”

That’s exactly what Snowflake.RunSQLAction does.

Quick checks: logs only

For fast sanity checks, I keep it light and rely on logs:

```
- name: Run Snowflake SQL
  uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: "select current_user() as current_user"
    return-rows: 25
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
    SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
    SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
    SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}
```

How I use it:

- `sql` (or `RUN_SQL_STATEMENT`) is mandatory – if it’s empty, the action fails fast.
- `return-rows` caps how many rows actually get printed; the action will try to add a `LIMIT` for `SELECT/WITH/SHOW/DESC`.
- For quick inspections, I scroll the CSV directly in the GitHub Actions log.

If I need more than ~100 rows, I always switch to persistence.

Larger exports: artifacts

When I care about more than a handful of rows (for example daily row counts, snapshots, or a feed into another tool), I turn on `persist-results`:

```
- name: Run Snowflake SQL (export)
  id: runsql
  uses: marcelinojackson-org/Snowflake.RunSQLAction@v1
  with:
    sql: |
      select table_name, row_count
      from information_schema.tables
      where table_schema = current_schema()
      order by row_count desc
    persist-results: true
    result-filename: rowcounts.csv
  env:
    RUN_SQL_RESULT_DIR: ${{ runner.temp }}/snowflake-artifacts
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_USER }}
    SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_PASSWORD }}
    SNOWFLAKE_ROLE: ${{ secrets.SNOWFLAKE_ROLE }}
    SNOWFLAKE_WAREHOUSE: ${{ secrets.SNOWFLAKE_WAREHOUSE }}
    SNOWFLAKE_DATABASE: ${{ secrets.SNOWFLAKE_DATABASE }}
    SNOWFLAKE_SCHEMA: ${{ secrets.SNOWFLAKE_SCHEMA }}

- name: Upload full result
  if: ${{ steps.runsql.outputs.result-file != '' }}
  uses: actions/upload-artifact@v4
  with:
    name: snowflake-rowcounts
    path: |
      ${{ steps.runsql.outputs.result-file }}
      ${{ steps.runsql.outputs.result-metadata-file }}
```

The action gives me:

- `result-file` – CSV file path.
- `result-metadata-file` – JSON describing the query and row count.

This has become my “data export primitive” inside Actions.

## Step 2 – Semantic retrieval with Snowflake.CortexAI.SearchAction

Once I had repeatable SQL, the next step was semantic search over Snowflake data using Cortex Search.

Snowflake.CortexAI.SearchAction is my retrieval layer: I use it when I want the top-N relevant hits to feed into later steps.

Basic usage:

```
- name: Run Cortex Search
  uses: marcelinojackson-org/Snowflake.CortexAI.SearchAction@v1
  id: cortex-search
  with:
    service-name: ${{ vars.SEARCH_SERVICE }}
    query: "Find orders with complaints about delivery"
    limit: 3
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}
```

- `service-name` is your full search service name, e.g. `DB.SCHEMA.SERVICE`.
- `query` is natural language; you don’t write SQL here.
- The action returns a `result-json` output with both the original query and the Cortex Search JSON response.

Filtering and scoring:

```
- name: Search for at-risk orders
  id: search
  uses: marcelinojackson-org/Snowflake.CortexAI.SearchAction@v1
  with:
    service-name: ${{ vars.SEARCH_SERVICE }}
    query: "orders with delivery complaints in the last 7 days"
    limit: 5
    include-scores: true
    score-threshold: 0.6
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}

- name: Inspect JSON response
  run: |
    echo '${{ steps.search.outputs.result-json }}' | jq .
```

I treat this as my “top examples” retrieval step. Downstream, an analyst or agent can reference these hits to give more grounded answers.

## Step 3 – Asking questions with Snowflake.CortexAI.AnalystAction

Cortex Analyst is where semantic models meet natural-language questions.

Snowflake.CortexAI.AnalystAction wraps that into a GitHub Action, so I can ask business questions like “What were total sales by nation in 1995?” from CI.

Natural-language questions on semantic models:

```
- name: Ask Cortex Analyst
  uses: marcelinojackson-org/Snowflake.CortexAI.AnalystAction@v1
  id: analyst
  with:
    semantic-model-path: '@"SNOWFLAKE_SAMPLE_CORTEXAI_DB"."SEMANTIC"."SEMANTIC_MODELS"/tpch_sales_semantic_model.yaml'
    message: "What were total sales by nation in 1995?"
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}
```

You can also use a semantic view path instead of a model path, depending on how you’ve set up Cortex Analyst.

Capturing both SQL and answer:

```
- name: KPI summary via Cortex Analyst
  id: kpi
  uses: marcelinojackson-org/Snowflake.CortexAI.AnalystAction@v1
  with:
    semantic-model-path: '@"SNOWFLAKE_SAMPLE_CORTEXAI_DB"."SEMANTIC"."SEMANTIC_MODELS"/tpch_sales_semantic_model.yaml'
    message: "Provide yesterday's total sales and a breakdown by nation."
    include-sql: true
    result-format: markdown
    temperature: 0.1
    max-output-tokens: 1024
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}

- name: View response + SQL
  run: |
    echo "Generated SQL:"
    echo '${{ steps.kpi.outputs.generated-sql }}'
    echo "JSON response:"
    echo '${{ steps.kpi.outputs.result-json }}' | jq .
```

I treat Cortex Analyst as my “semantic SQL generator plus executor” that I can still audit in CI.

## Step 4 – Orchestrating with Snowflake.CortexAI.AgentAction

Finally, I use Snowflake.CortexAI.AgentAction to talk to a full Cortex Agent.

The agent can call tools (like Analyst and Search) and stream events. The action captures:

- the final answer text
- the final response event
- the complete event stream for debugging and auditing

Simple one-shot question:

```
- name: Ask the Employee Agent
  uses: marcelinojackson-org/Snowflake.CortexAI.AgentAction@v1
  id: employee-agent
  with:
    agent-name: 'EMPLOYEE_AGENT'
    message: 'employees who joined the company in the last 180 days'
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}
    AGENT_DATABASE: ${{ vars.AGENT_DATABASE }}
    AGENT_SCHEMA: ${{ vars.AGENT_SCHEMA }}
    AGENT_PERSIST_RESULTS: 'true'
    AGENT_PERSIST_DIR: ${{ runner.temp }}
```

Controlling tools and inspecting events:

```
- name: Multi-turn Cortex Agent conversation
  id: cortex-agent
  uses: marcelinojackson-org/Snowflake.CortexAI.AgentAction@v1
  with:
    agent-name: ${{ vars.AGENT_NAME }}
    messages: >
      [
        {
          "role": "user",
          "content": [
            {
              "type": "text",
              "text": "ROLE:MANAGER Summarize employees who joined in the last 180 days. Provide totals, top regions, and at most five sample employees."
            }
          ]
        }
      ]
    tool-choice: '{"type":"auto","name":["Employee_Details_With_Salary-Analyst","EMPLOYEE_DOCS-SEARCH"]}'
    persist-results: true
  env:
    SNOWFLAKE_ACCOUNT_URL: ${{ secrets.SNOWFLAKE_ACCOUNT_URL }}
    SNOWFLAKE_PAT: ${{ secrets.SNOWFLAKE_PAT }}
    AGENT_DATABASE: ${{ vars.AGENT_DATABASE }}
    AGENT_SCHEMA: ${{ vars.AGENT_SCHEMA }}
    AGENT_PERSIST_DIR: ${{ runner.temp }}

- name: Inspect agent outputs
  run: |
    echo "Answer text:"
    echo '${{ steps.cortex-agent.outputs.answer-text }}'
    echo 'Events:'
    echo '${{ steps.cortex-agent.outputs.events-json }}' | jq .
    echo "Response file path: ${{ steps.cortex-agent.outputs.result-file }}"
    jq . '${{ steps.cortex-agent.outputs.result-file }}'
```

I don’t trust “black box” AI in production, so having access to the full event stream is non-negotiable for me. This action makes that auditable trace a first-class citizen in the workflow.

## Security & permissions (DevSecOps view)

From a DevSecOps-GenAI perspective, there are a few guardrails I rely on:

- The calling Snowflake user has an appropriate Cortex-enabled role. I prefer using a dedicated automation/service identity rather than a human account.
- All Cortex objects (Search services, semantic models/views, Agents) are created and managed in Snowflake, with grants scoped to that role.
- The GitHub Actions here are just wrappers around those APIs—they don’t bypass Snowflake’s security model. If the role can’t see an object, the action can’t either.
- All secrets (`SNOWFLAKE_PASSWORD`, `SNOWFLAKE_PAT`, etc.) live in GitHub Secrets/Org secrets, never in the workflow YAML itself.
- Each workflow run is tied to a commit, which gives me a clear audit trail: who changed what, and when that changed the behavior of an AI-powered workflow.

That way, every AI call is tied back to a Snowflake role, a GitHub workflow run, and a specific commit, which makes both debugging and compliance conversations much easier.

## Troubleshooting & best practices

A few lessons learned while building and using these actions:

- Credentials & URLs:
  - Keep passwords/PATs in GitHub Secrets.
  - Double-check `SNOWFLAKE_ACCOUNT_URL`; small typos here cause most “can’t connect” errors.
- Permissions:
  - Make sure the Snowflake role can access warehouses, databases, schemas, search services, semantic models/views, and agents.
  - Verify that the Cortex role and grants cover all the objects your workflows touch.
- Result sizes:
  - Use `return-rows` conservatively for RunSQLAction.
  - Flip on `persist-results` when you need full result sets and store them as artifacts.
- Debugging Cortex:
  - For Analyst, log `generated-sql` while you’re iterating to build trust.
  - For Agents, use `events-json` and/or persisted JSON to see exactly which tools were called and how.
- Versioning:
  - Pin to version tags like `@v1` so your workflows don’t change unexpectedly as the actions evolve.

## Where to go next

If you’re already using Snowflake and GitHub Actions, you don’t need a new platform to start experimenting with Cortex AI.

Pick one small workflow and wire these in:

- A daily KPI summary that uses Snowflake.RunSQLAction + Snowflake.CortexAI.AnalystAction.
- A semantic data quality check on every PR using Snowflake.RunSQLAction + Snowflake.CortexAI.SearchAction.
- A Cortex Agent that reviews changes and leaves a comment on pull requests using Snowflake.CortexAI.AgentAction.

All four actions live under the `marcelinojackson-org` org on GitHub:

- https://github.com/marcelinojackson-org/Snowflake.RunSQLAction  
- https://github.com/marcelinojackson-org/Snowflake.CortexAI.SearchAction  
- https://github.com/marcelinojackson-org/Snowflake.CortexAI.AnalystAction  
- https://github.com/marcelinojackson-org/Snowflake.CortexAI.AgentAction  

If you try them, I’d genuinely love to see your workflows—open an issue, drop an example, or tell me what’s missing. That feedback is what’s driving the next set of features I’m building.

