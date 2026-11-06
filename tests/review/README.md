# Independent review reproductions

These four original scripts preserve the non-regenerable evidence procedures from the independent review of commit `70ff264`. They are historical investigation artifacts, not current passing tests: some assert the former defect, use the review machine's absolute paths, or call the former synchronous export API. Do not run them against the current branch as a validation suite.

Maintained regressions are in `../core.test.ts` (late corrections and partial estimates), `../adapters.test.ts` (missing usage and synthetic-only admission), `../report.test.ts` (200,000-row export concurrency and snapshot consistency), and `../smoke/runtime.test.ts` (native retries, missing usage, output caps, single provider attempt and Bun worker exports). Original generated evidence remains in the approved temporary directory; databases, provider request captures and profiles are intentionally not committed.
