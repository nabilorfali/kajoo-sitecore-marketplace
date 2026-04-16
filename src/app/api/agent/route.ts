import { NextRequest } from "next/server";
import {
  getClient,
  createSession,
  sendMessage,
  openStream,
  streamSession,
} from "@/lib/agent-session";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { message, sessionId: existingSessionId } = await req.json();

  if (!message) {
    return new Response("message required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const client = getClient();

        // Reuse existing session for multi-turn, or create a new one
        const sessionId = existingSessionId ?? await createSession(client);
        send({ type: "session", sessionId });

        // Open stream BEFORE sending the message to avoid missing early events
        const agentStream = await openStream(client, sessionId);

        await sendMessage(client, sessionId, message);

        for await (const chunk of streamSession(client, sessionId, agentStream)) {
          send(chunk);
          if (chunk.type === "done" || chunk.type === "error") break;
        }
      } catch (err) {
        send({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
