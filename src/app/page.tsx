"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { MARKETPLACE_APP_ID } from "@/lib/agent-session";
import { parseManifest, stripManifest } from "@/lib/parse-manifest";
import type { DeployManifest } from "@/lib/parse-manifest";
import type { DeployResult, DeployStep } from "@/lib/sitecore-deploy";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  streaming?: boolean;
  manifest?: DeployManifest;
}

interface Activity {
  id: string;
  text: string;
}

interface SitecoreContext {
  pageId: string;
  pageName: string;
  siteId: string;
  siteName: string;
  language: string;
}

// ── Code block ────────────────────────────────────────────────────────────────

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

function MessageContent({ text }: { text: string }) {
  const parts = text.split(/(```[a-zA-Z]*\n[\s\S]*?```)/g);
  return (
    <div>
      {parts.map((part, i) => {
        const fence = part.match(/^```([a-zA-Z]*)\n([\s\S]*?)```$/);
        if (fence) return <CodeBlock key={i} lang={fence[1]} code={fence[2]} />;
        return (
          <p key={i} className="whitespace-pre-wrap leading-relaxed text-sm">
            {part}
          </p>
        );
      })}
    </div>
  );
}

// ── Avatars ───────────────────────────────────────────────────────────────────

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

// ── Deploy step indicator ─────────────────────────────────────────────────────

function StepRow({ step }: { step: DeployStep }) {
  const icons: Record<DeployStep["status"], string> = {
    pending: "○",
    running: "◐",
    done: "✓",
    error: "✕",
  };
  const colors: Record<DeployStep["status"], string> = {
    pending: "text-gray-400",
    running: "text-blue-500 animate-pulse",
    done: "text-green-500",
    error: "text-red-500",
  };
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className={`font-mono mt-0.5 flex-shrink-0 ${colors[step.status]}`}>
        {icons[step.status]}
      </span>
      <div>
        <span className="text-gray-800">{step.label}</span>
        {step.detail && (
          <span className="ml-2 text-xs text-gray-400 font-mono">{step.detail}</span>
        )}
      </div>
    </div>
  );
}

// ── Deploy button card ────────────────────────────────────────────────────────

function DeployCard({
  manifest,
  sitecoreCtx,
  sdkReady,
  onDeploy,
}: {
  manifest: DeployManifest;
  sitecoreCtx: SitecoreContext | null;
  sdkReady: boolean;
  onDeploy: () => void;
}) {
  if (!sdkReady) {
    return (
      <div className="mt-3 p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-700">
        💡 Open this app inside XM Cloud to deploy <strong>{manifest.componentName}</strong> directly to your instance.
      </div>
    );
  }

  return (
    <div
      className="mt-3 p-4 rounded-xl border-2 text-sm"
      style={{ borderColor: "var(--sitecore-red)", background: "#fff8f8" }}
    >
      <div className="font-semibold text-gray-900 mb-2">
        🚀 Ready to deploy — <code className="text-xs bg-gray-100 px-1 rounded">{manifest.componentName}</code>
      </div>
      <div className="text-xs text-gray-500 space-y-0.5 mb-3">
        <div>Layer: <strong>{manifest.helixLayer} / {manifest.module}</strong></div>
        <div>Fields: <strong>{manifest.fields.map((f) => f.name).join(", ")}</strong></div>
        {sitecoreCtx && (
          <div>Page: <strong>{sitecoreCtx.pageName}</strong> on <strong>{sitecoreCtx.siteName}</strong></div>
        )}
      </div>
      <button
        onClick={onDeploy}
        className="w-full py-2 rounded-lg text-white text-sm font-semibold transition-opacity hover:opacity-90"
        style={{ background: "var(--sitecore-red)" }}
      >
        Deploy to XM Cloud →
      </button>
    </div>
  );
}

// ── Deploy dialog ─────────────────────────────────────────────────────────────

