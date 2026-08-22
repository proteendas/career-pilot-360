import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { exportVersionPdf, getGeneratedPdf, slugify, getVersion } from '@/lib/resume/service';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Download a version's PDF.
 *
 * Objects are stored privately, so bytes are streamed through this
 * authenticated route rather than exposing a provider URL. If no PDF has been
 * rendered yet, one is generated on demand — a download link should never 404
 * simply because the user has not pressed "export" first.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ versionId: string }> }) {
  try {
    const user = await requireUser();
    const { versionId } = await ctx.params;

    let pdf = await getGeneratedPdf(user.id, versionId);
    if (!pdf) {
      const version = await getVersion(user.id, versionId);
      const generated = await exportVersionPdf(user.id, versionId, { template: version.template as never });
      pdf = { bytes: generated.bytes, filename: `${slugify(version.name)}.pdf` };
    }

    return new NextResponse(pdf.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-length': String(pdf.bytes.byteLength),
        'content-disposition': `attachment; filename="${pdf.filename}"`,
        // Private: this is one user's document.
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[resume-pdf] unexpected failure', err);
    return NextResponse.json({ error: 'The PDF could not be produced.' }, { status: 500 });
  }
}
