# Multi-Agent Orchestration (Phase III)

Phase II used a single LLM call that tried to be all things to all
actors: calming the patient, instructing the bystander, briefing the
paramedic, all in one prompt. That is fine for a prototype but is a
weak match for the paper's "multi-actor coordination" claim. Phase III
replaces that call with a team of specialist agents coordinated by a
router.

## Why a team instead of one prompt

| Concern | Single prompt | Multi-agent |
|---------|---------------|-------------|
| Reading level | Compromise between layman and clinician | Each agent speaks its reader's language |
| Latency | Serial (one long completion) | Parallel (bounded by slowest single agent) |
| Tuning | Change prompt → affects all actors | Change one agent → others unaffected |
| Safety | One prompt controls both the override and the response | Triage agent is a dedicated brake, separate from action agents |
| Extensibility | Prompt grows unmanageable | Add a new agent, update one line of routing |

## The team

```
                 ┌─────────────────────────────┐
                 │   DETECTION (unchanged)      │
                 │ IMU CNN + ECG CNN → probs    │
                 └──────────────┬───────────────┘
                                ▼
                 ┌─────────────────────────────┐
                 │     COORDINATOR AGENT        │
                 │  state machine routes       │
                 │  requests to specialists    │
                 └──┬───────────────────┬──────┘
                    ▼                   ▼
         ┌──────────────────┐   (parallel fan-out)
         │  TRIAGE AGENT    │        │
         │  gate — confirms │        ▼
         │  or softens      │   ┌──────────────┬──────────────┬──────────────┐
         │  severity        │   │ BYSTANDER    │ PARAMEDIC    │ PATIENT      │
         └──────────────────┘   │ INSTRUCTOR   │ HANDOFF      │ REASSURANCE  │
                                │  6th-grade   │  clinical    │  2nd person  │
                                │  5 steps     │  shorthand   │  <10 words/s │
                                │  layman      │  dense       │  calm        │
                                └──────────────┴──────────────┴──────────────┘
```

### Triage Agent (gate)

Runs first and alone. Re-reads the fall and arrhythmia probabilities
and the automated severity label; returns a JSON verdict `{confirmed,
adjusted_severity, rationale}`. The agent is prompted to only ever
*lower* severity — never raise it beyond what the sensors show. This is
a brake, not a throttle. If it refuses to confirm, no specialist
agents are invoked and the FSM holds its position.

Temperature: 0.0 · Max tokens: 120.

### Bystander Instructor Agent

For an untrained person physically present. 6th-grade reading level,
numbered steps, one closing reassurance line. Branches internally on
event type (dual signal → prioritize cardiac, fall-only → spinal
precautions, arrhythmia-only → CPR readiness).

Temperature: 0.2 · Max tokens: 350.

### Paramedic Handoff Agent

For a dispatched responder en route. Clinical shorthand with a fixed
four-line schema (`CC`, `SENSORS`, `SCENE`, `STATUS`). No greetings,
no hedging, no markdown.

Temperature: 0.0 · Max tokens: 180.

### Patient Reassurance Agent

For the wearer, heard through bone-conduction or watch audio. Second
person, warm tone, three sentences, each under 10 words. Always gives
the patient something to do with their body (breathe, press, stay
still) because having a task reduces panic.

Temperature: 0.3 · Max tokens: 100.

### Coordinator Agent

Not an LLM call — a Python class that owns the routing policy:

| FSM state | Agents invoked |
|-----------|----------------|
| IDLE | none |
| PENDING | Patient |
| ACTIVE | Bystander, Patient (parallel) |
| ESCALATING | Bystander, Paramedic, Patient (parallel) |
| RESOLVED | none |

Triage always runs first and gates whether the specialists run at all.
Specialists run in a `ThreadPoolExecutor` so wall-clock latency is
bounded by the slowest of the three, not their sum.

## Latency budget

**Not yet measured.** The self-test uses a mock client, so no real LLM
latency has been recorded. Expected behavior from the design:

- Triage runs first and alone (one round-trip).
- At ESCALATING the three specialists run in parallel, so their combined
  time is roughly the slowest single call rather than the sum of the three.

To get real numbers, run `CoordinatorAgent(groq_api_key=...).dispatch(ctx)`
on the real Groq client and compare `result["latency_s"]` against the
Phase II single-prompt call over the same scenarios (e.g. 20 runs each,
report mean and p95). Replace this section with those results.

## Observability

`CoordinatorAgent.transcript` records every agent call with timestamp
and content. Expose it as a log tab in the dashboard so the paper can
show a per-event trace.

## File layout

```
wecare_agents.py                   # Agents + Coordinator + self-test
docs/MULTI_AGENT_ARCHITECTURE.md   # This document
WECARE_Orchestration_Updated.ipynb # Replaces its `generate_instructions`
                                   # call with coord.dispatch(ctx)
```

## Migration from Phase II

Replace this in the orchestration notebook:

```python
instructions = generate_instructions(
    event_type, severity,
    bystander_nearby=ble_result["bystander_nearby"],
    fall_prob=fall_result["fall_prob"],
    arrhy_prob=ecg_result["arrhythmia_prob"],
)
```

With:

```python
from wecare_agents import CoordinatorAgent, AgentContext

coord = CoordinatorAgent(groq_api_key=os.environ["GROQ_API_KEY"])
ctx = AgentContext(
    event_type=event_type,
    severity=severity,
    fall_prob=fall_result["fall_prob"],
    arrhy_prob=ecg_result["arrhythmia_prob"],
    bystander_nearby=ble_result["bystander_nearby"],
    bystander_distance_m=ble_result["est_distance_m"],
    fsm_state=engine.state.name,
)
result = coord.dispatch(ctx)
instructions = result["bystander"]        # for the ntfy bystander topic
clinical     = result["paramedic"]        # for the paramedic topic (ESCALATING)
patient_msg  = result["patient"]          # for the wearer's audio channel
```

## Running the self-test

```bash
python3 wecare_agents.py
```

Runs end-to-end against a mock client that needs no network and no API
key. Prints every agent's output and asserts shape. The real Groq
client is used when a `groq_api_key` is passed to `CoordinatorAgent`.
