'use client';

import { useState } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import type { ReactNode } from 'react';

export function AppShell({
  profile,
  topbar,
  children,
}: {
  profile: {
    full_name: string | null;
    email: string | null;
    evolution_instance_name: string | null;
  };
  topbar?: { title?: string; subtitle?: ReactNode; right?: ReactNode };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-dvh min-w-0 max-w-full flex">
      <Sidebar open={open} onClose={() => setOpen(false)} profile={profile} />

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar
          onOpenMenu={() => setOpen(true)}
          title={topbar?.title}
          subtitle={topbar?.subtitle}
          right={topbar?.right}
        />

        <main
          className="flex-1 px-4 sm:px-6 md:px-8 py-4 sm:py-6 md:py-8 min-w-0 max-w-full overflow-x-hidden"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
