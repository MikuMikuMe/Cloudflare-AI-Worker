# Repository instructions

## Test-driven development

- For every bug fix or behavior change, first add or update a focused regression test and run it to confirm that it fails for the expected reason.
- Only then modify production code. Re-run the focused regression, followed by the full test suite and typecheck.
- Do not weaken, remove, or bypass assertions merely to make a change pass.
