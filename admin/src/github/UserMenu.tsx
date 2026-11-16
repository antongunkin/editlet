import { useState } from 'react';

import { useAuth } from './auth';
import { useGitHubUser } from './user';

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useBridge } from '../useRoute';

const ROLE_HINT = {
  admin: 'You can change content, the schema and code. GitHub rules still decide what needs review.',
  editor: 'You can change content. GitHub rules decide who reviews and merges your pull requests.',
} as const;

/** The signed-in GitHub account, its role and Sign out (asks the unsaved-changes guard first). */
export function UserMenu() {
  const user = useGitHubUser();
  const { signOut } = useAuth();
  const { canLeave } = useBridge();
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  if (!user) return null;
  return (
    <div className="editlet-user-menu" title={user.login}>
      {brokenAvatar === user.avatarUrl ? (
        <span className="editlet-user-menu__avatar editlet-user-menu__avatar--fallback" aria-hidden>
          {user.login.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          className="editlet-user-menu__avatar"
          src={user.avatarUrl}
          alt=""
          width={24}
          height={24}
          onError={() => setBrokenAvatar(user.avatarUrl)}
        />
      )}
      <span className="editlet-user-menu__login">{user.login}</span>
      <span className="editlet-user-menu__role" title={ROLE_HINT[user.role]}>
        {user.role === 'admin' ? 'Admin' : 'Editor'}
      </span>
      <Button variant="ghost" size="sm" icon={<Icon.LogOut />} title="Sign out" onClick={() => canLeave() && signOut()}>
        Sign out
      </Button>
    </div>
  );
}
