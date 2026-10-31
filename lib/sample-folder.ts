/**
 * Small local sample set so the sorter can be tried before a personal folder
 * is chosen. The files live in /public/samples and are fetched like any other
 * folder: each one still goes through the same classifier and the same flock
 * animation. Names here are display names, not labels.
 */
const SAMPLE_FILES: { file: string; name: string; type: string }[] = [
  { file: "food.jpg", name: "market-table.jpg", type: "image/jpeg" },
  { file: "portrait.jpg", name: "portrait.jpg", type: "image/jpeg" },
  { file: "landscape.jpg", name: "matterhorn.jpg", type: "image/jpeg" },
  { file: "animal.jpg", name: "cat.jpg", type: "image/jpeg" },
  { file: "building.jpg", name: "empire-state.jpg", type: "image/jpeg" },
  { file: "street.jpg", name: "shibuya.jpg", type: "image/jpeg" },
  { file: "screen.png", name: "lab-notebook.png", type: "image/png" },
  { file: "crossing.mp4", name: "shibuya-crossing.mp4", type: "video/mp4" },
];

export async function loadSampleFolder(): Promise<{
  folderName: string;
  files: File[];
}> {
  const files = await Promise.all(
    SAMPLE_FILES.map(async (entry) => {
      const response = await fetch(`/samples/${entry.file}`);
      if (!response.ok) {
        throw new Error("The sample photos didn't load. Refresh and try again.");
      }
      const blob = await response.blob();
      const type = blob.type || entry.type;
      return new File([blob], entry.name, { type });
    }),
  );
  return { folderName: "Sample folder", files };
}
