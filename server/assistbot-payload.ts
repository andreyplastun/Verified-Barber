type Direction = "incoming" | "outgoing" | "unknown";
export interface AssistBotMessage {
  id: string | null;
  chatId: string | null;
  text: string;
  phone: string | null;
  recipientPhone: string | null;
  instanceId: string | null;
  direction: Direction;
}
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const nonEmpty = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

// A personal chat ID is not evidence of direction or of the specialist's identity.
function personalPhone(v: unknown): string | null {
  const s = nonEmpty(v);
  if (!s) return null;
  const match = s.match(/^\+?(\d{10,15})(?:@(?:c\.us|s\.whatsapp\.net))?$/);
  return match?.[1] || null;
}

export function parseAssistBotPayload(input: unknown) {
  const root = object(input);
  const messages: AssistBotMessage[] = [];
  let ignored = 0;
  const batch = root && Array.isArray(root.messages) ? root.messages : root ? [root] : [];
  for (const raw of batch.slice(0, 100)) {
    const row = object(raw);
    if (!row) { ignored++; continue; }
    const legacy = !Array.isArray(root?.messages);
    const text = nonEmpty(legacy ? row.text : row.body);
    // Media captions, status updates and groups must not trigger visit handling.
    if (!text || (!legacy && row.type !== "chat" && row.type !== "text")) {
      ignored++; continue;
    }
    const chatId = nonEmpty(row.chatId);
    if (chatId && !personalPhone(chatId)) { ignored++; continue; }
    const fromMeDirection: Direction = row.fromMe === true ? "outgoing" : row.fromMe === false ? "incoming" : "unknown";
    const explicit: Direction = row.direction === "incoming" || row.direction === "outgoing" ? row.direction : "unknown";
    const direction = fromMeDirection !== "unknown" && explicit !== "unknown" && fromMeDirection !== explicit
      ? "unknown" : fromMeDirection !== "unknown" ? fromMeDirection : explicit;
    const recipientPhone = personalPhone(
      row.recipientPhone || row.instancePhone || row.accountPhone || row.to ||
      root?.recipientPhone || root?.instancePhone || root?.accountPhone,
    );
    messages.push({
      id: nonEmpty(row.id),
      chatId,
      text,
      phone: personalPhone(legacy ? row.phone : chatId),
      recipientPhone,
      instanceId: nonEmpty(row.instanceId || row.accountId || root?.instanceId || root?.accountId),
      direction: legacy ? "incoming" : direction,
    });
  }
  return { messages, ignored, truncated: batch.length > 100 };
}

export function summarizeAssistBotPayload(input: unknown) {
  const parsed = parseAssistBotPayload(input);
  return {
    parsed: parsed.messages.length,
    ignored: parsed.ignored,
    truncated: parsed.truncated,
    incoming: parsed.messages.filter(m => m.direction === "incoming").length,
    outgoing: parsed.messages.filter(m => m.direction === "outgoing").length,
    unknownDirection: parsed.messages.filter(m => m.direction === "unknown").length,
    withPhone: parsed.messages.filter(m => m.phone).length,
    withMessageId: parsed.messages.filter(m => m.id).length,
  };
}