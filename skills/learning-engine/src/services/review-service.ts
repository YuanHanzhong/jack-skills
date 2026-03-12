import { reviewRepo } from "../db/repositories/review-repo.ts";

function scheduleReview(cardId: string, scheduledAt: string, priority: "P0" | "P1" | "P2" | "P3") {
  const id = crypto.randomUUID();
  reviewRepo.create({
    id,
    card_id: cardId,
    scheduled_at: scheduledAt,
    priority,
    status: "PENDING",
    created_at: new Date().toISOString(),
  });
  return { id, cardId, scheduledAt, status: "SCHEDULED" };
}

function getDueReviews(beforeDate?: string) {
  const cutoff = beforeDate ?? new Date().toISOString();
  return reviewRepo.findDue(cutoff);
}

export const reviewService = { scheduleReview, getDueReviews };
