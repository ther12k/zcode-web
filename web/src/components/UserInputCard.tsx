// Held AskUserQuestion card: the agent asking the human clarifying
// questions mid-turn. Renders from stream lines (userinput.request /
// userinput.resolved), so live and reloaded viewers agree. Submitting POSTs
// {action:"accept", answers} — answers keyed by question text, multi-select
// joined with ", ", and a free-text "Other" entry wins when filled. The
// CLI feeds the answers back into the tool call.

import { useMemo, useState } from "react";
import { CircleHelp, CheckCircle2, XCircle } from "lucide-react";
import type { ApiClient, UserInputQuestion, UserInputRequestLine, UserInputResolvedLine } from "../api/client";

type Picks = Record<string, { labels: string[]; other: string }>;

function answerFor(q: UserInputQuestion, pick: { labels: string[]; other: string } | undefined): string {
  if (!pick) return "";
  const text = pick.other.trim();
  if (text) return text;
  if (!q.multiSelect) return pick.labels[0] || "";
  return pick.labels.join(", ");
}

function QuestionBlock({
  q,
  index,
  pick,
  disabled,
  onChange,
}: {
  q: UserInputQuestion;
  index: number;
  pick: { labels: string[]; other: string } | undefined;
  disabled: boolean;
  onChange: (next: { labels: string[]; other: string }) => void;
}) {
  const toggle = (label: string) => {
    const current = pick?.labels || [];
    if (q.multiSelect) {
      onChange({ labels: current.includes(label) ? current.filter((l) => l !== label) : [...current, label], other: pick?.other || "" });
    } else {
      onChange({ labels: current.includes(label) ? [] : [label], other: "" });
    }
  };
  return (
    <fieldset className="uq-question" data-index={index}>
      <legend className="uq-question-head">
        <span className="uq-header">{q.header}</span>
        <span className="uq-text">{q.question}</span>
      </legend>
      <div className="uq-options" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
        {q.options.map((o) => {
          const selected = (pick?.labels || []).includes(o.label);
          return (
            <button
              key={o.label}
              type="button"
              role={q.multiSelect ? "checkbox" : "radio"}
              aria-checked={selected}
              className={`uq-option${selected ? " uq-option-selected" : ""}`}
              title={o.description || o.label}
              disabled={disabled}
              onClick={() => toggle(o.label)}
            >
              <span className="uq-option-label">{o.label}</span>
              {o.description && <span className="uq-option-desc">{o.description}</span>}
            </button>
          );
        })}
      </div>
      <input
        className="uq-other"
        type="text"
        placeholder="Other…"
        aria-label={`Other answer for ${q.question}`}
        maxLength={2000}
        disabled={disabled}
        value={pick?.other || ""}
        onChange={(e) => onChange({ labels: pick?.labels || [], other: e.target.value })}
      />
    </fieldset>
  );
}

export function UserInputCard({
  client,
  sessionId,
  request,
  resolution,
  onNotify,
}: {
  client: ApiClient;
  sessionId: string | null;
  request: UserInputRequestLine;
  resolution: UserInputResolvedLine | null;
  onNotify: (text: string, type?: "success" | "error") => void;
}) {
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState<"submit" | "cancel" | null>(null);

  const answers = useMemo(() => {
    const out: Record<string, string> = {};
    for (const q of request.questions) {
      const a = answerFor(q, picks[q.question]);
      if (a) out[q.question] = a;
    }
    return out;
  }, [picks, request.questions]);

  const resolved = !!resolution;
  const declined = resolution?.action !== "accept";

  const send = async (action: "accept" | "decline") => {
    if (!sessionId || busy || resolved) return;
    if (action === "accept" && Object.keys(answers).length === 0) {
      onNotify("Pick at least one option (or write an Other answer) before submitting.", "error");
      return;
    }
    setBusy(action === "accept" ? "submit" : "cancel");
    try {
      await client.resolveSessionUserInput(
        sessionId,
        request.requestId,
        action,
        action === "accept" ? answers : undefined,
      );
      // userinput.resolved on the stream folds the card
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "Sending the answer failed.", "error");
      setBusy(null);
    }
  };

  return (
    <section className={`perm-card uq-card${resolved ? " perm-card-resolved" : ""}`} data-request-id={request.requestId}>
      <header className="perm-head">
        <span className="perm-head-icon uq-head-icon">
          {resolved ? (declined ? <XCircle size={14} /> : <CheckCircle2 size={14} />) : <CircleHelp size={14} />}
        </span>
        <span className="perm-title">{request.prompt || "A question for you"}</span>
        {!resolved && <span className="perm-waiting">waiting for your answer</span>}
        {resolved && (
          <span className={`perm-verdict ${declined ? "perm-verdict-deny" : "perm-verdict-allow"}`}>
            {declined ? "Dismissed" : "Answered"}
            {resolution?.via && resolution.via !== "user" ? ` · ${resolution.via}` : ""}
          </span>
        )}
      </header>
      {request.questions.map((q, i) => (
        <QuestionBlock
          key={q.question}
          q={q}
          index={i}
          pick={picks[q.question]}
          disabled={resolved || busy !== null}
          onChange={(next) => setPicks((p) => ({ ...p, [q.question]: next }))}
        />
      ))}
      {!resolved ? (
        <div className="perm-options uq-actions">
          <button type="button" className="perm-option perm-option-allow" disabled={busy !== null} onClick={() => void send("accept")}>
            {busy === "submit" ? "sending…" : "Submit answers"}
          </button>
          <button type="button" className="perm-option perm-option-deny" disabled={busy !== null} onClick={() => void send("decline")}>
            {busy === "cancel" ? "sending…" : "Dismiss"}
          </button>
        </div>
      ) : resolution?.answers && Object.keys(resolution.answers).length > 0 ? (
        <footer className="perm-picked">
          answered: {Object.entries(resolution.answers).map(([q, a]) => `${q.split("\n")[0].slice(0, 60)} → ${a}`).join(" · ")}
        </footer>
      ) : null}
    </section>
  );
}
