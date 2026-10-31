/**
 * Provisional label vocabulary.
 *
 * This list is a starting point for zero-shot classification, not a fixed
 * board. The UI only shows a category after at least one file is actually
 * labeled with it, so a different folder can introduce categories that were
 * absent before. Edit the names and prompts here when the wording should
 * change; the rest of the app reads this module and does not hard-code a
 * category layout.
 *
 * The names are provisional. They are short labels a person can revise
 * without redesigning the sorter.
 */
export type ProvisionalLabel = {
  id: string;
  /** Short name shown on the category row. */
  name: string;
  /**
   * Sentence given to the vision model. Kept as a full phrase so the
   * classifier does not have to invent a template around a single word.
   */
  prompt: string;
};

export const PROVISIONAL_VOCABULARY: readonly ProvisionalLabel[] = [
  {
    id: "portrait",
    name: "Portrait",
    prompt: "a close-up portrait of a person's face",
  },
  {
    id: "food",
    name: "Food",
    prompt: "a plate or table of prepared food",
  },
  {
    id: "landscape",
    name: "Landscape",
    prompt: "a mountain landscape",
  },
  {
    id: "animal",
    name: "Animal",
    prompt: "a photograph of an animal",
  },
  {
    id: "architecture",
    name: "Architecture",
    prompt: "a tall building or city architecture",
  },
  {
    id: "street",
    name: "Street",
    prompt: "a busy city street crossing",
  },
  {
    id: "screen",
    name: "Screen",
    prompt: "a screenshot of a software user interface",
  },
  {
    id: "document",
    name: "Document",
    prompt: "a printed document or page of text",
  },
  {
    id: "plant",
    name: "Plant",
    prompt: "a photograph of a plant or flower",
  },
  {
    id: "vehicle",
    name: "Vehicle",
    prompt: "a photograph of a car or other vehicle",
  },
  {
    id: "interior",
    name: "Interior",
    prompt: "a photograph of an indoor room",
  },
  {
    id: "water",
    name: "Water",
    prompt: "a photograph of the ocean, a lake, or a river",
  },
  {
    id: "night",
    name: "Night",
    prompt: "a photograph taken at night",
  },
  {
    id: "crowd",
    name: "Crowd",
    prompt: "a photograph of a crowd of people",
  },
  {
    id: "artwork",
    name: "Artwork",
    prompt: "a painting or drawing",
  },
  {
    id: "sky",
    name: "Sky",
    prompt: "a photograph of the sky and clouds",
  },
] as const;

export function labelByPrompt(prompt: string): ProvisionalLabel | undefined {
  return PROVISIONAL_VOCABULARY.find((label) => label.prompt === prompt);
}

export function labelById(id: string): ProvisionalLabel | undefined {
  return PROVISIONAL_VOCABULARY.find((label) => label.id === id);
}
