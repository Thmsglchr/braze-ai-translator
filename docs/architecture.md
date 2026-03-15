# Architecture

## Goal
Build a Braze localization assistant that:
1. captures message content from Braze
2. inserts Braze Liquid translation tags safely
3. extracts translation entries
4. sends them to a translation pipeline
5. pushes translations back through Braze APIs

## MVP
The MVP only implements:
1. content parsing from local fixtures
2. Liquid-safe translation tag insertion
3. extraction of translation entries
4. unit tests

## Current Scaffold
- `apps/extension`: placeholder TypeScript package for the future browser overlay
- `apps/backend`: placeholder TypeScript package for future orchestration
- `packages/schemas`: shared result and validation types
- `packages/liquid-engine`: initial Liquid inspection entry point with smoke tests
- `packages/csv-utils`: shared CSV escaping helper
- `tests/fixtures`: local sample Liquid content
- `tests/evals`: reserved regression cases

## Workspace
- `pnpm` workspaces at the repository root
- shared TypeScript base config
- root `build` and `test` scripts for the monorepo

## Packages
- apps/extension: future browser overlay
- apps/backend: future orchestration API
- packages/schemas: shared request and response types
- packages/liquid-engine: parsing, transform, validation
- packages/csv-utils: CSV helpers
- tests/fixtures: sample Braze content
- tests/evals: regression cases

## Non-negotiables
- existing Liquid must be preserved exactly
- ambiguous content must fail safely
- every transform must be auditable
- no raw LLM output is trusted without validation
