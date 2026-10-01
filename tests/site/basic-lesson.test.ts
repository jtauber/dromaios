import assert from "node:assert/strict";
import { test } from "node:test";
import { basicDisplay, parseBasicLesson } from "../../site/basic-lesson.js";

const introduction = "# A conversation\n\nAn explanation\nover two lines.\n\n";

test("BASIC lesson transcripts distinguish typed lines from replies and keep Markdown locations", () => {
  const source = introduction + '```basic-session\n> 10 PRINT "HELLO"\n> RUN\nHELLO\n\nOK\n```\n\nMore prose.\n\n```basic-session\n> INPUT N\n?\n> 3\n\nOK\n```\n';
  const chapter = parseBasicLesson(source.replaceAll("\n", "\r\n"), "lesson.md");
  assert.equal(chapter.title, "A conversation");
  assert.equal(chapter.introduction, "An explanation\nover two lines.");
  assert.deepEqual(chapter.sessions, [
    [{ input: '10 PRINT "HELLO"', output: "", line: 7 }, { input: "RUN", output: "HELLO\n\nOK", line: 8 }],
    [{ input: "INPUT N", output: "?", line: 17 }, { input: "3", output: "\nOK", line: 19 }],
  ]);
  assert.match(chapter.body, /^<!-- basic-session:0 -->/);
  assert.ok(chapter.body.includes("More prose."));
  assert.equal(basicDisplay(" 5  \n\nOK \n\n"), " 5\n\nOK");
  assert.notEqual(basicDisplay(" 5\nOK"), basicDisplay(" 5\n\nOK"));
  assert.notEqual(basicDisplay("5\n\nOK"), basicDisplay(" 5\n\nOK"));
});

test("BASIC lesson syntax errors identify the source and reject unchecked or malformed conversations", () => {
  for (const [body, message] of [
    ["No example.", "Expected at least one"],
    ["```basic-session\n> PRINT 2\n", "Unclosed"],
    ["```basic-session\n```", "must contain input"],
    ["```basic-session\nOK\n```", "Start each session"],
    ["```basic-session\n>RUN\n```", "Separate >"],
    ["```basic-session\n> PRINT ‘HI’\n```", "printable ASCII"],
  ]) {
    assert.throws(() => parseBasicLesson(introduction + body, "lesson.md"),
      error => error instanceof SyntaxError && error.message.startsWith("lesson.md:") && error.message.includes(message!));
  }
  assert.throws(() => parseBasicLesson("Missing title", "lesson.md"), /lesson.md:1: Expected a title/);
});

test("BASIC lesson examples inside another Markdown fence are not executable", () => {
  const quoted = '````text\n```basic-session\n> NEVER RUN THIS\n```\n````\n';
  const chapter = parseBasicLesson(introduction + quoted + '\n~~~basic-session\n> PRINT "<HELLO>&"\n<HELLO>&\n\nOK\n~~~\n', "lesson.md");
  assert.equal(chapter.sessions.length, 1);
  assert.equal(chapter.sessions[0]![0]!.input, 'PRINT "<HELLO>&"');
  assert.ok(chapter.body.startsWith(quoted));
});
