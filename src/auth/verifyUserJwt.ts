import { createClient } from '@supabase/supabase-js';

export async function verifyUserJwt(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string
): Promise<{ userId: string } | null> {
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) return null;
  return { userId: data.user.id };
}
