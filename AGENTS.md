# AGENTS

Guidance for contributors and automation agents working on Archi.

## Principles

- Local-first: local SQLite is source of truth.
- Idempotent sync: duplicates must never be introduced.
- Graceful degradation: failed source jobs should be recoverable and visible.
- Source honesty: cloud notebook support is best-effort.

## Contribution guidelines

- Keep parsing logic fixture-driven and tested.
- Keep destination mappers deterministic and reversible.
- Avoid adding remote data stores or server dependencies.
- Document schema and migration changes in `docs/schema.md`.
