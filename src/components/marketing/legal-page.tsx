import * as React from 'react';
import Link from 'next/link';

/**
 * Shared shell for policy and reference pages: a narrow measure, a sticky
 * table of contents, and generous line height for long-form reading.
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: React.ReactNode;
  sections: { id: string; heading: string; body: React.ReactNode }[];
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
      <header className="mb-10 border-b border-line pb-8">
        <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">{title}</h1>
        <p className="mt-2 text-xs font-medium tracking-wide text-ink-4 uppercase">Last updated {updated}</p>
        <div className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-3">{intro}</div>
      </header>

      <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <p className="mb-2.5 text-[10px] font-semibold tracking-[0.12em] text-ink-4 uppercase">On this page</p>
          <ul className="space-y-1.5">
            {sections.map((s) => (
              <li key={s.id}>
                <Link
                  href={`#${s.id}`}
                  className="block rounded text-[13px] leading-snug text-ink-3 transition-colors hover:text-accent"
                >
                  {s.heading}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-10">
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="mb-3 text-xl font-semibold tracking-tight text-ink">{s.heading}</h2>
              <div className="space-y-3 text-[15px] leading-relaxed text-ink-2 [&_a]:text-accent [&_a:hover]:underline [&_li]:leading-relaxed [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
