export function SessionSummary({
  files,
  photos,
  videos,
  categories,
}: {
  files: number;
  photos: number;
  videos: number;
  categories: number;
}) {
  const figures = [
    { label: "Files", value: files },
    { label: "Photos", value: photos },
    { label: "Videos", value: videos },
    { label: "Categories", value: categories },
  ];

  return (
    <section
      className="mt-6 w-full max-w-lg @container rounded-[20px] border border-[#e3e8df] bg-white p-5 shadow-[0_14px_34px_-16px_rgba(60,68,62,0.34),0_2px_8px_rgba(60,68,62,0.06)]"
      data-session-summary
      data-summary-files={files}
      data-summary-photos={photos}
      data-summary-videos={videos}
      data-summary-categories={categories}
      aria-labelledby="session-summary-title"
    >
      <h2
        id="session-summary-title"
        className="m-0 text-[15px] leading-none font-medium tracking-[-0.01em] text-[#3c443e]"
      >
        This set
      </h2>
      <p className="mt-1.5 text-[13px] leading-snug text-[#6e7f68]">
        Photos, videos, and categories in this session
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-1 rounded-[16px] bg-[#e4ebe3] p-1 shadow-[inset_0_1px_2px_rgba(60,68,62,0.06)] @sm:grid-cols-4">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-[12px] bg-white px-2 py-3 text-center shadow-[0_1px_2px_rgba(60,68,62,0.08)]"
          >
            <dt className="text-[11px] leading-none whitespace-nowrap text-[#6e7f68]">
              {figure.label}
            </dt>
            <dd
              className="m-0 text-[1.55rem] leading-none font-semibold tracking-[-0.04em] whitespace-nowrap text-[#3c443e] tabular-nums"
              data-summary-value={figure.label.toLowerCase()}
            >
              {figure.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
