# AGENTS.md

## Project goal
Build a Braze localization assistant with:
1. browser extension overlay
2. backend API
3. Liquid tag insertion engine
4. translation pipeline
5. automated tests and evals

## Tech stack
- TypeScript everywhere
- Chrome extension with Plasmo or vanilla MV3
- Node.js backend with Fastify
- Shared zod schemas
- Vitest for unit tests
- Playwright for browser tests

## Architecture rules
- Keep browser code thin
- Put business logic in backend or shared packages
- No direct LLM output may be written into Braze without validation
- Preserve existing Braze Liquid exactly
- All transforms must be reversible or diffable

## Workflow rules
- Propose a plan before large edits
- Make small commits
- Run tests after changes
- Do not introduce new dependencies without justification

## Definition of done
- Code compiles
- Tests pass
- Changed behavior is covered by tests
- Docs updated for any public interface

## MVP scope
Build only the first vertical slice:
1. parse a message sample
2. identify translatable text
3. insert Braze translation tags safely
4. extract translation entries
5. validate output with tests

Do not build full UI or real Braze API integration yet.

## Commands
- Install: pnpm install
- Build: pnpm build
- Test: pnpm test

## Coding rules
- Prefer small pure functions
- Prefer explicit types
- Avoid hidden magic in regex-only transforms
- Put parsing and transformation logic in packages/liquid-engine
- Keep extension code limited to capture and display
- Keep backend code limited to orchestration and API calls

## Safety rules
- Never rewrite existing Liquid syntax
- Fail closed on ambiguous content
- Return structured validation errors instead of guessing

## Output expectations
When completing a task:
1. explain the plan briefly
2. implement only the requested scope
3. run tests
4. summarize changed files
5. list open risks