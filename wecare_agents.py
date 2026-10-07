"""
WECARE Multi-Agent Orchestration Layer

Replaces the single monolithic LLM call in Phase II with a coordinated team
of specialized agents. Each agent has one job, its own system prompt, and
its own temperature. The Coordinator fans out to specialists in parallel so
total LLM latency is bounded by the slowest single agent, not by the sum.

Why multi-agent instead of one big prompt:

1. Specialization. The Bystander agent speaks plain English at a 6th-grade
   reading level because an untrained helper is panicking. The Paramedic
   agent speaks clinical shorthand because a responder needs density, not
   politeness. The Patient agent speaks calmly, in the second person,
   because the wearer is scared. One prompt cannot be good at all three.

2. Parallelism. ACTIVE and ESCALATING states need bystander + patient +
   paramedic output at the same time. Running them in parallel bounds
   wall-clock latency to one LLM round-trip instead of three.

3. Independent tuning. If the paramedic summary is too verbose, you lower
   that agent's max_tokens without touching the others.

4. Second check. The Triage agent re-examines the probabilities and either
   confirms or softens the automated severity classifier. This catches
   edge cases a hard threshold misses (e.g. a 0.86 fall probability during
   a known-noisy IMU window).

5. Easy to extend. Add a Family Notifier agent, a Hospital Pre-admission
   agent, a Translator agent — all without touching the FSM.

Usage:

    from wecare_agents import CoordinatorAgent, AgentContext

    coordinator = CoordinatorAgent(groq_api_key="...")
    ctx = AgentContext(
        event_type="fall_and_arrhythmia",
        severity="HIGH",
        fall_prob=0.97,
        arrhy_prob=0.98,
        bystander_nearby=True,
        bystander_distance_m=0.5,
        fsm_state="ACTIVE",
    )
    result = coordinator.dispatch(ctx)       # sync wrapper
    print(result["bystander"])               # instructions for untrained helper
    print(result["paramedic"])               # None at ACTIVE; populated at ESCALATING
    print(result["patient"])                 # calming instructions for the wearer
    print(result["triage"].confirmed)        # bool
    print(result["triage"].rationale)        # one-line reason
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field, asdict
from typing import Any, Awaitable, Callable


# ---------------------------------------------------------------------------
# Context passed between agents
# ---------------------------------------------------------------------------

@dataclass
class AgentContext:
    event_type: str                   # "fall_only" | "arrhythmia_only" | "fall_and_arrhythmia"
    severity: str                     # "LOW" | "MEDIUM" | "HIGH"
    fall_prob: float
    arrhy_prob: float
    bystander_nearby: bool
    bystander_distance_m: float
    fsm_state: str                    # "IDLE" | "PENDING" | "ACTIVE" | "ESCALATING" | "RESOLVED"
    extra: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> str:
        """Compact text summary all agents share as their primary input."""
        return (
            f"Event: {self.event_type}\n"
            f"Severity: {self.severity}\n"
            f"FSM state: {self.fsm_state}\n"
            f"Fall probability: {self.fall_prob:.3f}\n"
            f"Arrhythmia probability: {self.arrhy_prob:.3f}\n"
            f"Bystander nearby: {self.bystander_nearby} "
            f"(~{self.bystander_distance_m:.1f} m)"
        )


@dataclass
class TriageVerdict:
    confirmed: bool
    adjusted_severity: str            # may equal input severity, or softened
    rationale: str


# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

TRIAGE_PROMPT = """You are the WECARE Triage Agent, a clinical decision-support \
specialist that double-checks an automated severity classifier.

You are given the output of two 1-D CNNs (fall detector and arrhythmia \
detector) plus an automated severity label. Your job is to confirm or soften \
the label, not to escalate it beyond what the sensors show.

Rules:
- Dual-signal HIGH (fall and arrhythmia both >= 0.90) is always CONFIRMED.
- Arrhythmia alone >= 0.80 is CONFIRMED HIGH.
- Fall alone >= 0.85 confirms MEDIUM; between 0.65 and 0.85 confirms LOW.
- Any probability below 0.50 downgrades its contribution.
- Never upgrade a label — your role is a brake, not a throttle.

Respond in JSON only, no prose outside the JSON object:
{"confirmed": true|false, "adjusted_severity": "HIGH|MEDIUM|LOW|NONE", \
"rationale": "one short sentence"}
"""


BYSTANDER_PROMPT = """You are the WECARE Bystander Instructor Agent. The reader \
is an untrained adult who is physically present with a person in a medical \
emergency and is panicking.

