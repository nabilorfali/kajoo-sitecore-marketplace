"use client";

import { useEffect, useRef, useState } from "react";
import { MARKETPLACE_APP_ID } from "@/lib/agent-session";

type Status = "idle" | "loading" | "streaming" | "done" | "error";

interface SitecoreContext {
  siteName?: string;
  pageTitle?: string;
}

export default function Home() {
  const [figmaUrl, setFigmaUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [output, setOutput] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sitecoreCtx, setSitecoreCtx] = useState<SitecoreContext>({});
  const outputRef = useRef<HTMLDivElement>(null);

  // Initialise Sitecore Marketplace SDK (client-side only)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { ClientSDK } = await import("@sitecore-marketplace-sdk/client");
        const sdk = await ClientSDK.init({ target: window.parent });
        const ctx = await sdk.query("application.context") as unknown as Record<string, unknown>;
        if (mounted) {
          setSitecoreCtx({
            siteName: (ctx?.siteName as string) ?? undefined,
            pageTitle: (ctx?.pageTitle as string) ?? undefined,
          });
          console.log("[Marketplace] app:", MARKETPLACE_APP_ID, "ctx:", ctx);
        }
      } catch {
        // Running outside Sitecore (local dev) — ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!figmaUrl.trim()) return;

    setStatus("loading");
    setOutput("");
    setWarnings([]);
    setSessionId(null);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ figmaUrl: figmaUrl.trim() }),
      });

      if (!res.ok || !res.body) {
        setStatus("error");
        setOutput("Failed to connect to agent.");
        return;
      }

      setStatus("streaming");
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
              setOutput((prev) => prev + event.text);
            } else if (event.type === "warn" && event.text) {
              setWarnings((prev) => [...prev, event.text!]);
            } else if (event.type === "done") {
              setStatus("done");
            } else if (event.type === "error" && event.text) {
              setStatus("error");
              setOutput((prev) => prev + `\n\n⚠️ Error: ${event.text}`);
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }

      if (status === "streaming") setStatus("done");
    } catch (err) {
      setStatus("error");
      setOutput(`Connection error: ${err instanceof Error ? err.message : err}`);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(output);
  }

  const isRunning = status === "loading" || status === "streaming";

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "inherit" }}>
      {/* Header */}
      <header className="border-b bg-white px-6 py-4 flex items-center gap-3">
        <div
          className="w-8 h-8 rounded flex items-center justify-center text-white text-sm font-bold"
          style={{ background: "var(--sitecore-red)" }}
        >
          K
        </div>
        <div>
          <h1 className="text-base font-semibold text-gray-900 leading-none">
            Figma → Sitecore
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Kajoo AI · powered by claude-opus-4-6
            {sitecoreCtx.siteName && (
              <span className="ml-2 text-blue-600">
                · {sitecoreCtx.siteName}
              </span>
            )}
          </p>
        </div>
        {sessionId && (
          <span className="ml-auto text-xs text-gray-400 font-mono truncate max-w-xs">
            {sessionId}
          </span>
        )}
      </header>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 space-y-1">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-700">
              ⚠️ {w}
            </p>
          ))}
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col gap-4 p-6 max-w-4xl w-full mx-auto">
        {/* Input form */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="url"
            value={figmaUrl}
            onChange={(e) => setFigmaUrl(e.target.value)}
            placeholder="https://www.figma.com/design/..."
            disabled={isRunning}
            className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm
                       focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent
                       disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            type="submit"
            disabled={isRunning || !figmaUrl.trim()}
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-white transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: isRunning ? "#9ca3af" : "var(--sitecore-red)",
            }}
          >
            {status === "loading"
              ? "Starting…"
              : status === "streaming"
              ? "Generating…"
              : "Generate"}
          </button>
        </form>

        {/* Status pill */}
        {isRunning && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            {status === "loading"
              ? "Creating session…"
              : "Agent is generating Sitecore code…"}
          </div>
        )}

        {/* Output */}
        {output && (
          <div className="flex-1 flex flex-col border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-gray-50">
              <span className="text-xs font-medium text-gray-600">
                Generated Code
                {status === "done" && (
                  <span className="ml-2 text-green-600">· Complete</span>
                )}
              </span>
              <button
                onClick={handleCopy}
                className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
              >
                Copy
              </button>
            </div>

            {/* Code output */}
            <div
              ref={outputRef}
              className="flex-1 overflow-auto p-4 text-sm font-mono text-gray-800 whitespace-pre-wrap leading-relaxed"
              style={{ maxHeight: "60vh" }}
            >
              {output}
              {status === "streaming" && (
                <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {status === "idle" && !output && (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-16 text-gray-400">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 text-white text-xl"
              style={{ background: "var(--sitecore-red)" }}
            >
              ✦
            </div>
            <p className="text-sm font-medium text-gray-600">
              Paste a Figma URL to generate Sitecore components
            </p>
            <p className="text-xs mt-1">
              Razor views · Glass Mapper · Helix architecture · BEM CSS
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t px-6 py-3 text-xs text-gray-400 flex justify-between">
        <span>App ID: {MARKETPLACE_APP_ID}</span>
        <span>Kajoo AI · SUGCON Europe 2026</span>
      </footer>
    </div>
  );
}
