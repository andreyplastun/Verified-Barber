import { summarizeAssistBotPayload } from "./assistbot-payload";
// Only allowlisted field names and types: even unknown JSON keys can contain PII.
const allowedKeys = new Set([
  "phone", "text", "from", "to", "sender", "recipient", "receiver",
  "sender_phone", "recipient_phone", "phone_number", "phone_number_id",
  "chat_id", "chatId", "conversation_id", "conversationId", "message_id",
  "messageId", "id", "direction", "type", "event", "timestamp", "date",
  "data", "payload", "message", "messages", "body", "contact", "contacts",
  "account_id", "accountId", "channel_id", "channelId", "instance_id",
  "metadata", "entry", "changes", "value", "destination_params",
  "fromMe", "author", "senderName", "chatName", "time", "isGroup",
  "instanceId", "wid", "ack", "isForwarded", "quotedMsgId",
]);
const sensitiveKey = /secret|token|password|authorization|cookie|api.?key/i;

export function describeAssistBotPayload(body: unknown) {
  const fields: { path: string; type: string; nonEmpty: boolean }[] = [];
  let unknownKeys = 0;
  let truncated = false;
  let visited = 0;
  function walk(value: unknown, path: string, depth: number) {
    if (++visited > 100 || depth > 5) { truncated = true; return; }
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    fields.push({
      path, type,
      nonEmpty: value !== null && value !== undefined && value !== "",
    });
    if (Array.isArray(value)) {
      if (value.length) walk(value[0], `${path}[]`, depth + 1);
    } else if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        if (visited >= 100) { truncated = true; break; }
        if (sensitiveKey.test(key)) continue;
        if (!allowedKeys.has(key)) { unknownKeys++; continue; }
        walk((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
      }
    }
  }
  walk(body, "$", 0);
  return { fields, unknownKeys, truncated };
}

// Bounded in-memory diagnostics; production logs retain the same sanitized record.
const recent: object[] = [];
let lastLogAt = 0;
let suppressed = 0;
export function recordAssistBotDiagnostic(body: unknown, authenticated: boolean) {
  const event = {
    receivedAt: new Date().toISOString(),
    authenticated,
    ...describeAssistBotPayload(body),
    parsing: summarizeAssistBotPayload(body),
  };
  recent.push(event);
  if (recent.length > 50) recent.shift();
  const now = Date.now();
  if (now - lastLogAt >= 5000) {
    console.log(`[ASSISTBOT_INCOMING_SHAPE] ${JSON.stringify({ ...event, suppressed })}`);
    lastLogAt = now;
    suppressed = 0;
  } else {
    suppressed++;
  }
}

export function getAssistBotDiagnostics() {
  return {
    retention: "Last 50 requests in this process; cleared on restart",
    events: [...recent],
  };
}