Write at a 6th-grade reading level. Short sentences. No medical jargon. \
Numbered steps. Open with the single most important action. Close with \
one line of reassurance.

If this is a dual event (fall AND arrhythmia), prioritize cardiac response \
and include AED guidance. If fall-only, emphasize spinal precautions and \
not moving the patient. If arrhythmia-only, prioritize CPR readiness and \
calling for help.

Output exactly 5 numbered steps and one closing reassurance line. Nothing else.
"""


PARAMEDIC_PROMPT = """You are the WECARE Paramedic Handoff Agent. The reader \
is a dispatched EMT or paramedic en route to the scene.

Write in clinical shorthand. Dense, telegraphic, no hedging. Lead with the \
chief complaint, then vitals-equivalent (sensor probabilities), then scene \
context (bystander present or alone, estimated time elapsed since \
detection), then CPR status.

Format: four lines, each prefixed with a label in capitals.
CC: <chief complaint>
SENSORS: <probabilities>
SCENE: <bystander and distance>
STATUS: <bystander acting / unattended / unknown>

No greetings, no sign-off, no asterisks or markdown.
"""


PATIENT_PROMPT = """You are the WECARE Patient Reassurance Agent. The reader \
is the wearer of the device, who is scared, may be in pain, and is hearing \
your words through a bone-conduction speaker or watch.

