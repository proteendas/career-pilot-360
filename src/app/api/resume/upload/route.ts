import { NextResponse } from 'next/server';
import { requireUser, UnauthorizedError } from '@/lib/auth';
import { enforceRateLimit, RateLimitError } from '@/lib/rate-limit';
import { RESUME_MAX_BYTES, SecurityError } from '@/lib/security';
import { loadProfile } from '@/lib/profile/service';
import { uploadResume } from '@/lib/resume/service';
import { ParseError } from '@/lib/resume/parse';
import { isDatabaseConfigured } from '@/lib/db';

// Node runtime: the parsers and storage drivers need Node APIs.
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Resume upload.
 *
 * A route handler rather than a server action because server actions cap
 * request bodies well below our file size limit, and multipart streaming is
 * the natural fit here.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!isDatabaseConfigured()) {
      return NextResponse.json({ ok: false, error: 'The database is not configured.' }, { status: 503 });
    }

    await enforceRateLimit('resumeUpload', user.id);

    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > RESUME_MAX_BYTES + 8192) {
      return NextResponse.json({ ok: false, error: 'Resume files must be 1 MB or smaller.' }, { status: 413 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'No file was received.' }, { status: 400 });
    }

    const rawName = form.get('name');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const profile = await loadProfile(user.id);

    const result = await uploadResume(
      user.id,
      { name: file.name, type: file.type, size: file.size },
      bytes,
      profile,
      {
        ...(typeof rawName === 'string' && rawName.trim() ? { name: rawName.trim() } : {}),
        ...(request.headers.get('x-request-id') ? { requestId: request.headers.get('x-request-id')! } : {}),
      },
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 401 });
    }
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: 429, headers: { 'retry-after': String(err.retryAfterSeconds) } },
      );
    }
    if (err instanceof SecurityError) {
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 400 });
    }
    if (err instanceof ParseError) {
      // The file was stored successfully; only parsing failed.
      return NextResponse.json({ ok: false, error: err.message, code: err.code }, { status: 422 });
    }
    console.error('[resume-upload] unexpected failure', err);
    return NextResponse.json({ ok: false, error: 'The upload could not be completed.' }, { status: 500 });
  }
}
