/**
 * Password policy for reset — a verbatim copy of `passwordProblem` in
 * routes/auth.routes.ts (accept-invite), which this lane may not edit.
 * Keep the two in lockstep; SEC may later extract a shared module and point
 * both callers at it.
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
