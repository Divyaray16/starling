export type MediaKind = "photo" | "video";

export type QueueItem = {
  id: string;
  name: string;
  kind: MediaKind;
  thumbUrl: string;
  classifyBlob: Blob;
};

export type LandedTile = {
  id: string;
  name: string;
  kind: MediaKind;
  thumbUrl: string;
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
