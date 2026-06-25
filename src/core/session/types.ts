export type ParticipantType = "persona" | "client";

export interface Participant {
  type: ParticipantType;
  name: string;
}

export type MessageRole =
  | "system"
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string;
  type?: string;
  created_at: string;
}

export interface Schedule {
  id: string;
  trigger_at: string;
  content: string;
  status: "pending" | "done" | "cancelled";
}

export interface SessionMeta {
  id: string;
  creator: string;
  participants: Participant[];
  created_at: string;
  archive_at: string | null;
  archived_at: string | null;
  classification: string | null;
}

export interface SessionInfo extends SessionMeta {
  path: string;
  archived: boolean;
}

export interface CreateSessionOptions {
  creator: string;
  participants?: Participant[];
  archiveAfterDays?: number | null;
  classification?: string | null;
}
