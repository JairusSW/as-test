# Custom Reporters

`as-test` ships with a default reporter and a TAP reporter, and also supports custom reporters.

Built-in TAP:

```bash
ast test --tap
ast run --reporter tap
```

Config:

```json
{
  "runOptions": {
    "reporter": "default"
  }
}
```

Reporter object form:

```json
{
  "runOptions": {
    "reporter": {
      "name": "tap",
      "outFile": "./.as-test/reports/report.tap"
    }
  }
}
```

Use custom reporters when you need CI integration or another output format on top of the runtime event stream.
