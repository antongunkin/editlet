import { useState } from 'react';

import { AccountView } from './AccountView';
import { useThemeChoice } from './settings';

import { entryFilePath } from '../../../core/paths';
import { useSchema } from '../data/queries';
import { useAuth } from '../github/auth';
import { approvalText, useCodeowners } from '../github/style';
import { useGitHubUser, type GitHubUser } from '../github/user';
import { useWorkspace } from '../github/workspace';
import { Avatar } from '../ui/primitives/avatar';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { useBridge } from '../useRoute';

/**
 * The header's account button and the sheet it opens (docs/admin/account.md): in GitHub mode the avatar (*Account*:
 * who, role, Appearance, Reviewers, Sign out), in dev mode a palette icon (*Appearance*: there is no account).
 */
export function AccountButton() {
  const user = useGitHubUser();
  return user ? <SignedIn user={user} /> : <Local />;
}

function Local() {
  return <Entry sub="Local files" />;
}

function SignedIn({ user }: { user: GitHubUser }) {
  const workspace = useWorkspace();
  const { signOut } = useAuth();
  const { canLeave } = useBridge();
  const schema = useSchema().data?.schema;
  const rules = useCodeowners();
  // Who must approve a content change: the owners of one entry file of every collection. Hidden until `CODEOWNERS` is
  // read (and when it cannot be): the sheet never says something untrue.
  const reviewers =
    rules && schema
      ? (approvalText(
          Object.keys(schema.collections).map((key) => entryFilePath(schema, key, 'entry')),
          rules,
        ) ?? 'No code owners set for content')
      : undefined;
  return (
    <Entry
      user={user}
      sub={workspace ? `${workspace.config.owner}/${workspace.config.repo}` : 'GitHub'}
      reviewers={reviewers}
      onSignOut={() => canLeave() && signOut()}
    />
  );
}

function Entry({
  user,
  sub,
  reviewers,
  onSignOut,
}: {
  user?: GitHubUser;
  sub: string;
  reviewers?: string;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [appearance, setAppearance] = useThemeChoice();
  return (
    <>
      {user ? (
        <IconButton
          variant="account"
          label="Account"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          icon={<Avatar src={user.avatarUrl} name={user.login} />}
        />
      ) : (
        <IconButton
          label="Appearance"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          icon={<Icon name="palette" size={20} />}
        />
      )}
      <AccountView
        open={open}
        onOpenChange={setOpen}
        sub={sub}
        user={user}
        appearance={appearance}
        onAppearance={setAppearance}
        reviewers={reviewers}
        onSignOut={onSignOut}
      />
    </>
  );
}
