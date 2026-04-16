import Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";

const AGENT_ID = "agent_011Ca79wnonGvfsqqUGKeRBE";
const ENVIRONMENT_ID = "env_01CCCF2jLSb4XRMKpDb3StXL";
const VAULT_ID = "vlt_011Ca7A1vQoRYGP2jc9vPTav";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function runAgent(userMessage: string): Promise<void> {
  // 1. Create session
  console.log("Creating session...");
  const session = await client.beta.sessions.create({
    agent: AGENT_ID,
    environment_id: ENVIRONMENT_ID,
    vault_ids: [VAULT_ID],
    title: "Figma to Sitecore Session",
  });
  console.log(`Session: ${session.id}\n`);

  // 2. Open stream before sending message
  const stream = await client.beta.sessions.events.stream(session.id);

  // 3. Send user message
  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: userMessage }],
      },
    ],
  });

  console.log(`Sent: "${userMessage}"\n`);

  // 4. Stream all events — log everything so we can see the auth flow
  for await (const event of stream as AsyncIterable<BetaManagedAgentsStreamSessionEvents>) {
    switch (event.type) {
      // ── Agent response ────────────────────────────────────────────
      case "agent.message":
        console.log("\n── Agent message ──");
        for (const block of event.content) {
          if (block.type === "text") process.stdout.write(block.text);
        }
        console.log("\n──────────────────");
        break;

      case "agent.thinking":
        console.log(`[thinking] ${JSON.stringify(event).slice(0, 120)}...`);
        break;

      // ── MCP tool calls ────────────────────────────────────────────
      case "agent.mcp_tool_use":
        console.log(`[mcp:tool_use] ${event.mcp_server_name} → ${event.name}`);
        console.log(`  input: ${JSON.stringify(event.input).slice(0, 200)}`);
        break;

      case "agent.mcp_tool_result":
        console.log(`[mcp:tool_result] id=${event.mcp_tool_use_id} error=${event.is_error ?? false}`);
        break;

      // ── Built-in tool calls ───────────────────────────────────────
      case "agent.tool_use":
        console.log(`[tool_use] ${event.name} — ${JSON.stringify(event.input).slice(0, 120)}`);
        break;

      case "agent.tool_result":
        console.log(`[tool_result] tool_use_id=${event.tool_use_id}`);
        break;

      // ── Session status ────────────────────────────────────────────
      case "session.status_running":
        console.log("[status] running");
        break;

      case "session.status_idle": {
        const reason = event.stop_reason;
        console.log(`\n[status] idle — stop_reason: ${JSON.stringify(reason)}`);

        // If idle because a tool needs confirmation, auto-allow
        if (reason?.type === "requires_action") {
          console.log(`  Requires action for event_ids: ${reason.event_ids.join(", ")}`);
          console.log("  → auto-allowing all pending tool confirmations...");
          await client.beta.sessions.events.send(session.id, {
            events: reason.event_ids.map((id) => ({
              type: "user.tool_confirmation" as const,
              tool_use_id: id,
              result: "allow" as const,
            })),
          });
        }

        // end_turn = agent finished naturally
        if (reason?.type === "end_turn") {
          console.log("[done]");
          return;
        }
        break;
      }

      case "session.status_terminated":
        console.log("[status] terminated");
        return;

      case "session.status_rescheduled":
        console.log("[status] rescheduled — retrying...");
        break;

      // ── Errors ────────────────────────────────────────────────────
      case "session.error": {
        const err = event.error;
        const isMcpError =
          err.type === "mcp_connection_failed_error" ||
          err.type === "mcp_authentication_failed_error";

        if (isMcpError && "mcp_server_name" in err) {
          // Non-fatal: MCP unavailable — warn and let the agent continue
          console.warn(
            `\n[warn] MCP '${err.mcp_server_name}' unavailable: ${err.message}`,
          );
          console.warn(
            `  Agent will continue without ${err.mcp_server_name} tools.\n`,
          );
        } else {
          // Fatal: billing, model overload, unknown — exit
          console.error(`\n[error] ${err.type}: ${err.message}`);
          process.exit(1);
        }
        break;
      }

      case "session.deleted":
        console.log("[session deleted]");
        return;

      // ── Spans (model usage telemetry) ─────────────────────────────
      case "span.model_request_start":
        console.log(`[span] model request start`);
        break;

      case "span.model_request_end":
        console.log(`[span] model request end`);
        break;

      // ── Echo of sent events (safe to ignore) ─────────────────────
      case "user.message":
      case "user.tool_confirmation":
      case "user.custom_tool_result":
        break;

      default:
        // Catch-all: log anything unrecognised for debugging
        console.log(`[unknown event] ${JSON.stringify(event, null, 2)}`);
    }
  }
}

const userPrompt =
  process.argv.slice(2).join(" ") ||
  "Hello! Can you introduce yourself and tell me what you can help me with?";

runAgent(userPrompt).catch((err: unknown) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
