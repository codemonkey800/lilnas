# tdr-bot

Bot for the bois

<p align="center">
  <img width="400" src="https://i.guim.co.uk/img/media/327e46c3ab049358fad80575146be9e0e65686e7/0_56_1023_614/master/1023.jpg?width=1200&quality=85&auto=format&fit=max&s=4592a7be8bdbebd0e0b97e5e10a6c433">
</p>

## LLM service

Every model call goes through `src/llm/`. Nothing outside `src/llm/providers/`
builds a `ChatOpenAI` or `DallEAPIWrapper`.

### Layout

| Path                     | Role                                                                    |
| ------------------------ | ----------------------------------------------------------------------- |
| `src/llm/client/`        | `LlmClient`: retries, timeouts, usage, cost, metrics, audit row         |
| `src/llm/models/`        | `catalog.ts` (model specs, pricing), `roles.ts`, `model-registry.ts`    |
| `src/llm/settings/`      | Runtime settings (zod schema, Postgres-backed service)                  |
| `src/llm/providers/`     | OpenAI provider, the only place SDK models are constructed              |
| `src/llm/conversation/`  | Token-budget trimming and Discord display-name sanitising               |
| `src/llm/graph/`         | LangGraph state, router/skill/finalize graph, checkpointer              |
| `src/llm/skills/`        | One folder per skill, plus `skill.interface.ts` and `skill.registry.ts` |
| `src/llm/observability/` | Request context (`AsyncLocalStorage`) and Prometheus metrics            |
| `src/llm/audit/`         | `llm_calls` repository                                                  |
| `src/llm/testing/`       | `fake-llm-client.ts`, golden cases, live tests                          |

### Message flow

1. `src/messages/messages.service.ts` receives a Discord message and wraps the
   rest of the work in `runWithRequestContext` (request id, channel, user).
2. `src/messages/llm/llm-orchestration.service.ts` invokes the graph from
   `src/llm/graph/build-graph.ts`, with one thread per channel
   (`thread-id.ts`). The checkpointer stores the conversation in Postgres.
3. `router` picks a skill: a pending follow-up first, then a skill's
   `match()` fast path, then an LLM call over the skills' `description`s.
4. `runSkill` runs the chosen skill. A skill can set `followUp` (the next
   message in the channel returns to it) or `reroute` (decline the message;
   the graph goes back to `router`).
5. `finalize` checks the skill ended with a non-empty AI message and the graph
   ends. The reply, and any images, go back to Discord.

Skills call models only through the `LlmClient` in their `SkillContext`, so
every call is retried, metered and audited the same way.

### Adding a skill

1. Create `src/llm/skills/<id>/` with `skill.ts` (an `@Injectable()` class
   implementing `Skill` from `skill.interface.ts`) and `prompts.ts`. Copy
   `src/llm/skills/chat/` as a starting point.
2. Register the class in `SKILL_CLASSES` in `src/llm/skills/skills.module.ts`;
   it is collected under the `SKILLS` token. Duplicate ids throw at boot.
3. Add the id to `RouterSkill` and `ROUTER_SKILLS` and at least six cases to
   `ROUTER_CASES` in `src/llm/testing/golden/router-cases.ts`
   (`fixtures.test.ts` enforces the minimum). Add multi-turn cases to
   `scenarios.ts` if it uses follow-ups.
4. Write a unit test using `FakeLlmClient` from `src/llm/testing/`.

### Settings and models

- `src/llm/settings/settings.schema.ts` defines the settings: a model per
  role (`chat`, `reasoning`, `image`), `temperature`, `reasoningEffort` and
  `systemPrompt`. They are edited on the web Settings page (or the settings
  API) and apply to the next call, including in existing channels.
- `src/llm/models/catalog.ts` lists every selectable model with its
  capabilities (tools, structured output, temperature, reasoning effort,
  vision, image) and pricing per 1M tokens. Settings only accept catalog ids
  whose `roles` include the role. To add a model, add a `ModelSpec` there.
  Pricing drives the cost metric and the `cost_usd` column.

### Audit log: `llm_calls`

`src/llm/audit/llm-calls.repository.ts` writes one row per LLM call to the
`llm_calls` table (`src/db/schema.ts`): request, channel, user, skill,
operation, model, role, status, tokens, cost, duration, retries, finish
reason and a prompt hash. The `prompt` and `output` columns stay empty unless
`LLM_AUDIT_CONTENT=true`, since they hold user messages. The transcript page
(`src/app/transcript/`) reads these rows through `src/api/transcript.controller.ts`.

### Metrics and Grafana

`src/llm/observability/llm-metrics.service.ts` exports, at `/metrics`:
`tdr_bot_llm_calls_total`, `tdr_bot_llm_call_duration_seconds`,
`tdr_bot_llm_tokens_by_model_total`, `tdr_bot_llm_cost_usd_total`,
`tdr_bot_llm_retries_total`, `tdr_bot_llm_inflight`,
`tdr_bot_llm_schema_failures_total` and `tdr_bot_router_decisions_total`.

The dashboard is
`infra/monitoring/grafana/provisioning/dashboards/json/tdr-bot.json`. LLM
rows: **LLM Performance**, **LLM Calls**, **Tokens and Cost**, **Resilience**
(retries) and **Router** (decisions by skill and source).

### Running without Postgres

`GRAPH_CHECKPOINTER=memory` swaps the Postgres checkpointer for an in-memory
one (`src/llm/graph/checkpointer.ts`). `pnpm dev:graph-test` sets it by
default (`src/main.ts`). Conversations are lost on restart.

### Tests

- `pnpm test` runs the unit and integration tests with `FakeLlmClient`.
  No network, no API key.
- `pnpm test:live` runs `*.live.test.ts` against the real OpenAI API (router
  accuracy over the golden cases, structured-output schemas). It needs
  `LIVE_LLM=1` and `OPENAI_API_KEY` (see `.env.example`); without them the
  files skip. A run fails if it spends more than `MAX_RUN_COST_USD`
  ($0.50, in `src/llm/testing/live/live-env.ts`).
