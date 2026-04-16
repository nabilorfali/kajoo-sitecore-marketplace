import Anthropic from "@anthropic-ai/sdk";
import type { BetaManagedAgentsStreamSessionEvents } from "@anthropic-ai/sdk/resources/beta/sessions/events";

export const AGENT_ID = "agent_011Ca79wnonGvfsqqUGKeRBE";
export const ENVIRONMENT_ID = "env_01CCCF2jLSb4XRMKpDb3StXL";
export const VAULT_ID = "vlt_011Ca7A1vQoRYGP2jc9vPTav";
export const MARKETPLACE_APP_ID = "dd2c230e-89cf-4c4d-9bb2-1ac6059e8be5";

export function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/**
 * Create a new agent session and return the session ID.
 */
export async function createSession(client: Anthropic) {
  const session = await client.beta.sessions.create({
    agent: AGENT_ID,
    environment_id: ENVIRONMENT_ID,
    vault_ids: [VAULT_ID],
    title: "Figma to Sitecore Session",
  });
  return session.id;
}

/**
 * Send a message to an existing session.
 */
export async function sendMessage(
  client: Anthropic,
  sessionId: string,
  text: string,
) {
  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text }],
      },
    ],
  });
}

/**
 * Stream session events and yield text chunks + status signals.
 * Yields:
 *   { type: "text",    text: string }
 *   { type: "warn",    text: string }
 *   { type: "done"                  }
 *   { type: "error",   text: string }
 */
export async function* streamSession(
  client: Anthropic,
  sessionId: string,
): AsyncGenerator<
  | { type: "text"; text: string }
  | { type: "warn"; text: string }
  | { type: "done" }
  | { type: "error"; text: string }
> {
  const stream = await client.beta.sessions.events.stream(sessionId);

  for await (const event of stream as AsyncIterable<BetaManagedAgentsStreamSessionEvents>) {
    switch (event.type) {
      case "agent.message":
        for (const block of event.content) {
          if (block.type === "text") yield { type: "text", text: block.text };
        }
        break;

      case "session.status_idle": {
        const reason = event.stop_reason;
        if (reason?.type === "requires_action") {
          // Auto-allow tool confirmations
          await client.beta.sessions.events.send(sessionId, {
            events: reason.event_ids.map((id) => ({
              type: "user.tool_confirmation" as const,
              tool_use_id: id,
              result: "allow" as const,
            })),
          });
        }
        if (reason?.type === "end_turn") {
          yield { type: "done" };
          return;
        }
        break;
      }

      case "session.status_terminated":
      case "session.deleted":
        yield { type: "done" };
        return;

      case "session.error": {
        const err = event.error;
        const isMcp =
          err.type === "mcp_connection_failed_error" ||
          err.type === "mcp_authentication_failed_error";

        if (isMcp && "mcp_server_name" in err) {
          yield {
            type: "warn",
            text: `MCP '${err.mcp_server_name}' unavailable — continuing without it.`,
          };
        } else {
          yield { type: "error", text: `${err.type}: ${err.message}` };
          return;
        }
        break;
      }

      // Silently ignore echoed user events and telemetry spans
      case "user.message":
      case "user.tool_confirmation":
      case "user.custom_tool_result":
      case "span.model_request_start":
      case "span.model_request_end":
        break;
    }
  }
}