function DeployDialog({
  manifest,
  sitecoreCtx,
  steps,
  result,
  error,
  onConfirm,
  onClose,
}: {
  manifest: DeployManifest;
  sitecoreCtx: SitecoreContext | null;
  steps: DeployStep[];
  result: DeployResult | null;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isRunning = steps.some((s) => s.status === "running");
  const isDone = result !== null;
  const hasStarted = steps.some((s) => s.status !== "pending");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 text-white"
          style={{ background: "var(--sitecore-red)" }}
        >
          <h2 className="text-lg font-bold">Deploy to XM Cloud</h2>
          <p className="text-sm opacity-80 mt-0.5">
            {manifest.componentName} → {sitecoreCtx?.siteName ?? "your instance"}
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* What will be created */}
          {!hasStarted && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-700">What will be created:</p>
              <ul className="text-xs text-gray-600 space-y-1 list-none">
                <li className="flex gap-2">
                  <span className="text-gray-400">▸</span>
                  <span>Data template: <code className="bg-gray-100 px-1 rounded">/sitecore/templates/{manifest.helixLayer}/{manifest.module}/{manifest.componentName}</code></span>
                </li>
                <li className="flex gap-2">
                  <span className="text-gray-400">▸</span>
                  <span>Fields: {manifest.fields.map((f) => `${f.name} (${f.type})`).join(", ")}</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-gray-400">▸</span>
                  <span>Content item (datasource) under <code className="bg-gray-100 px-1 rounded">/sitecore/content/{sitecoreCtx?.siteName ?? "…"}/Data</code></span>
                </li>
                {manifest.renderingId ? (
                  <li className="flex gap-2">
                    <span className="text-gray-400">▸</span>
                    <span>Component added to page: <strong>{sitecoreCtx?.pageName ?? "current page"}</strong></span>
                  </li>
                ) : (
                  <li className="flex gap-2 text-amber-600">
                    <span>⚠</span>
                    <span>No rendering ID — template + content will be created, but component won&apos;t be added to the page until rendering code is deployed.</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Live step progress */}
          {hasStarted && (
            <div className="space-y-2">
              {steps.map((step, i) => (
                <StepRow key={i} step={step} />
              ))}
            </div>
          )}

          {/* Success */}
          {isDone && !error && (
            <div className="p-3 rounded-xl bg-green-50 border border-green-200 text-xs space-y-1">
              <p className="font-semibold text-green-700">✓ Deployment complete</p>
              <p className="text-green-600 font-mono">{result!.templatePath}</p>
              <p className="text-green-600 font-mono">{result!.contentItemPath}</p>
              {result!.addedToPage && (
                <p className="text-green-700 font-semibold">Component is live on the page!</p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              <p className="font-semibold">Deployment failed</p>
              <p className="font-mono mt-1">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex gap-3">
          {!hasStarted && (
            <>
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "var(--sitecore-red)" }}
              >
                Confirm & Deploy
              </button>
            </>
          )}
          {(isDone || error) && (
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          )}
          {isRunning && (
            <div className="flex-1 py-2.5 text-center text-sm text-gray-400 animate-pulse">
              Deploying…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Welcome message ───────────────────────────────────────────────────────────

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "agent",
  text: `Hi! I'm Kajoo, your Figma → Sitecore code generator.

Paste a Figma frame URL and I'll generate production-ready Sitecore components — Razor views, Glass Mapper models, Helix architecture, BEM CSS, and rendering templates.

When running inside XM Cloud, I can also deploy the component directly: create the data template, content item, wire it to the page, and reload the canvas so you see it live.

You can also ask things like:
- "Make it a Controller Rendering in the Feature layer"
- "Use SXA tokens for colours instead of hardcoded values"
- "Add a mobile breakpoint at 768px"`,
};

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Sitecore SDK
  const [sdkReady, setSdkReady] = useState(false);
  const [sitecoreCtx, setSitecoreCtx] = useState<SitecoreContext | null>(null);
  const sdkRef = useRef<unknown>(null);

  // Deploy state
  const [activeManifest, setActiveManifest] = useState<DeployManifest | null>(null);
  const [showDeployDialog, setShowDeployDialog] = useState(false);
  const [deploySteps, setDeploySteps] = useState<DeployStep[]>([]);
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentAgentTextRef = useRef("");

  // ── Sitecore Marketplace SDK init ──────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [{ ClientSDK }, { XMC }] = await Promise.all([
          import("@sitecore-marketplace-sdk/client"),
          import("@sitecore-marketplace-sdk/xmc"),
        ]);

        const sdk = await ClientSDK.init({
          target: window.parent,
          modules: [XMC],
        });

        if (!mounted) return;
        sdkRef.current = sdk;
        setSdkReady(true);
        console.log("[Kajoo] SDK connected — app:", MARKETPLACE_APP_ID);

        // Subscribe to pages.context (live updates as editor navigates)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = await (sdk as any).query("pages.context");
        if (!mounted) return;

        const page = ctx?.data?.pageInfo;
        const site = ctx?.data?.siteInfo;
        if (page && site) {
          setSitecoreCtx({
            pageId: page.id ?? page.itemId ?? "",
            pageName: page.name ?? page.displayName ?? "Unknown Page",
            siteId: site.id ?? "",
            siteName: site.name ?? "Unknown Site",
            language: site.language ?? "en",
          });
        }

        // Live subscription — re-run whenever editor navigates
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sdk as any).query("pages.context", {
          subscribe: true,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onData: (updated: any) => {
            if (!mounted) return;
            const p = updated?.data?.pageInfo;
            const s = updated?.data?.siteInfo;
            if (p && s) {
              setSitecoreCtx({
                pageId: p.id ?? p.itemId ?? "",
                pageName: p.name ?? p.displayName ?? "Unknown Page",
                siteId: s.id ?? "",
                siteName: s.name ?? "Unknown Site",
                language: s.language ?? "en",
              });
            }
          },
        });
      } catch {
        // Outside Sitecore iframe — SDK not available
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activities]);

  // ── Send message ───────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming) return;

      const agentMsgId = crypto.randomUUID();
      currentAgentTextRef.current = "";

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text: text.trim() },
        { id: agentMsgId, role: "agent", text: "", streaming: true },
      ]);
      setActivities([]);
      setInput("");
      setIsStreaming(true);
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text.trim(), sessionId }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

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
                type: string; text?: string; sessionId?: string;
              };

              if (event.type === "session" && event.sessionId) {
                setSessionId(event.sessionId);
              } else if (event.type === "text" && event.text) {
                currentAgentTextRef.current += event.text;
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
                // Parse deploy manifest from full response
                const fullText = currentAgentTextRef.current;
                const manifest = parseManifest(fullText);
                const displayText = manifest ? stripManifest(fullText) : fullText;

                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === agentMsgId
                      ? { ...m, text: displayText, streaming: false, manifest: manifest ?? undefined }
                      : m,
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
            } catch { /* malformed SSE line */ }
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId
              ? { ...m, text: `Connection error: ${err instanceof Error ? err.message : err}`, streaming: false }
              : m,
          ),
        );
        setActivities([]);
        setIsStreaming(false);
      }
    },
    [isStreaming, sessionId],
  );

  // ── Deploy ─────────────────────────────────────────────────────────────────
  function openDeployDialog(manifest: DeployManifest) {
    setActiveManifest(manifest);
    setDeploySteps([
      { label: "Create data template", status: "pending" },
      { label: "Add template fields", status: "pending" },
      { label: "Create content item", status: "pending" },
      { label: "Add component to page", status: "pending" },
      { label: "Reload canvas", status: "pending" },
    ]);
    setDeployResult(null);
    setDeployError(null);
    setShowDeployDialog(true);
  }

  async function runDeploy() {
    if (!activeManifest || !sdkRef.current) return;
    const { deployToSitecore } = await import("@/lib/sitecore-deploy");
    try {
      const result = await deployToSitecore(
        sdkRef.current,
        activeManifest,
        sitecoreCtx?.pageId ?? "",
        sitecoreCtx?.siteName ?? "website",
        sitecoreCtx?.language ?? "en",
        (steps) => setDeploySteps(steps),
      );
      setDeployResult(result);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : String(err));
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

  // ── Render ─────────────────────────────────────────────────────────────────
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
          <p className="text-xs text-gray-400 mt-0.5">Kajoo AI · claude-opus-4-6</p>
        </div>

        {/* Live Sitecore page context */}
        {sitecoreCtx ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
            <div className="text-right">
              <p className="text-xs font-medium text-gray-700 leading-none">{sitecoreCtx.pageName}</p>
              <p className="text-xs text-gray-400 mt-0.5">{sitecoreCtx.siteName} · {sitecoreCtx.language}</p>
            </div>
          </div>
        ) : sdkReady ? (
          <span className="ml-auto text-xs text-gray-400">Connected · no page selected</span>
        ) : sessionId ? (
          <span className="ml-auto text-xs text-gray-300 font-mono truncate max-w-xs hidden sm:block">
            {sessionId}
          </span>
        ) : null}
      </header>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 space-y-1 flex-shrink-0">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">⚠️ {w}</p>
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
                    {msg.text ? <MessageContent text={msg.text} /> : null}
                    {msg.streaming && !msg.text && (
                      <div className="flex gap-1 items-center h-5">
                        {[0, 150, 300].map((d) => (
                          <span
                            key={d}
                            className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"
                            style={{ animationDelay: `${d}ms` }}
                          />
                        ))}
                      </div>
                    )}
                    {msg.streaming && msg.text && (
                      <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
                    )}

                    {/* Deploy card — only on finished messages with a manifest */}
                    {!msg.streaming && msg.manifest && (
                      <DeployCard
                        manifest={msg.manifest}
                        sitecoreCtx={sitecoreCtx}
                        sdkReady={sdkReady}
                        onDeploy={() => openDeployDialog(msg.manifest!)}
                      />
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
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                  </div>
                </div>
              </div>
            ),
          )}

          {activities.map((a) => (
            <ActivityPill key={a.id} text={a.text} />
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* Input */}
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
                background: isStreaming || !input.trim() ? "#9ca3af" : "var(--sitecore-red)",
              }}
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-300 mt-2 text-center">{MARKETPLACE_APP_ID}</p>
        </div>
      </div>

      {/* Deploy dialog */}
      {showDeployDialog && activeManifest && (
        <DeployDialog
          manifest={activeManifest}
          sitecoreCtx={sitecoreCtx}
          steps={deploySteps}
          result={deployResult}
          error={deployError}
          onConfirm={runDeploy}
          onClose={() => {
            if (!deploySteps.some((s) => s.status === "running")) {
              setShowDeployDialog(false);
            }
          }}
        />
      )}
    </div>
  );
}