Write in the second person. Calm, warm, direct. Keep each sentence under 10 \
words. Give the patient something to do with their body — breathe, press, \
stay still — because having a task reduces panic. Confirm that help is \
coming. Three sentences, no more.
"""


# ---------------------------------------------------------------------------
# Base agent
# ---------------------------------------------------------------------------

class WECAREAgent:
    """A single specialized LLM call wrapped as a named agent."""

    def __init__(
        self,
        name: str,
        system_prompt: str,
        client: Any,                              # Groq client (sync)
        model: str = "llama-3.3-70b-versatile",
        temperature: float = 0.1,
        max_tokens: int = 400,
    ):
        self.name          = name
        self.system_prompt = system_prompt
        self.client        = client
        self.model         = model
        self.temperature   = temperature
        self.max_tokens    = max_tokens

    def respond(self, ctx: AgentContext, extra: str = "") -> str:
        user_msg = ctx.summary() + (f"\n\n{extra}" if extra else "")
        resp = self.client.chat.completions.create(
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user",   "content": user_msg},
            ],
        )
        return resp.choices[0].message.content.strip()


# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------

class CoordinatorAgent:
    """Fans out to specialist agents based on FSM state. Runs them in parallel."""

    def __init__(self, groq_api_key: str | None = None, groq_client: Any = None):
        if groq_client is None:
            if groq_api_key is None:
                raise ValueError("Provide groq_api_key or an existing groq_client.")
            from groq import Groq
            groq_client = Groq(api_key=groq_api_key)
        self.client = groq_client

        self.triage    = WECAREAgent("triage",    TRIAGE_PROMPT,    self.client, temperature=0.0, max_tokens=120)
        self.bystander = WECAREAgent("bystander", BYSTANDER_PROMPT, self.client, temperature=0.2, max_tokens=350)
        self.paramedic = WECAREAgent("paramedic", PARAMEDIC_PROMPT, self.client, temperature=0.0, max_tokens=180)
        self.patient   = WECAREAgent("patient",   PATIENT_PROMPT,   self.client, temperature=0.3, max_tokens=100)

        # Simple sent-message log for inspection / debugging
        self.transcript: list[dict] = []

    # ------------------------- Routing policy -------------------------

    def _agents_for_state(self, state: str) -> list[WECAREAgent]:
        if state == "IDLE":        return []
        if state == "PENDING":     return [self.patient]
        if state == "ACTIVE":      return [self.bystander, self.patient]
        if state == "ESCALATING":  return [self.bystander, self.paramedic, self.patient]
        if state == "RESOLVED":    return []
        return []

    # ------------------------- Public entry point -------------------------

    def dispatch(self, ctx: AgentContext) -> dict[str, Any]:
        """Run triage first (gate), then fan out to actor agents in parallel."""
        t0 = time.time()
        verdict = self._run_triage(ctx)
        self._log("triage", verdict.rationale)

        if not verdict.confirmed:
            # Triage overrode the automated classifier — do not call specialists
            return {
                "triage":    verdict,
                "bystander": None,
                "paramedic": None,
                "patient":   None,
                "latency_s": round(time.time() - t0, 3),
            }

        # Use the triage-adjusted severity for the specialists
        downstream = AgentContext(**{**asdict(ctx), "severity": verdict.adjusted_severity})
        specialists = self._agents_for_state(downstream.fsm_state)

        results: dict[str, str | None] = {"bystander": None, "paramedic": None, "patient": None}

        if specialists:
            with ThreadPoolExecutor(max_workers=len(specialists)) as pool:
                futures = {pool.submit(a.respond, downstream): a.name for a in specialists}
                for fut in futures:
                    name = futures[fut]
                    try:
                        results[name] = fut.result(timeout=20)
                        self._log(name, results[name])
                    except Exception as e:
                        results[name] = f"[agent {name} failed: {e}]"
                        self._log(name, results[name])

        results["triage"]    = verdict
        results["latency_s"] = round(time.time() - t0, 3)
        return results

    # ------------------------- Internals -------------------------

    def _run_triage(self, ctx: AgentContext) -> TriageVerdict:
        raw = self.triage.respond(ctx)
        try:
            # Model may wrap JSON in prose despite the instruction — extract it
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            data = json.loads(m.group(0)) if m else json.loads(raw)
            return TriageVerdict(
                confirmed         = bool(data.get("confirmed", True)),
                adjusted_severity = str(data.get("adjusted_severity", ctx.severity)),
                rationale         = str(data.get("rationale", "")).strip(),
            )
        except Exception:
            # Fall back to the automated classifier's decision
            return TriageVerdict(
                confirmed=True, adjusted_severity=ctx.severity,
                rationale=f"[triage parse failed, defaulting to {ctx.severity}]",
            )

    def _log(self, agent: str, content: Any) -> None:
        self.transcript.append({"agent": agent, "content": content, "t": time.time()})


# ---------------------------------------------------------------------------
# Quick self-test (runs offline with a mock client if groq is not available)
# ---------------------------------------------------------------------------

def _mock_client_fixture():
    """Return a fake Groq-shaped client that echoes canned responses.

    Useful for unit tests and for CI runs with no network access.
    """
    class _Msg:        pass
    class _Choice:     pass
    class _Resp:       pass
    class _Completions:
        def create(self, model, temperature, max_tokens, messages):
            system = messages[0]["content"]
            if "Triage Agent" in system:
                content = ('{"confirmed": true, "adjusted_severity": "HIGH", '
                           '"rationale": "fall 0.97 and arrhy 0.98 both exceed 0.90"}')
            elif "Bystander Instructor" in system:
                content = ("1. Call 911 now and put the phone on speaker.\n"
                           "2. Tilt the head back and lift the chin to open the airway.\n"
                           "3. Start CPR: 30 chest compressions, then 2 rescue breaths.\n"
                           "4. Use an AED if one is nearby — follow its voice prompts.\n"
                           "5. Keep going until help arrives.\nHelp is on the way.")
            elif "Paramedic Handoff" in system:
                content = ("CC: suspected syncope with cardiac event\n"
                           "SENSORS: fall 0.97, arrhy 0.98\n"
                           "SCENE: bystander present, 0.5 m\n"
                           "STATUS: bystander acting")
            else:
                content = ("Help is coming. Breathe slowly through your nose. "
                           "Try to stay as still as you can.")
            msg          = _Msg();    msg.content = content
            choice       = _Choice(); choice.message = msg
            resp         = _Resp();   resp.choices = [choice]
            return resp
    class _Chat:
        completions = _Completions()
    class _Client:
        chat = _Chat()
    return _Client()


def _selftest() -> None:
    client = _mock_client_fixture()
    coord  = CoordinatorAgent(groq_client=client)

    ctx = AgentContext(
        event_type="fall_and_arrhythmia",
        severity="HIGH",
        fall_prob=0.97,
        arrhy_prob=0.98,
        bystander_nearby=True,
        bystander_distance_m=0.5,
        fsm_state="ESCALATING",
    )
    out = coord.dispatch(ctx)
    print("=== Triage ===");    print(out["triage"].rationale)
    print("\n=== Bystander ==="); print(out["bystander"])
    print("\n=== Paramedic ==="); print(out["paramedic"])
    print("\n=== Patient ==="); print(out["patient"])
    print(f"\nLatency: {out['latency_s']}s · Agents invoked: {len(coord.transcript)}")

    assert out["triage"].confirmed
    assert out["bystander"] and "CPR" in out["bystander"]
    assert out["paramedic"] and out["paramedic"].startswith("CC:")
    assert out["patient"] and "Breathe" in out["patient"]
    print("\nSelf-test passed.")


if __name__ == "__main__":
    _selftest()
