import { describe, expect, it, log, test } from "..";

function buildAwfulText(prefix: string = ""): string {
  return (
    prefix +
    'quote"' +
    " slash\\" +
    " nul" +
    String.fromCharCode(0) +
    " backspace" +
    String.fromCharCode(8) +
    " formfeed" +
    String.fromCharCode(12) +
    " newline\n carriage\r tab\t" +
    String.fromCharCode(0xd800)
  );
}

const awful = buildAwfulText();

describe("describe-" + awful, () => {
  test("test-" + awful, () => {
    log(awful);

    expect(awful, awful).toBe(awful);
    expect(awful).toContain(String.fromCharCode(0));
    expect(awful).toContain(String.fromCharCode(8));
    expect(awful).toContain(String.fromCharCode(12));
  });

  it("it-" + awful, () => {
    expect(awful.length > 0).toBe(true);
  });
});
