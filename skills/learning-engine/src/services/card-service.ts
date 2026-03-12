import { cardRepo } from "../db/repositories/card-repo.ts";
import type { CardCandidate } from "../schemas/card-candidate.schema.ts";
import { THRESHOLDS } from "../core/config.ts";

const MAX_CARDS_PER_CONCEPT = THRESHOLDS.MAX_CARDS_PER_CONCEPT;

function createCards(candidates: CardCandidate[]) {
  const results = [];

  for (const c of candidates) {
    const existing = cardRepo.findByDedupKey(c.dedup_key);
    if (existing) {
      results.push({ dedup_key: c.dedup_key, status: "DUPLICATE" });
      continue;
    }

    const count = cardRepo.countByConcept(c.concept_id);
    if (count >= MAX_CARDS_PER_CONCEPT) {
      results.push({ dedup_key: c.dedup_key, status: "LIMIT_REACHED" });
      continue;
    }

    const id = crypto.randomUUID();
    cardRepo.create({
      id,
      concept_id: c.concept_id,
      card_type: c.card_type,
      front: c.front,
      back: c.back,
      dedup_key: c.dedup_key,
      priority: c.priority,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    results.push({ dedup_key: c.dedup_key, status: "CREATED", id });
  }

  return results;
}

function countByConcept(conceptId: string) {
  return cardRepo.countByConcept(conceptId);
}

function archiveCard(cardId: string) {
  cardRepo.update(cardId, { status: "ARCHIVED", updated_at: new Date().toISOString() });
  return { cardId, status: "ARCHIVED" };
}

export const cardService = { createCards, countByConcept, archiveCard };
