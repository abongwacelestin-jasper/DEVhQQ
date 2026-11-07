/**
 * Password policy for accounts being activated (accept-invite) or reset
 * (recovery). These rules mirror the checklist the accept-invite and
 * reset-password screens show; the server is the authority.
 *
 * Single source of truth — import it rather than copying it.
 */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 12) return 'Use at least 12 characters.';
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password))
    return 'Include both upper and lower case letters.';
  if (!/\d/.test(password)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include at least one symbol.';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 3 && password.toLowerCase().includes(local))
    return 'Do not include the name from your email address.';
  return null;
}
