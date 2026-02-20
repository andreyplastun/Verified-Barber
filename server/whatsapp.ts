import { storage } from "./storage";
import { db } from "./db";
import { appConfig } from "@shared/schema";
import { eq } from "drizzle-orm";

const PRIMARY_TEMPLATES = [
  "{clientName}, спасибо за визит к {specialistName}.\nОставьте отзыв:\n{reviewLink}",
  "{clientName}, благодарим за визит к {specialistName} ✨\nБудем признательны за отзыв:\n{reviewLink}",
  "{clientName}, как прошёл визит к {specialistName}?\nОставить отзыв:\n{reviewLink}",
  "{clientName}, спасибо, что выбрали {specialistName}.\nПоделитесь впечатлением:\n{reviewLink}",
  "{clientName}, визит к {specialistName} завершён.\nОцените специалиста:\n{reviewLink}",
];

const REMINDER_TEMPLATES = [
  "{clientName}, отзыв о визите к {specialistName} ещё можно оставить:\n{reviewLink}",
  "{clientName}, напоминание об отзыве для {specialistName}.\nЭто займёт несколько секунд:\n{reviewLink}",
  "{clientName}, если удобно — оставьте отзыв о визите к {specialistName}:\n{reviewLink}",
  "{clientName}, оценка визита к {specialistName} всё ещё доступна:\n{reviewLink}",
  "{clientName}, последняя возможность оценить визит к {specialistName}:\n{reviewLink}",
];

function getTemplates(type: "primary" | "reminder"): string[] {
  return type === "primary" ? PRIMARY_TEMPLATES : REMINDER_TEMPLATES;
}

function renderTemplate(template: string, vars: { clientName: string; specialistName: string; reviewLink: string }): string {
  return template
    .replace(/\{clientName\}/g, vars.clientName)
    .replace(/\{specialistName\}/g, vars.specialistName)
    .replace(/\{reviewLink\}/g, vars.reviewLink);
}

function pickTemplateIndex(type: "primary" | "reminder", lastIndex: number | null): number {
  const templates = getTemplates(type);
  const count = templates.length;
  let idx: number;
  do {
    idx = Math.floor(Math.random() * count);
  } while (idx === lastIndex && count > 1);
  return idx;
}

export async function getWaSettings(): Promise<{
  enabled: boolean;
  warmupStartDate: string;
  dailyLimit: number;
}> {
  const rows = await db.select().from(appConfig);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    enabled: map["WA_SENDING_ENABLED"] === "true",
    warmupStartDate: map["WA_WARMUP_START_DATE"] || "",
    dailyLimit: parseInt(map["WA_DAILY_LIMIT"] || "20", 10),
  };
}

export async function setWaSetting(key: string, value: string): Promise<void> {
  await db.insert(appConfig).values({ key, value })
    .onConflictDoUpdate({ target: appConfig.key, set: { value } });
}

function getWarmupDailyLimit(warmupStartDate: string, configLimit: number): number {
  if (!warmupStartDate) return configLimit;
  const start = new Date(warmupStartDate);
  start.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const daysSinceStart = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  if (daysSinceStart < 1) return 0;
  if (daysSinceStart <= 3) return Math.min(2, configLimit);
  if (daysSinceStart <= 7) return Math.min(5, configLimit);
  if (daysSinceStart <= 14) return Math.min(10, configLimit);
  return Math.min(20, configLimit);
}

function randomInterval(minMin: number, maxMin: number): number {
  return (minMin + Math.random() * (maxMin - minMin)) * 60 * 1000;
}

