# Setup Diagnostics

Use `ast doctor` to validate local setup before running tests.

```bash
ast doctor
ast doctor --config ./as-test.config.json
```

`ast doctor` is useful for:

- invalid config shape
- missing runtime scripts
- unresolved runner commands
- target-specific setup issues

When config validation fails, `ast doctor` is the quickest way to surface the exact path and expected type.
