export function extractAdminActor(req: any): string | undefined {
  const user = req?.session?.admin_user;
  if (typeof user === 'string' && user.trim()) return user.trim();
  if (user !== undefined && user !== null) return String(user);
  if (req?.session?.admin) return 'admin_session';
  return 'admin_token';
}