async function sendViaWhatsAppAPI(phone: string, text: string): Promise<void> {
  const token = process.env.WA_ACCESS_TOKEN;
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("WhatsApp API not configured (WA_ACCESS_TOKEN / WA_PHONE_NUMBER_ID missing)");
  }

  const cleanPhone = phone.replace(/\D/g, "");

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "text",
        text: { body: text },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${body}`);
  }

  console.log(`[WA_SEND] Sent to ${cleanPhone} via WhatsApp API`);
}

export async function enqueueReviewMessage(params: {
  bookingId: number;
  specialistId: number;
  customerPhone: string;
  customerName: string;
  specialistName: string;
  reviewLink: string;
  messageType: "primary" | "reminder";
  delayMs?: number;
}): Promise<void> {
  const existing = await storage.getWaMessageByBookingAndType(params.bookingId, params.messageType);
  if (existing) {
    console.log(`[WA_QUEUE] Skipping duplicate ${params.messageType} for booking=${params.bookingId}`);
    return;
  }

  const isOptedOut = await storage.isWaOptedOut(params.customerPhone.replace(/\D/g, ""));
  if (isOptedOut) {
    console.log(`[WA_QUEUE] Skipping ${params.messageType} for booking=${params.bookingId}: phone opted out`);
    return;
  }

  const lastIndex = await storage.getLastSentTemplateIndex(params.messageType);
  const templateIndex = pickTemplateIndex(params.messageType, lastIndex);
  const templates = getTemplates(params.messageType);
  const messageText = renderTemplate(templates[templateIndex], {
    clientName: params.customerName,
    specialistName: params.specialistName,
    reviewLink: params.reviewLink,
  });

  const scheduledAt = new Date(Date.now() + (params.delayMs || 0));

  await storage.enqueueWaMessage({
    bookingId: params.bookingId,
    specialistId: params.specialistId,
    customerPhone: params.customerPhone.replace(/\D/g, ""),
    customerName: params.customerName,
    specialistName: params.specialistName,
    reviewLink: params.reviewLink,
    messageType: params.messageType,
    templateIndex,
    messageText,
    scheduledAt,
  });
}

export async function processWaQueue(): Promise<void> {
  const settings = await getWaSettings();

  if (!settings.enabled) {
    return;
  }

  const effectiveLimit = getWarmupDailyLimit(settings.warmupStartDate, settings.dailyLimit);
  if (effectiveLimit <= 0) {
    console.log("[WA_PROCESSOR] Warmup not started yet, skipping");
    return;
  }

  const sentToday = await storage.countWaMessagesSentToday();
  const remaining = effectiveLimit - sentToday;
  if (remaining <= 0) {
    console.log(`[WA_PROCESSOR] Daily limit reached (${sentToday}/${effectiveLimit}), skipping`);
    return;
  }

  const batch = await storage.getWaMessagesDue(Math.min(remaining, 5));
  if (batch.length === 0) return;

  console.log(`[WA_PROCESSOR] Processing ${batch.length} messages (sent today: ${sentToday}/${effectiveLimit})`);

  for (let i = 0; i < batch.length; i++) {
    const msg = batch[i];

    const isOptedOut = await storage.isWaOptedOut(msg.customerPhone);
    if (isOptedOut) {
      await storage.markWaMessageSkipped(msg.id, "opt_out");
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=opt_out`);
      continue;
    }

    const booking = await storage.getBooking(msg.bookingId);
    if (!booking) {
      await storage.markWaMessageSkipped(msg.id, "booking_not_found");
      continue;
    }
    if (booking.hasReview) {
      await storage.markWaMessageSkipped(msg.id, "review_already_submitted");
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=review_already_submitted`);
      continue;
    }
    if (booking.status === "cancelled") {
      await storage.markWaMessageSkipped(msg.id, "booking_cancelled");
      console.log(`[WA_PROCESSOR] Skipped msg=${msg.id} reason=booking_cancelled`);
      continue;
    }

    await storage.markWaMessageSending(msg.id);

    try {
      await sendViaWhatsAppAPI(msg.customerPhone, msg.messageText);
      await storage.markWaMessageSent(msg.id);
      console.log(`[WA_PROCESSOR] Sent msg=${msg.id} type=${msg.messageType} booking=${msg.bookingId} template=${msg.templateIndex}`);

      if (msg.messageType === "primary") {
        const reminderDelay = 24 * 60 * 60 * 1000 + randomInterval(0, 60);
        await enqueueReviewMessage({
          bookingId: msg.bookingId,
          specialistId: msg.specialistId,
          customerPhone: msg.customerPhone,
          customerName: msg.customerName,
          specialistName: msg.specialistName,
          reviewLink: msg.reviewLink,
          messageType: "reminder",
          delayMs: reminderDelay,
        });
        console.log(`[WA_PROCESSOR] Scheduled reminder for booking=${msg.bookingId} in ~24h`);
      }
    } catch (err: any) {
      const retryDelayMs = randomInterval(10, 30);
      const nextScheduledAt = new Date(Date.now() + retryDelayMs);
      await storage.markWaMessageFailed(msg.id, err.message, nextScheduledAt);
      console.error(`[WA_PROCESSOR] Failed msg=${msg.id} error=${err.message} attempt=${msg.attempts + 1}/${msg.maxAttempts}`);
    }

    if (i < batch.length - 1) {
      const jitterMs = randomInterval(3, 15);
      console.log(`[WA_PROCESSOR] Waiting ${Math.round(jitterMs / 60000)}min before next message`);
      await new Promise(resolve => setTimeout(resolve, jitterMs));
    }
  }
}
