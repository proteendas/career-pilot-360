import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      emailVerified: boolean;
      onboarded: boolean;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    emailVerified?: boolean;
    onboarded?: boolean;
  }
}
