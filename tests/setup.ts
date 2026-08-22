/**
 * Vitest global setup.
 *
 * Tests never touch a real provider, a real mailbox or the network. Anything
 * requiring outbound access is stubbed in the test that needs it.
 */
import { beforeEach, vi } from 'vitest';

// A deterministic 32-byte key so encryption tests are reproducible.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.AUTH_SECRET ??= 'test-secret-value-not-used-in-production';
process.env.EMAIL_PROVIDER ??= 'console';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';

beforeEach(() => {
  vi.restoreAllMocks();
});
