import { Link } from 'react-router-dom';
import { MonitorSmartphoneIcon } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { ProfileSettings } from '../components/settings/ProfileSettings';
import { AppearanceSettings } from '../components/settings/AppearanceSettings';
import { ChangePassword } from '../components/security/ChangePassword';
import { TotpEnrollment } from '../components/security/TotpEnrollment';
import { BackupCodes } from '../components/security/BackupCodes';
import { useAuth } from '../contexts/AuthContext';

/** The signed-in member's own profile, preferences and sign-in security. Every role. */
export function Settings() {
  const { session, member } = useAuth();
  if (!session || !member) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Your profile, availability, notifications and sign-in security. Profile changes are saved to your account; theme and language are remembered in this browser."
        actions={
          <Link
            to="/sessions"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[12.5px] font-medium text-ink hover:border-line-strong hover:bg-sunken/60"
          >
            <MonitorSmartphoneIcon className="h-3.5 w-3.5" aria-hidden />
            Sessions & devices
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="settings-profile" className="min-w-0 space-y-4">
          <h2 id="settings-profile" className="text-[13px] font-semibold text-ink">
            Profile and preferences
          </h2>
          {/* Keyed by member so a different account never inherits another's draft. */}
          <ProfileSettings key={member.id} />
          <AppearanceSettings />
        </section>

        <section aria-labelledby="settings-security" className="min-w-0 space-y-4">
          <h2 id="settings-security" className="text-[13px] font-semibold text-ink">
            Security
          </h2>
          <ChangePassword />
          <TotpEnrollment />
          <BackupCodes />
        </section>
      </div>
    </div>
  );
}
