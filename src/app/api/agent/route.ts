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

const FIGMA_URL_RE = /https:\/\/(www\.)?figma\.com\/(design|file|proto)\/[a-zA-Z0-9]+/;

const MANIFEST_INSTRUCTIONS = `

After generating all the code, output a deployment manifest inside <deploy-manifest></deploy-manifest> XML tags with this exact JSON (no other text inside the tags):
{
  "componentName": "PascalCaseName",
  "helixLayer": "Feature",
  "module": "ModuleName",
  "fields": [
    { "name": "FieldName", "type": "Single-Line Text", "defaultValue": "Sample value" }
  ],
  "placeholder": "main",
  "renderingId": null
}
Use the correct Sitecore field types: Single-Line Text, Multi-Line Text, Rich Text, Image, General Link, Checkbox, Integer, Number, Date, DateTime.
Set realistic defaultValue strings so the content item has meaningful sample data.
If you know the Sitecore rendering item ID for this component type, set renderingId; otherwise leave it null.`;

export async function POST(req: NextRequest) {
  const { message, sessionId: existingSessionId } = await req.json();

  if (!message) {
    return new Response("message required", { status: 400 });
  }

  // Append manifest instructions when a Figma URL is present
  const enhancedMessage = FIGMA_URL_RE.test(message)
    ? message + MANIFEST_INSTRUCTIONS
    : message;

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
        const sessionId = existingSessionId ?? (await createSession(client));
        send({ type: "session", sessionId });

        // Open stream BEFORE sending the message to avoid missing early events
        const agentStream = await openStream(client, sessionId);

        await sendMessage(client, sessionId, enhancedMessage);

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
