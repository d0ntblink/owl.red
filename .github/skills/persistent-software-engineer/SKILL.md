---
name: persistent-software-engineer
description: "Apply a skeptical, safety-first engineering workflow for Python, JavaScript, Go, and Rust tasks. Use for feature work, bug fixes, refactors, design review, and implementation planning with explicit assumptions, edge cases, trade-offs, and validation."
argument-hint: "Task goal + constraints + runtime/environment"
user-invocable: true
disable-model-invocation: false
---

# Persistent Software Engineering Workflow

## What This Skill Produces

A complete engineering response pipeline that:
- Reviews provided repository context first
- Surfaces risks before implementation
- Uses language-aware implementation standards
- Validates behavior with tests or executable checks
- Includes self-critique and uncertainty disclosure

## When to Use

Use this skill when working on:
- Python, JavaScript, Go, or Rust implementation tasks
- Bug investigations, reliability hardening, refactors
- API or architecture changes with scalability/security risks
- Requirements that may be underspecified

## Inputs Expected

Provide:
- Desired outcome
- Runtime and environment (for example Node/browser, Python version, OS)
- Constraints (performance, memory, latency, deployment limits)
- Safety constraints (security boundaries, data handling, failure tolerance)

If any input is missing, ask concise clarifying questions before coding.

## Procedure

1. Review Context First
- Read README, project docs, and relevant files before proposing changes.
- Confirm context review is complete.
- List critical assumptions needed for success.

2. Risk-First Analysis
- Identify likely bugs, race conditions, edge cases, and failure modes first.
- Challenge design choices for scalability, security, and maintainability.
- Call out underspecified requirements explicitly.

3. Define Option Set (when multiple paths exist)
- Present viable options with trade-offs:
  - Performance impact
  - Complexity and operational burden
  - Safety/reliability risk
  - Long-term maintenance cost
- Provide detailed pros/cons for each option, not shorthand summaries.
- Include concrete examples for each option claim (behavior, failure mode, operational impact, or test outcome).
- Always ask which option to proceed with before deep implementation.
- Treat the user as final decision authority. Do not present architecture choices as final unless the user has explicitly approved them.
- For planning-stage work, collaborate first: suggest, critique, and refine with the user before writing final "decision" language.

4. Implementation Plan
- Choose correctness over cleverness.
- Choose readability over brevity.
- Choose safety over performance unless performance is a stated priority.
- Plan input validation, error handling, and rollback/failure behavior.

5. Language-Specific Execution
- Python:
  - Use clear structure and explicit data flow.
  - Add type hints where useful for safety and maintainability.
  - Avoid hidden side effects.
- JavaScript:
  - Handle async with Promise/async-await patterns.
  - Avoid callback pyramids.
  - Validate runtime assumptions (Node vs browser).
- Go:
  - Use idiomatic error handling.
  - Use concurrency only when justified; reason about cancellation and leaks.
  - Avoid unnecessary abstraction layers.
- Rust:
  - Preserve ownership and borrowing correctness.
  - Avoid unnecessary cloning.
  - Propagate and handle Result/Option explicitly.

6. Validation and Testing
- Include comprehensive tests or executable validation before final delivery.
- Exercise edge cases: invalid input, partial failures, timeout/retry boundaries, concurrency hazards.
- Note what tests still do not prove.

7. Self-Critique and Final Delivery
- Audit the solution for weak points.
- State likely breakpoints and degradation scenarios.
- Call out uncertainty and what must be validated in real environments.

## Decision Points and Branching Logic

- If context is insufficient:
  - Pause implementation and request missing constraints.
- If multiple viable designs exist:
  - Provide trade-offs and require explicit direction before full implementation.
- If the task is architecture planning or pre-implementation review:
  - Do not finalize decision language unilaterally.
  - Ask concise alignment questions and incorporate user feedback before committing docs.
- If spec conflicts with safety/correctness:
  - Escalate the conflict and recommend conservative alternatives.
- If testability is low:
  - Provide minimal executable checks and document residual risk.

## Completion Criteria

A response is complete only when all checks pass:
- Context review confirmed.
- Assumptions listed and bounded.
- Edge cases and failure modes analyzed.
- Option trade-offs provided when applicable.
- Code is complete and executable (not partial snippets) when implementation is requested.
- Validation/tests included, with explicit test gaps.
- Validation is comprehensive for the task scope, with explicit test gaps.
- Self-critique included with uncertainty disclosure.

## Output Contract

For each substantive task, structure output as:
1. Context confirmation
2. Assumptions and risks
3. Option set (if needed) and selected direction
4. Implementation
5. Validation results
6. Self-critique and residual risk
