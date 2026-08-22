import { desc, eq } from 'drizzle-orm';
import { Sidebar } from '@/components/app-shell/sidebar';
import { TopNav, type NotificationItem } from '@/components/app-shell/top-nav';
import { CommandPalette } from '@/components/app-shell/command-palette';
import { requireUserPage } from '@/lib/auth';
import { isDatabaseConfigured, getDb, notifications } from '@/lib/db';

async function loadNotifications(userId: string): Promise<NotificationItem[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const rows = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(12);
    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      href: n.href,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    }));
  } catch {
    return [];
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUserPage();
  const items = await loadNotifications(user.id);

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav user={user} notifications={items} />
        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
