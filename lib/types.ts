export type MediaKind = "photo" | "video";

export type QueueItem = {
  id: string;
  name: string;
  kind: MediaKind;
  thumbUrl: string;
  classifyBlob: Blob;
  /** Original file. HEIC stays HEIC here; thumbUrl may be a JPEG preview. */
  file: File;
};

export type LandedTile = {
  id: string;
  name: string;
  kind: MediaKind;
  thumbUrl: string;
  file: File;
};

export type CategoryRow = {
  id: string;
  name: string;
  items: LandedTile[];
};

export type Point = {
  x: number;
  y: number;
};

export type ClassifierMode = "clip" | "fallback";

export type LabelHit = {
  id: string;
  name: string;
  score: number;
};
