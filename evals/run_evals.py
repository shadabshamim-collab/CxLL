#!/usr/bin/env python3
"""
CxLL Voice Agent Evaluation Runner

Simulates conversations with different customer personas, then scores them
using a judge LLM. Outputs detailed results to evals/results/.

Usage:
    cd evals
    python run_evals.py                          # Run all personas
    python run_evals.py --persona cooperative_payer  # Run single persona
    python run_evals.py --campaign ../agent/campaigns/collection-reminder-test.json
    python run_evals.py --verbose                # Print full transcripts
"""

import os
import sys
import json
import asyncio
import argparse
import time
from datetime import datetime
from pathlib import Path

# Add parent dir so we can import agent config
sys.path.insert(0, str(Path(__file__).parent.parent / "agent"))

from personas import PERSONAS
from simulator import simulate_conversation
from judge import judge_conversation


def load_agent_prompt(campaign_path: str = None) -> tuple[str, str]:
    """Load system prompt and greeting from campaign JSON or config.py."""
    if campaign_path and os.path.exists(campaign_path):
        with open(campaign_path) as f:
            campaign = json.load(f)
        return (
            campaign.get("system_prompt", ""),
            campaign.get("initial_greeting", "The user has picked up the call. Greet them."),
        )

    try:
        import config
        return config.SYSTEM_PROMPT, config.INITIAL_GREETING
    except ImportError:
        print("Error: Could not load agent/config.py. Use --campaign flag instead.")
        sys.exit(1)


def print_transcript(transcript: list[dict]):
    """Pretty-print a conversation transcript."""
    for msg in transcript:
        speaker = "AGENT   " if msg["role"] == "assistant" else "CUSTOMER"
        print(f"  {speaker}: {msg['content']}")
    print()


