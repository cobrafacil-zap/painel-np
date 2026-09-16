import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Cliente Supabase para uso no servidor (Server Components, Route Handlers, Server Actions).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll chamado de Server Component é ignorado quando há middleware
          }
        },
      },
    }
  );
}

/**
 * Cliente Supabase com service_role (server-only, bypassa RLS).
 * Use APENAS em Route Handlers/API para operações confiáveis (ex: webhook).
 */
export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    }
  );
}

/**
 * Retorna o usuário autenticado e seu profile.
 * Redireciona para /login se não houver.
 */
export async function requireUser(): Promise<{ userId: string; email: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  return { userId: user.id, email: user.email ?? null };
}
