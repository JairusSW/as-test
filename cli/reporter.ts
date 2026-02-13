import chalk from "chalk";
import { diff } from "typer-diff";
import { formatTime } from "./util.js";

export type SnapshotSummary = {
  matched: number;
  created: number;
  updated: number;
  failed: number;
};

export type RealtimeFailureEvent = {
  key: string;
  instr: string;
  left: string;
  right: string;
  message: string;
};

export type ProgressEvent = {
  file: string;
  depth: number;
  suiteKind: string;
  description: string;
  verdict?: string;
  time?: string;
};

export class Reporter {
  public passedFiles = 0;
  public failedFiles = 0;

  public passedSuites = 0;
  public failedSuites = 0;

  public passedTests = 0;
  public failedTests = 0;

  public failed: any[] = [];

  public time = 0.0;
  constructor(reports: any[]) {
    this.readReports(reports);
  }
  private readReports(reports: any[]) {
    for (const file of reports) {
      this.readFile(file);
    }
  }
  private readFile(file: any) {
    let failed = false;
    for (const suite of file) {
      let suiteFailed = false;
      if (suite.verdict == "fail") {
        failed = true;
        this.failedSuites++;
        suiteFailed = true;
      } else {
        this.passedSuites++;
      }
      this.time += suite.time.end - suite.time.start;
      for (const subSuite of suite.suites) {
        this.readSuite(subSuite);
      }
      for (const test of suite.tests) {
        if (test.verdict == "fail") suiteFailed = true;
        this.readTest(test);
      }
      if (suiteFailed) this.failed.push(suite);
    }
    if (failed) this.failedFiles++;
    else this.passedFiles++;
  }
  private readSuite(suite: any) {
    let suiteFailed = false;
    if (suite.verdict == "fail") {
      this.failedSuites++;
      suiteFailed = true;
    } else {
      this.passedSuites++;
    }
    this.time += suite.time.end - suite.time.start;
    for (const subSuite of suite.suites) {
      this.readSuite(subSuite);
    }
    for (const test of suite.tests) {
      if (test.verdict == "fail") suiteFailed = true;
      this.readTest(test);
    }
    if (suiteFailed) this.failed.push(suite);
  }
  private readTest(test: any) {
    if (test.verdict == "fail") {
      this.failedTests++;
    } else {
      this.passedTests++;
    }
  }
}

export function renderRealtimeFailure(event: RealtimeFailureEvent): void {
  console.log(
    `${chalk.bgRed(" FAIL ")} ${chalk.dim(event.key)} ${chalk.bold(event.instr)}`,
  );
  if (event.message.length) {
    console.log(`${chalk.dim("message ->")} ${event.message}`);
  }

  const diffResult = diff(event.left, event.right);
  let expected = "";
  for (const res of diffResult.diff) {
    switch (res.type) {
      case "correct":
        expected += chalk.dim(res.value);
        break;
      case "extra":
        expected += chalk.red.strikethrough(res.value);
        break;
      case "missing":
        expected += chalk.bgBlack(res.value);
        break;
      case "wrong":
        expected += chalk.bgRed(res.value);
        break;
      case "untouched":
      case "spacer":
        break;
    }
  }
  console.log(`${chalk.dim("(expected) ->")} ${expected}`);
  console.log(`${chalk.dim("(received) ->")} ${chalk.dim(event.left)}\n`);
}

export class LiveProgressReporter {
  fileStart(_event: ProgressEvent): void {}

  fileEnd(event: ProgressEvent): void {
    const verdict = event.verdict ?? "none";
    if (verdict == "ok") {
      this.writeLine(
        `${chalk.bgGreenBright(" PASS ")} ${event.file} ${chalk.dim(event.time ?? "")}`,
      );
    } else if (verdict == "fail") {
      this.writeLine(
        `${chalk.bgRed(" FAIL ")} ${event.file} ${chalk.dim(event.time ?? "")}`,
      );
    } else {
      this.writeLine(
        `${chalk.bgBlackBright(" SKIP ")} ${event.file} ${chalk.dim(event.time ?? "")}`,
      );
    }
  }

  suiteStart(_event: ProgressEvent): void {}

