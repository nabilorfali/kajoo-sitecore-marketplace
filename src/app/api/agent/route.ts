import { NextRequest } from "next/server";
import {
  getClient,
  createSession,
  sendMessage,
  streamSession,
} from "@/lib/agent-session";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { figmaUrl, prompt } = await req.json();

  if (!figmaUrl && !prompt) {
    return new Response("figmaUrl or prompt required", { status: 400 });
  }

  const userMessage = figmaUrl
    ? `Please analyze this Figma design and generate production-ready Sitecore component code.

Figma URL: ${figmaUrl}

Generate:
1. Razor view (.cshtml) with Sitecore Glass Mapper or SXA conventions
2. Sitecore template definition with field types
3. Rendering parameter template
4. Component CSS/SCSS
5. Any datasource notes

Follow Sitecore Helix architecture (Feature layer). Use BEM class names.`
    : prompt;

  // Stream SSE back to the client
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const client = getClient();
        const sessionId = await createSession(client);
        send({ type: "session", sessionId });

        await sendMessage(client, sessionId, userMessage);

        for await (const chunk of streamSession(client, sessionId)) {
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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
