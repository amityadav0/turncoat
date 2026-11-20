// Checks on the wording of skill/SKILL.md and docs/E2E.md against README.md, the source of truth.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const readme = read("README.md");
const skill = read("skill/SKILL.md");
const e2e = read("docs/E2E.md");

// README: "**Risk notice.** A paid attempt is ... Nothing here promises a return."
const notice = readme.match(/\*\*Risk notice\.\*\* (.+)/)?.[1]?.trim();

test("README still has the risk notice this test reads", () => {
  assert.ok(notice, "README.md has no '**Risk notice.**' line");
  assert.match(notice, /^A paid attempt is a fee for a security test/);
});

test("the skill and the checklist show README's risk notice word for word", () => {
  assert.ok(skill.includes(notice), "SKILL.md does not contain README's risk notice verbatim");
  assert.ok(e2e.includes(notice), "docs/E2E.md does not contain README's risk notice verbatim");
});

test("the shorter earlier wording is gone", () => {
  const old = "A paid attempt is a fee for a security test. Most attempts fail.";
  assert.ok(!skill.includes(old));
  assert.ok(!e2e.includes(old));
});

test("first-run text states the Developer Mode facts and that practice needs none", () => {
  const step0 = skill.slice(skill.indexOf("## Step 0"), skill.indexOf("## Practice"));
  for (const fact of [/contract calls/i, /Developer Mode/, /Binance App/, /7 days from the last time you use it/, /balance cap/, /Practice needs none of this/]) {
    assert.match(step0, fact);
  }
});

test("the skill never describes attempts as earning, and its name has no 'Binance' or 'BNB'", () => {
  const banned = /\b(jackpot|win big|passive|guaranteed)\b/i;
  assert.doesNotMatch(skill, banned);
  // "earn" may appear only inside README's notice ("Do not treat this as a way to earn") or the rule forbidding it.
  const earnLines = skill.split("\n").filter((l) => /\bearn\b/i.test(l));
  for (const l of earnLines) assert.match(l, /Do not treat this as a way to earn|Never describe attempts as a way to earn/);
  const name = skill.match(/^name:\s*(.+)$/m)[1];
  assert.doesNotMatch(name, /binance|bnb/i);
});

// README: 'If Argus writes "declined" ... The label never changes whether the pot pays.'
const breakKindText = readme.match(/If Argus writes "declined".*?The label never changes whether the pot pays\./)?.[0];

test("a break is shown as misfire or persuaded with README's sentence, word for word", () => {
  assert.ok(breakKindText, "README.md no longer has the misfire/persuaded sentence this test reads");
  assert.ok(skill.includes(breakKindText), "SKILL.md does not contain README's misfire/persuaded wording verbatim");
  assert.ok(e2e.includes(breakKindText), "docs/E2E.md does not contain README's misfire/persuaded wording verbatim");
  assert.match(skill, /breakKind/);
});

test("the break is described from the round's mode, with a fallback for unknown modes", () => {
  assert.match(skill, /Argus must approve or reject every request/);
  assert.match(skill, /broken if he approves/i);
  assert.match(skill, /he is broken if he takes an action his rules forbid/i);
  assert.doesNotMatch(skill, /talk him into calling `transfer` or `approve`/);
  assert.match(skill, /payment requests, not general persuasion/);
});

test("several live rounds: all shown, free-attempt rule said first, unknown mode stops before any transaction", () => {
  const step3 = skill.slice(skill.indexOf("### 3 "), skill.indexOf("### 3a"));
  for (const f of [/turncoat\.mjs live/, /`model`/, /`guardVersion`/, /`potAmount`/, /`timeLeft`/, /`attemptCount`/, /`nextFee`/]) assert.match(step3, f);
  const rule = step3.indexOf("one free attempt per Agent ID per day, across all rounds");
  assert.ok(rule > 0 && rule < step3.indexOf("Ask which round"), "free-attempt rule must come before the choice");
  assert.match(step3, /doesn't support yet[^\n]*\n*Then stop\. Build no transaction/);
  assert.match(skill, /attempt-calldata --round <id> --mode/);
});
