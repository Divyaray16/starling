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
 * Each concept has several full-sentence prompts. The classifier averages
 * their scores, so one phrasing does not decide. `moreSpecificThan` names the
 * vague parents: when this concept is only a hair behind one of them, it wins
 * (fish over animal, diving over water, a boat over a vehicle, and a fish or
 * a dive over a wreck that barely leads).
 */
export type ProvisionalLabel = {
  id: string;
  /** Short name shown on the category row. */
  name: string;
  /**
   * Full sentences given to the vision model. Averaged, not used as a
   * single keyword inside a shared template.
   */
  prompts: readonly string[];
  /**
   * Vague parents. If this concept is the runner-up and only a hair behind
   * one of these, prefer this concept.
   */
  moreSpecificThan?: readonly string[];
};

export const PROVISIONAL_VOCABULARY: readonly ProvisionalLabel[] = [
  {
    id: "portrait",
    name: "Portrait",
    prompts: [
      "a close-up portrait photograph of a human face",
      "a headshot of a person looking toward the camera",
      "a photographic portrait of a human person's face and shoulders",
    ],
  },
  {
    id: "food",
    name: "Food",
    prompts: [
      "a photograph of prepared food on a plate or table",
      "a meal or plated dish ready to eat",
      "a close photograph of cooked food, fruit, or dessert",
    ],
  },
  {
    id: "landscape",
    name: "Landscape",
    prompts: [
      "a landscape photograph of mountains, hills, or a wide natural view",
      "a scenic photograph of a mountain range or valley",
      "a wide outdoor photograph of peaks, ridges, and open countryside",
    ],
  },
  {
    id: "animal",
    name: "Animal",
    moreSpecificThan: ["portrait"],
    prompts: [
      "a close-up photograph of a cat",
      "a photograph of a dog, a cat, or a bird",
      "a furry pet or other land animal filling the frame",
    ],
  },
  {
    id: "fish",
    name: "Fish",
    moreSpecificThan: ["animal", "water", "wreck"],
    prompts: [
      "a photograph of fish swimming underwater",
      "a school of many fish swimming together",
      "hundreds of fish swimming in a dense school",
    ],
  },
  {
    id: "architecture",
    name: "Architecture",
    prompts: [
      "a photograph of a building, tower, or city architecture",
      "a tall building or skyscraper seen from outside",
      "the exterior of a landmark building or a city skyline",
    ],
  },
  {
    id: "street",
    name: "Street",
    prompts: [
      "a photograph of a busy city street or pedestrian crossing",
      "a city intersection full of people walking and traffic",
      "an urban street scene with crosswalks, signs, and storefronts",
    ],
  },
  {
    id: "screen",
    name: "Screen",
    prompts: [
      "a screenshot of a software user interface",
      "a screen capture of an application window with buttons and text",
      "a digital screenshot of a website or a desktop program",
    ],
  },
  {
    id: "document",
    name: "Document",
    prompts: [
      "a photograph of a printed document or a page of text",
      "a sheet of paper with writing, type, or a form",
      "paper documents laid out to be read",
    ],
  },
  {
    id: "plant",
    name: "Plant",
    prompts: [
      "a photograph of a plant, flower, or houseplant",
      "flowers or green leaves as the subject of the photo",
      "a close photograph of a blooming flower or foliage",
    ],
  },
  {
    id: "vehicle",
    name: "Vehicle",
    prompts: [
      "a photograph of a car driving or parked on a road",
      "a bicycle or a motorcycle on land",
      "a truck or a van on a street",
    ],
  },
  {
    id: "boat",
    name: "Boat",
    moreSpecificThan: ["vehicle", "animal", "water", "portrait", "crowd"],
    prompts: [
      "a photograph of a boat or ship on the water",
      "people standing on the deck of a boat",
      "a sailboat or motorboat with people aboard at sea",
    ],
  },
  {
    id: "wreck",
    name: "Wreck",
    moreSpecificThan: ["vehicle", "water", "architecture"],
    prompts: [
      "barnacle-covered ribs and plates of a sunken ship",
      "the collapsed rooms and corridors of a sunken ship",
      "a rusted shipwreck with its beams still visible",
    ],
  },
  {
    id: "diving",
    name: "Diving",
    moreSpecificThan: ["water", "animal", "portrait", "crowd", "wreck"],
    prompts: [
      "scuba divers underwater wearing masks and air tanks",
      "a group of scuba divers swimming underwater",
      "divers with fins and tanks swimming through blue water",
    ],
  },
  {
    id: "interior",
    name: "Interior",
    prompts: [
      "a photograph of an indoor room",
      "the inside of a house with furniture and walls",
      "an interior photograph of a kitchen, office, or living room",
    ],
  },
  {
    id: "water",
    name: "Water",
    prompts: [
      "a photograph of waves on the ocean with the horizon in view",
      "a lake or a river seen from the shore, above the water",
      "the surface of the sea under the open sky",
    ],
  },
  {
    id: "night",
    name: "Night",
    prompts: [
      "a photograph taken at night under a dark sky",
      "city lights against a black night sky",
      "an outdoor night scene lit by artificial lights",
    ],
  },
  {
    id: "crowd",
    name: "Crowd",
    prompts: [
      "a photograph of a dense crowd of people",
      "many people packed shoulder to shoulder at a gathering",
      "a large group of people filling the frame",
    ],
  },
  {
    id: "artwork",
    name: "Artwork",
    prompts: [
      "a painting, drawing, or piece of fine art",
      "a photograph of a painting on canvas",
      "an illustration, sketch, or museum artwork",
    ],
  },
  {
    id: "sky",
    name: "Sky",
    prompts: [
      "a photograph of the sky and clouds with little ground",
      "blue sky or a cloudy sky filling most of the frame",
      "a skyscape of clouds above a low horizon",
    ],
  },
] as const;

/**
 * If the leading averaged score is ahead of the runner-up by no more than
 * this, and the runner-up is a more specific child of the leader, the child
 * wins. Tuned for CLIP logits (cosine similarity times the model's scale).
 */
export const SPECIFICITY_HAIR = 0.55;

export type PromptSpan = {
  id: string;
  name: string;
  start: number;
  count: number;
};

export const PROMPT_TEXTS: readonly string[] = PROVISIONAL_VOCABULARY.flatMap(
  (label) => label.prompts,
);

export const PROMPT_SPANS: readonly PromptSpan[] = (() => {
  const spans: PromptSpan[] = [];
  let start = 0;
  for (const label of PROVISIONAL_VOCABULARY) {
    spans.push({
      id: label.id,
      name: label.name,
      start,
      count: label.prompts.length,
    });
    start += label.prompts.length;
  }
  return spans;
})();

export function labelByPrompt(prompt: string): ProvisionalLabel | undefined {
  return PROVISIONAL_VOCABULARY.find((label) => label.prompts.includes(prompt));
}

export function labelById(id: string): ProvisionalLabel | undefined {
  return PROVISIONAL_VOCABULARY.find((label) => label.id === id);
}
