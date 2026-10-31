import type { LabelHit } from "@/lib/types";
import {
  labelById,
  PROMPT_SPANS,
  SPECIFICITY_HAIR,
} from "@/lib/vocabulary";

/** One concept after its prompt scores have been averaged. */
export type ConceptScore = {
  id: string;
  name: string;
  score: number;
};

/**
 * Average the raw prompt logits that belong to each concept. Averaging
 * happens before the winner is chosen, so a concept with several prompts is
 * not diluted by a softmax over every sentence.
 */
export function scoresFromPromptLogits(logits: ArrayLike<number>): ConceptScore[] {
  return PROMPT_SPANS.map((span) => {
    let sum = 0;
    for (let index = 0; index < span.count; index += 1) {
      sum += Number(logits[span.start + index] ?? 0);
    }
    return {
      id: span.id,
      name: span.name,
      score: span.count === 0 ? 0 : sum / span.count,
    };
  });
}

/**
 * Combine per-frame concept scores. The median is used so one odd frame
 * cannot pull the decision on its own. Two frames fall back to their mean.
 */
export function combineFrameScores(frames: ConceptScore[][]): ConceptScore[] {
  if (frames.length === 0) {
    throw new Error("The model returned no label.");
  }
  if (frames.length === 1) return frames[0];
  return frames[0].map((concept) => {
    const values = frames
      .map((frame) => frame.find((entry) => entry.id === concept.id)?.score ?? 0)
      .sort((left, right) => left - right);
    const mid = Math.floor(values.length / 2);
    const score =
      values.length % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    return { id: concept.id, name: concept.name, score };
  });
}

function isMoreSpecific(specificId: string, vagueId: string): boolean {
  return labelById(specificId)?.moreSpecificThan?.includes(vagueId) ?? false;
}

/**
 * Pick the winning concept. When the top score is only a hair above the
 * runner-up and the runner-up is a more specific child of that leader
 * (fish under animal, diving under water, boat under vehicle), prefer the
 * child.
 */
export function chooseConcept(scores: ConceptScore[]): LabelHit {
  if (scores.length === 0) {
    throw new Error("The model returned no label.");
  }
  const ranked = [...scores].sort((left, right) => right.score - left.score);
  let winner = ranked[0];
  const runner = ranked[1];
  if (runner && winner.score - runner.score <= SPECIFICITY_HAIR && isMoreSpecific(runner.id, winner.id)) {
    winner = runner;
  }
  return { id: winner.id, name: winner.name, score: winner.score };
}
