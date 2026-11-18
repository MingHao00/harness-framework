---
name: test-coverage
description: Add tests for under-covered code using this repository's own test commands. Invoke only when the user asks. Use an 80% report only when one already exists.
disable-model-invocation: true
---

# Test Coverage

Analyze gaps and add the missing tests. Use the test command this repository already runs. The npm steps below are only for a repository that already has that coverage report. Do not install npm, coverage.py, or pytest-cov to fill the gap.

## When a coverage report already exists

1. Run this repository's coverage command. For an npm project that already uses it, that is `npm test --coverage` or `pnpm test --coverage`.

2. Analyze `coverage/coverage-summary.json` when that file is what the command writes.

3. Identify files below the 80% threshold.

4. For each under-covered file:
   - Analyze untested code paths
   - Generate unit tests for functions
   - Generate integration tests for APIs
   - Generate E2E tests for critical flows

5. Verify new tests pass

6. Show before/after coverage metrics

7. Ensure project reaches 80%+ overall coverage

Focus on:
- Happy path scenarios
- Error handling
- Edge cases (null, undefined, empty)
- Boundary conditions