  suiteEnd(_event: ProgressEvent): void {}

  private writeLine(text: string): number {
    process.stdout.write(text + "\n");
    return 0;
  }
}

export function renderFailedSuites(reporter: Reporter): void {
  if (!reporter.failed.length) return;
  console.log("");
  const printed = new Set<string>();
  for (const failed of reporter.failed) {
    if (!failed?.file) continue;
    const file = String(failed.file);
    collectSuiteFailures(failed, file, [], printed);
  }
}

function collectSuiteFailures(
  suite: any,
  file: string,
  path: string[],
  printed: Set<string>,
): void {
  const nextPath = [...path, String(suite.description ?? "unknown")];

  if (Array.isArray(suite.tests)) {
    for (let i = 0; i < suite.tests.length; i++) {
      const test = suite.tests[i];
      if (test?.verdict != "fail") continue;
      const assertionIndex = i + 1;
      const title = `${nextPath.join(" > ")}#${assertionIndex}`;
      const loc = String(test.location ?? "");
      const where = loc.length ? `${file}:${loc}` : file;
      const dedupeKey = `${file}::${title}::${String(test.left)}::${String(test.right)}`;
      if (printed.has(dedupeKey)) continue;
      printed.add(dedupeKey);

      const left = JSON.stringify(test.left);
      const right = JSON.stringify(test.right);
      const diffResult = diff(left, right);
      let expected = "";
      for (const res of diffResult.diff) {
        switch (res.type) {
          case "correct":
            expected += chalk.dim(res.value);
            break;
          case "extra":
            expected += chalk.red.strikethrough(res.value);
            break;
          case "missing":
            expected += chalk.bgBlack(res.value);
            break;
          case "wrong":
            expected += chalk.bgRed(res.value);
            break;
          case "untouched":
          case "spacer":
            break;
        }
      }

      console.log(
        `${chalk.bgRed(" FAIL ")} ${chalk.dim(title)} ${chalk.dim("(" + where + ")")}`,
      );
      console.log(`${chalk.dim("(expected) ->")} ${expected}`);
      console.log(`${chalk.dim("(received) ->")} ${chalk.dim(left)}\n`);
    }
  }

  if (Array.isArray(suite.suites)) {
    for (const sub of suite.suites) {
      collectSuiteFailures(sub, file, nextPath, printed);
    }
  }
}

export function renderSnapshotSummary(snapshotSummary: SnapshotSummary): void {
  console.log("");
  console.log(
    `${chalk.bold("Snapshots:")} ${chalk.greenBright(snapshotSummary.matched)} matched, ${chalk.blueBright(snapshotSummary.created)} created, ${chalk.blueBright(snapshotSummary.updated)} updated, ${snapshotSummary.failed ? chalk.red(snapshotSummary.failed) : chalk.greenBright("0")} failed`,
  );
}

export function renderTotals(reporter: Reporter): void {
  console.log("");
  process.stdout.write(chalk.bold("Files:  "));
  if (reporter.failedFiles) {
    process.stdout.write(chalk.bold.red(reporter.failedFiles + " failed"));
  } else {
    process.stdout.write(chalk.bold.greenBright("0 failed"));
  }
  process.stdout.write(
    ", " + (reporter.failedFiles + reporter.passedFiles) + " total\n",
  );

  process.stdout.write(chalk.bold("Suites: "));
  if (reporter.failedSuites) {
    process.stdout.write(chalk.bold.red(reporter.failedSuites + " failed"));
  } else {
    process.stdout.write(chalk.bold.greenBright("0 failed"));
  }
  process.stdout.write(
    ", " + (reporter.failedSuites + reporter.passedSuites) + " total\n",
  );

  process.stdout.write(chalk.bold("Tests:  "));
  if (reporter.failedTests) {
    process.stdout.write(chalk.bold.red(reporter.failedTests + " failed"));
  } else {
    process.stdout.write(chalk.bold.greenBright("0 failed"));
  }
  process.stdout.write(
    ", " + (reporter.failedTests + reporter.passedTests) + " total\n",
  );

  process.stdout.write(chalk.bold("Time:   ") + formatTime(reporter.time) + "\n");
}
