import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { NotFoundError } from '@/lib/db/tenant';
import { getDocumentBytes } from '@/lib/resume/service';

export const runtime = 'nodejs';

/**
 * Download the ORIGINAL uploaded file, byte for byte.
 * The original is never modified, so this always returns exactly what the user
 * uploaded — which is the point of keeping it.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireUser();
    const { documentId } = await ctx.params;
    const doc = await getDocumentBytes(user.id, documentId);

    return new NextResponse(doc.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': doc.contentType,
        'content-length': String(doc.bytes.byteLength),
        'content-disposition': `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof NotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    console.error('[resume-document] unexpected failure', err);
    return NextResponse.json({ error: 'The file could not be read.' }, { status: 500 });
  }
}
