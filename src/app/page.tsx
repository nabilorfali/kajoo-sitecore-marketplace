"use client";

import { useEffect, useRef, useState } from "react";
import { MARKETPLACE_APP_ID } from "@/lib/agent-session";

// ── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  streaming?: boolean;
}

interface Activity {
  id: string;
  text: string;
}

// ── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code.trim());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-gray-700 text-left">
      <div className="flex items-center justify-between px-4 py-1.5 bg-gray-800 text-gray-400 text-xs font-mono">
        <span>{lang || "code"}</span>
        <button onClick={copy} className="hover:text-white transition-colors">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="bg-gray-900 text-gray-100 p-4 overflow-x-auto text-xs leading-relaxed m-0">
        <code>{code.trim()}</code>
      </pre>
    </div>
  );
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function MessageContent({ text }: { text: string }) {
  // Split on complete ```lang\n...\n``` fences only
  const parts = text.split(/(```[a-zA-Z]*\n[\s\S]*?```)/g);

  return (
    <div>
      {parts.map((part, i) => {
        const fence = part.match(/^```([a-zA-Z]*)\n([\s\S]*?)```$/);
        if (fence) {
          return <CodeBlock key={i} lang={fence[1]} code={fence[2]} />;
        }
        // Render plain text preserving whitespace
        return (
          <p key={i} className="whitespace-pre-wrap leading-relaxed text-sm">
            {part}
          </p>
        );
      })}
    </div>
  );
}

// ── Chat components ──────────────────────────────────────────────────────────

function AgentAvatar() {
  return (
    <div
      className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-sm font-bold"
      style={{ background: "var(--sitecore-red)" }}
    >
      K
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center bg-gray-200 text-gray-600 text-sm font-semibold">
      U
    </div>
  );
}

function ActivityPill({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-400 py-1 px-3 ml-11">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
      {text}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "agent",
  text: `Hi! I'm Kajoo, your Figma → Sitecore code generator.

Paste a Figma frame URL and I'll generate production-ready Sitecore components — Razor views, Glass Mapper models, Helix architecture, BEM CSS, and rendering templates.

You can also ask things like:
- "Make it a Controller Rendering in the Feature layer"
- "Use SXA tokens for colours instead of hardcoded values"
- "Add a mobile breakpoint at 768px"`,
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialise Sitecore Marketplace SDK (client-side only, fails gracefully outside iframe)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { ClientSDK } = await import("@sitecore-marketplace-sdk/client");
        const sdk = await ClientSDK.init({ target: window.parent });
        const ctx = await sdk.query("application.context") as unknown as Record<string, unknown>;
        if (mounted) {
          console.log("[Marketplace] app:", MARKETPLACE_APP_ID, "ctx:", ctx);
        }
      } catch {
        // Outside Sitecore iframe — ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activities]);

  async function handleSend(text: string) {
    if (!text.trim() || isStreaming) return;

    const agentMsgId = crypto.randomUUID();

    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text: text.trim() },
      { id: agentMsgId, role: "agent", text: "", streaming: true },
    ]);
    setActivities([]);
    setInput("");
    setIsStreaming(true);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text.trim(), sessionId }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as {
              type: string;
              text?: string;
              sessionId?: string;
            };

            if (event.type === "session" && event.sessionId) {
              setSessionId(event.sessionId);
            } else if (event.type === "text" && event.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId ? { ...m, text: m.text + event.text! } : m,
                ),
              );
            } else if (event.type === "activity" && event.text) {
              setActivities((prev) => [
                ...prev,
                { id: crypto.randomUUID(), text: event.text! },
              ]);
            } else if (event.type === "warn" && event.text) {
              setWarnings((prev) => [...prev, event.text!]);
            } else if (event.type === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId ? { ...m, streaming: false } : m,
                ),
              );
              setActivities([]);
              setIsStreaming(false);
            } else if (event.type === "error" && event.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === agentMsgId
                    ? { ...m, text: m.text || `⚠️ ${event.text}`, streaming: false }
                    : m,
                ),
              );
              setActivities([]);
              setIsStreaming(false);
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? {
                ...m,
                text: `Connection error: ${err instanceof Error ? err.message : err}`,
                streaming: false,
              }
            : m,
        ),
      );
      setActivities([]);
      setIsStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  }

  function handleInput(e: React.FormEvent<HTMLTextAreaElement>) {
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="border-b bg-white px-6 py-3 flex items-center gap-3 flex-shrink-0 shadow-sm">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
          style={{ background: "var(--sitecore-red)" }}
        >
          K
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-900 leading-none">
            Figma → Sitecore
          </h1>
          <p className="text-xs text-gray-400 mt-0.5">
            Kajoo AI · claude-opus-4-6
          </p>
        </div>
        {sessionId && (
          <span className="ml-auto text-xs text-gray-300 font-mono truncate max-w-xs hidden sm:block">
            {sessionId}
          </span>
        )}
      </header>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 space-y-1 flex-shrink-0">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">
              ⚠️ {w}
            </p>
          ))}
        </div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto">
          {messages.map((msg) =>
            msg.role === "agent" ? (
              <div key={msg.id} className="flex items-end gap-3 mb-4">
                <AgentAvatar />
                <div className="flex-1 min-w-0">
                  <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                    {msg.text ? (
                      <MessageContent text={msg.text} />
                    ) : null}
                    {msg.streaming && !msg.text && (
                      <div className="flex gap-1 items-center h-5">
                        <span
                          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                          style={{ animationDelay: "0ms" }}
                        />
                        <span
                          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                          style={{ animationDelay: "150ms" }}
                        />
                        <span
                          className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                          style={{ animationDelay: "300ms" }}
                        />
                      </div>
                    )}
                    {msg.streaming && msg.text && (
                      <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex items-end gap-3 mb-4 flex-row-reverse">
                <UserAvatar />
                <div className="max-w-xl">
                  <div
                    className="rounded-2xl rounded-br-sm px-4 py-3 text-white"
                    style={{ background: "var(--sitecore-red)" }}
                  >
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {msg.text}
                    </p>
                  </div>
                </div>
              </div>
            ),
          )}

          {/* Live activity pills */}
          {activities.map((a) => (
            <ActivityPill key={a.id} text={a.text} />
          ))}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input bar */}
      <div className="border-t bg-white px-4 py-4 flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-3 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleInput}
              placeholder={
                isStreaming
                  ? "Agent is responding…"
                  : "Paste a Figma URL or ask anything… (Enter to send, Shift+Enter for new line)"
              }
              disabled={isStreaming}
              rows={1}
              className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm
                         focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent
                         disabled:bg-gray-50 disabled:text-gray-400 resize-none leading-relaxed"
              style={{ minHeight: "48px", maxHeight: "160px" }}
            />
            <button
              onClick={() => handleSend(input)}
              disabled={isStreaming || !input.trim()}
              className="px-5 py-3 rounded-xl text-sm font-medium text-white transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              style={{
                background:
                  isStreaming || !input.trim()
                    ? "#9ca3af"
                    : "var(--sitecore-red)",
              }}
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-300 mt-2 text-center">
            {MARKETPLACE_APP_ID}
          </p>
        </div>
      </div>
    </div>
  );
}
