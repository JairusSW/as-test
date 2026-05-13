# TODO

## QoL

- Add `--repro` / `--last-failed` support to rerun the most recent failing file/mode combination from crash or log metadata.
- Print one short “next step” line after failures with the exact `ast run ... --mode ...` repro command.
- Improve multi-mode failure deduping so identical build errors across modes collapse into one clearer report.
- Add `ast test --changed` to run only files changed relative to git.
- Make failure command blocks (`Build`, `Run`, `Crash log`) render in a more structured and aligned format.

## Nice To Have

- Add `ast doctor --fix` for common setup issues like missing browsers, runtimes, or generated runners.
- Cache resolved build/run command previews during larger matrix runs.
- Add clearer “why skipped” output for skipped files or modes.
- Make long reporter command lines wrap cleanly with indentation.
- Add a `--quiet-passes` mode that suppresses passing file lines and keeps failures plus the final summary.
- Print clickable crash-log paths consistently in failure output.
- Add per-mode build/run totals to the final summary.
