import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { NotFoundError } from '@/lib/db/tenant';
import { generateVersionDocx } from '@/lib/resume/service';
import { RESUME_TEMPLATES } from '@/lib/resume/pdf';

export const runtime = 'nodejs';
export const maxDuration = 60;

const querySchema = z.object({
  template: z.enum(RESUME_TEMPLATES).optional(),
  margin: z.coerce.number().min(20).max(90).optional(),
  fontSize: z.coerce.number().min(8).max(12).optional(),
  lineSpacing: z.coerce.number().min(1).max(2).optional(),
  pageMode: z.enum(['single', 'multi']).optional(),
});

/**
 * Download a version's DOCX, in whatever template/options the query string
 * asks for (matching the same picker the PDF export uses) or, absent those,
 * whatever the PDF was last exported with. Generated fresh on every request
 * — see `generateVersionDocx`.
 */
export async function GET(request: Request, ctx: { params: Promise<{ versionId: string }> }) {
  try {
    const user = await requireUser();
    const { versionId } = await ctx.params;
    await enforceRateLimit('pdfExport', `docx:${user.id}`);

    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return NextResponse.json({ error: 'Those export options were not valid.' }, { status: 400 });

    const docx = await generateVersionDocx(user.id, versionId, parsed.data);

    return new NextResponse(docx.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-length': String(docx.bytes.byteLength),
        'content-disposition': `attachment; filename="${docx.filename}"`,
        // Private: this is one user's document.
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: 'Too many exports. Try again shortly.' },
        { status: 429, headers: { 'retry-after': String(err.retryAfterSeconds) } },
      );
    }
    console.error('[resume-docx] unexpected failure', err);
    return NextResponse.json({ error: 'The DOCX could not be produced.' }, { status: 500 });
  }
}
