import { useId, type ReactNode } from 'react';

import { THEME_CHOICES, type ThemeChoice } from './settings';

import { StaticRow } from '../screens/RouteRow';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { Sheet } from '../ui/parts/sheet';
import { Avatar } from '../ui/primitives/avatar';
import { Badge } from '../ui/primitives/badge';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { Tabs, TabsList, TabsTrigger } from '../ui/primitives/tabs';

// The account as the design draws it (FigCraft *Account*, *Appearance · dev*): who, the role, Appearance, Reviewers and
// Sign out; in dev mode only Appearance. Props only: `AccountButton` has the data, and /design renders it from
// fixtures (src/design/fixtures/account.tsx).

export interface AccountViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account's `owner/repo` (GitHub mode) or *Local files* (dev mode): the line under the title. */
  sub: string;
  /** Who is signed in; leave it out in dev mode (there is no account, only Appearance). */
  user?: { login: string; avatarUrl?: string; role: 'admin' | 'editor' };
  appearance: ThemeChoice;
  onAppearance: (choice: ThemeChoice) => void;
  /** The Reviewers row's second line; `undefined` leaves the row out (loading, unreadable, dev mode). */
  reviewers?: string;
  /** Sign out (GitHub mode); without it the sheet has no bottom bar. */
  onSignOut?: () => void;
}

const ROLE_HINT = {
  admin: 'You can change content, the schema and code. GitHub rules still decide what needs review.',
  editor: 'You can change content. GitHub rules decide who reviews and merges your pull requests.',
} as const;

export function AccountView({
  open,
  onOpenChange,
  sub,
  user,
  appearance,
  onAppearance,
  reviewers,
  onSignOut,
}: AccountViewProps) {
  const label = useId();
  const who: ReactNode = user ? (
    <>
      <Avatar size="large" src={user.avatarUrl} name={user.login} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-lg font-semibold" data-editlet="user-login">
          {user.login}
        </span>
        <span className="text-sm text-tray-muted-foreground">Signed in with GitHub</span>
      </div>
      <Badge tone="success" dot={false}>
        {user.role === 'admin' ? 'Admin' : 'Editor'}
      </Badge>
    </>
  ) : (
    <>
      <Avatar size="large" name="Local files" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-lg font-semibold">Local files</span>
        <span className="text-sm text-tray-muted-foreground">Dev server · edits are written to disk</span>
      </div>
    </>
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={user ? 'Account' : 'Appearance'}
      sub={sub}
      bar={
        onSignOut ? (
          <BottomBar>
            <Button variant="secondary" size="lg" full icon={<Icon name="logout" />} onClick={onSignOut}>
              Sign out
            </Button>
          </BottomBar>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-4">{who}</div>
          {user ? <p className="m-0 text-sm text-tray-muted-foreground">{ROLE_HINT[user.role]}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <span id={label} className="text-sm font-medium text-tray-muted-foreground">
            Appearance
          </span>
          <Tabs value={appearance} onValueChange={(next) => onAppearance(next as ThemeChoice)}>
            <TabsList aria-labelledby={label} activateOnFocus>
              {THEME_CHOICES.map((choice) => (
                <TabsTrigger key={choice.id} value={choice.id}>
                  {choice.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {reviewers !== undefined ? (
          <Card as="ul" aria-label="Reviewers">
            <li>
              <StaticRow lead="pr" title="Reviewers" sub={reviewers} />
            </li>
          </Card>
        ) : null}
      </div>
    </Sheet>
  );
}