def print_scores(result: dict, persona_name: str):
    """Pretty-print judge scores."""
    if "error" in result:
        print(f"  JUDGE ERROR: {result['error']}")
        return

    scores = result.get("scores", {})
    total = result.get("total_score", 0)
    max_score = result.get("max_score", 100)
    passed = result.get("pass", False)

    status = "PASS" if passed else "FAIL"
    bar = "=" * (total // 2) + "-" * ((max_score - total) // 2)

    print(f"  [{status}] {persona_name}: {total}/{max_score} [{bar}]")
    print()

    for criterion, data in scores.items():
        score = data.get("score", 0)
        reason = data.get("reason", "")
        indicator = "+" if score >= 7 else "~" if score >= 5 else "X"
        name = criterion.replace("_", " ").title()
        print(f"    {indicator} {name}: {score}/10 — {reason}")

    critical = result.get("critical_failures", [])
    if critical:
        print()
        print(f"  CRITICAL FAILURES:")
        for f in critical:
            print(f"    ! {f}")

    print()
    print(f"  Summary: {result.get('summary', 'N/A')}")


async def run_single_eval(
    persona: dict,
    system_prompt: str,
    greeting: str,
    api_key: str,
    base_url: str,
    agent_model: str,
    customer_model: str,
    judge_model: str,
    verbose: bool = False,
) -> dict:
    """Run simulation + judgment for a single persona."""
    start = time.time()

    # Simulate
    transcript = await simulate_conversation(
        agent_system_prompt=system_prompt,
        agent_greeting=greeting,
        persona=persona,
        api_key=api_key,
        base_url=base_url,
        agent_model=agent_model,
        customer_model=customer_model,
    )

    sim_time = time.time() - start

    # Judge
    judge_start = time.time()
    result = await judge_conversation(
        system_prompt=system_prompt,
        transcript=transcript,
        persona=persona,
        api_key=api_key,
        base_url=base_url,
        model=judge_model,
    )
    judge_time = time.time() - judge_start

    return {
        "persona": persona["name"],
        "description": persona["description"],
        "transcript": transcript,
        "turns": len(transcript),
        "judgment": result,
        "timing": {
            "simulation_seconds": round(sim_time, 1),
            "judgment_seconds": round(judge_time, 1),
            "total_seconds": round(sim_time + judge_time, 1),
        },
    }


async def main():
    parser = argparse.ArgumentParser(description="CxLL Voice Agent Evals")
    parser.add_argument("--persona", type=str, help="Run a single persona by name")
    parser.add_argument("--campaign", type=str, help="Path to campaign JSON file")
    parser.add_argument("--verbose", action="store_true", help="Print full transcripts")
    parser.add_argument("--agent-model", type=str, default="llama-3.3-70b-versatile")
    parser.add_argument("--customer-model", type=str, default="llama-3.1-8b-instant")
    parser.add_argument("--judge-model", type=str, default="llama-3.3-70b-versatile")
    parser.add_argument("--output", type=str, default="results", help="Output directory")
    args = parser.parse_args()

    # API config
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        api_key = os.getenv("OPENAI_API_KEY")
        base_url = "https://api.openai.com/v1"
        if not api_key:
            print("Error: Set GROQ_API_KEY or OPENAI_API_KEY environment variable")
            sys.exit(1)
    else:
        base_url = "https://api.groq.com/openai/v1"

    # Load prompt
    system_prompt, greeting = load_agent_prompt(args.campaign)
    prompt_source = args.campaign or "agent/config.py"

    # Select personas
    if args.persona:
        personas = [p for p in PERSONAS if p["name"] == args.persona]
        if not personas:
            print(f"Error: Persona '{args.persona}' not found.")
            print(f"Available: {', '.join(p['name'] for p in PERSONAS)}")
            sys.exit(1)
    else:
        personas = PERSONAS

    # Header
    print()
    print("=" * 70)
    print("  CxLL VOICE AGENT EVALUATION")
    print("=" * 70)
    print(f"  Prompt source : {prompt_source}")
    print(f"  Agent model   : {args.agent_model}")
    print(f"  Customer model: {args.customer_model}")
    print(f"  Judge model   : {args.judge_model}")
    print(f"  Personas      : {len(personas)}")
    print(f"  API           : {base_url}")
    print("=" * 70)
    print()

    # Run evals
    all_results = []
    total_score = 0
    total_max = 0
    pass_count = 0
    fail_count = 0

    for i, persona in enumerate(personas, 1):
        print(f"[{i}/{len(personas)}] Simulating: {persona['name']}")
        print(f"  → {persona['description']}")

        try:
            result = await run_single_eval(
                persona=persona,
                system_prompt=system_prompt,
                greeting=greeting,
                api_key=api_key,
                base_url=base_url,
                agent_model=args.agent_model,
                customer_model=args.customer_model,
                judge_model=args.judge_model,
                verbose=args.verbose,
            )

            if args.verbose:
                print()
                print("  --- Transcript ---")
                print_transcript(result["transcript"])

            judgment = result.get("judgment", {})
            if "error" not in judgment:
                score = judgment.get("total_score", 0)
                passed = judgment.get("pass", False)
                total_score += score
                total_max += 100
                if passed:
                    pass_count += 1
                else:
                    fail_count += 1

            print()
            print_scores(judgment, persona["name"])
            print(f"  Timing: {result['timing']['total_seconds']}s "
                  f"(sim: {result['timing']['simulation_seconds']}s, "
                  f"judge: {result['timing']['judgment_seconds']}s)")
            print("-" * 70)
            print()

            all_results.append(result)

        except Exception as e:
            print(f"  ERROR: {e}")
            all_results.append({
                "persona": persona["name"],
                "error": str(e),
            })
            fail_count += 1
            print("-" * 70)
            print()

        # Rate limit buffer between evals (Groq: 30 req/min on 70b)
        if i < len(personas):
            await asyncio.sleep(2)

    # Summary
    print("=" * 70)
    print("  EVAL SUMMARY")
    print("=" * 70)
    print(f"  Total personas : {len(personas)}")
    print(f"  Passed         : {pass_count}")
    print(f"  Failed         : {fail_count}")
    if total_max > 0:
        avg = round(total_score / len([r for r in all_results if "error" not in r.get("judgment", {})]))
        print(f"  Average score  : {avg}/100")
    print()

    # Per-criteria averages
    criteria_totals = {}
    criteria_counts = {}
    for r in all_results:
        scores = r.get("judgment", {}).get("scores", {})
        for criterion, data in scores.items():
            s = data.get("score", 0)
            criteria_totals[criterion] = criteria_totals.get(criterion, 0) + s
            criteria_counts[criterion] = criteria_counts.get(criterion, 0) + 1

    if criteria_totals:
        print("  Per-Criteria Averages:")
        for criterion in criteria_totals:
            avg = round(criteria_totals[criterion] / criteria_counts[criterion], 1)
            name = criterion.replace("_", " ").title()
            bar = "#" * int(avg) + "." * (10 - int(avg))
            print(f"    {name:.<30} {avg}/10  [{bar}]")
        print()

    # Collect all critical failures
    all_critical = []
    for r in all_results:
        for f in r.get("judgment", {}).get("critical_failures", []):
            all_critical.append(f"{r['persona']}: {f}")
    if all_critical:
        print("  CRITICAL FAILURES ACROSS ALL EVALS:")
        for f in all_critical:
            print(f"    ! {f}")
        print()

    print("=" * 70)

    # Save results
    output_dir = Path(__file__).parent / args.output
    output_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"eval_{timestamp}.json"

    report = {
        "timestamp": datetime.now().isoformat(),
        "config": {
            "prompt_source": prompt_source,
            "agent_model": args.agent_model,
            "customer_model": args.customer_model,
            "judge_model": args.judge_model,
        },
        "summary": {
            "total_personas": len(personas),
            "passed": pass_count,
            "failed": fail_count,
            "average_score": round(total_score / max(len(all_results), 1)),
            "criteria_averages": {
                k: round(v / criteria_counts[k], 1)
                for k, v in criteria_totals.items()
            },
            "critical_failures": all_critical,
        },
        "results": all_results,
    }

    with open(output_file, "w") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    print(f"\n  Results saved to: {output_file}")

    # Exit code: non-zero if any failed
    sys.exit(1 if fail_count > 0 else 0)


if __name__ == "__main__":
    asyncio.run(main())
