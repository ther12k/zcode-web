// Fixture CLI: emits one JSONL event containing a multibyte character that
// is split across two stdout writes, to prove streaming UTF-8 decoding
// (ZWUI-072: naive chunk concatenation corrupts the split character).
const evt = {
  type: "turn.completed",
  sessionId: "sess_multibyte",
  payload: { response: "héllo 🌍 done" },
};
const buf = Buffer.from(JSON.stringify(evt) + "\n", "utf8");
// split one byte INSIDE the emoji's UTF-8 sequence
const emoji = Buffer.from("🌍", "utf8");
const split = buf.indexOf(emoji) + 2;
process.stdout.write(buf.subarray(0, split));
setTimeout(() => {
  process.stdout.write(buf.subarray(split));
  process.exit(0);
}, 50);
