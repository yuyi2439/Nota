import React, { useState, useEffect, useCallback } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { WebSocket } from "ws";
import { HOST, PORT } from "../core/constants.js";

interface TuiOptions {
  sessionId?: string;
}

interface ChatMessage {
  role: string;
  content: string;
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const base = `http://${HOST}:${PORT}`;
  const wsBase = `ws://${HOST}:${PORT}`;

  const healthRes = await fetch(`${base}/health`).catch(() => null);
  if (!healthRes || !healthRes.ok) {
    console.error("[tui] daemon is not running. Start it with: nota daemon start");
    process.exit(1);
  }

  let sessionId = opts.sessionId;
  if (!sessionId) {
    const res = await fetch(`${base}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creator: "cli" }),
    });
    if (!res.ok) {
      console.error(`[tui] create session failed: ${res.status}`);
      process.exit(1);
    }
    const meta = (await res.json()) as { id: string };
    sessionId = meta.id;
    console.error(`[tui] new session ${sessionId}`);
  }

  const historyRes = await fetch(`${base}/session/${sessionId}`);
  if (historyRes.ok) {
    const data = (await historyRes.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    render(<App sessionId={sessionId!} wsBase={wsBase} base={base} initialMessages={data.messages} />);
  } else {
    render(<App sessionId={sessionId!} wsBase={wsBase} base={base} initialMessages={[]} />);
  }
}

interface AppProps {
  sessionId: string;
  wsBase: string;
  base: string;
  initialMessages: ChatMessage[];
}

function App({ sessionId, wsBase, base, initialMessages }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamBuffer, setStreamBuffer] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${wsBase}/?session=${sessionId}`);
    ws.on("open", () => {
      setWs(ws);
    });
    ws.on("message", (raw) => {
      const data = JSON.parse(raw.toString()) as { event: string; data: unknown };
      if (data.event === "delta") {
        const d = data.data as { delta: string };
        setStreaming(true);
        setStreamBuffer((b) => b + d.delta);
      } else if (data.event === "assistant_message") {
        const d = data.data as { message: { content: string } };
        setMessages((m) => [...m, { role: "assistant", content: d.message.content }]);
        setStreamBuffer("");
        setStreaming(false);
      } else if (data.event === "user_message") {
        const d = data.data as { content: string };
        setMessages((m) => [...m, { role: "user", content: d.content }]);
      } else if (data.event === "tool_result") {
        const d = data.data as { name: string; result: string };
        setMessages((m) => [...m, { role: "tool", content: `[${d.name}] ${d.result}` }]);
      } else if (data.event === "error") {
        const d = data.data as { message: string };
        setMessages((m) => [...m, { role: "error", content: d.message }]);
        setStreaming(false);
      }
    });
    ws.on("close", () => exit());
    return () => {
      ws.close();
    };
  }, [sessionId, wsBase, exit]);

  const sendMessage = useCallback(
    (content: string) => {
      if (!ws || streaming || !content) return;
      void fetch(`${base}/session/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    },
    [ws, base, sessionId, streaming],
  );

  useInput((key) => {
    if (streaming) return;
    if (key === "\r" || key === "\n") {
      if (input.startsWith("/")) {
        handleCommand(input, () => exit());
        setInput("");
        return;
      }
      setMessages((m) => [...m, { role: "user", content: input }]);
      sendMessage(input);
      setInput("");
      return;
    }
    if (key === "\u007F" || key === "\b") {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (key === "\u0003") {
      exit();
      return;
    }
    setInput((s) => s + key);
  });

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" paddingX={1}>
        <Text bold>Nota — session {sessionId.slice(0, 8)}</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
        {messages.map((m, i) => (
          <Box key={i} marginY={0}>
            <Text color={roleColor(m.role)} bold>
              {m.role === "user" ? "you" : m.role}:
            </Text>
            <Text> {m.content}</Text>
          </Box>
        ))}
        {streaming && (
          <Box>
            <Text color="yellow" bold>assistant:</Text>
            <Text> {streamBuffer}</Text>
          </Box>
        )}
      </Box>
      <Box borderStyle="single" paddingX={1}>
        <Text color="cyan">{streaming ? "…" : ">"} </Text>
        <Text>{input}</Text>
      </Box>
    </Box>
  );
}

function roleColor(role: string): string {
  switch (role) {
    case "user":
      return "green";
    case "assistant":
      return "blue";
    case "tool":
      return "gray";
    case "error":
      return "red";
    default:
      return "white";
  }
}

function handleCommand(input: string, exit: () => void): void {
  const cmd = input.slice(1).split(/\s+/);
  switch (cmd[0]) {
    case "quit":
    case "exit":
      exit();
      break;
    case "help":
      console.log("Commands: /new /sessions /switch <id> /archive <id> /restore <id> /tools /quit /clear");
      break;
    case "clear":
      console.clear();
      break;
    default:
      console.log(`[tui] unknown command: ${cmd[0]}`);
  }
}
