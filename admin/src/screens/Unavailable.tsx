import type { ReactNode } from 'react';

import { StateView } from './StateView';

import type { IconName } from '../ui/primitives/icons';
import { useScreenChrome } from '../window/chrome';
import { GateFrame } from '../window/GateFrame';

/**
 * A full-page stop: the admin can't go on (not set up, no access, ...). `children` are the bottom bar's action (*Sign
 * out*, *Try again*); without them the screen has no bar. It is drawn in the window's frame, before the shell exists.
 */
export function Unavailable({
  title,
  text,
  icon = 'alert',
  tone = 'danger',
  children,
}: {
  title: string;
  text: ReactNode;
  icon?: IconName;
  tone?: 'neutral' | 'danger';
  children?: ReactNode;
}) {
  return (
    <GateFrame>
      <UnavailableScreen title={title} text={text} icon={icon} tone={tone}>
        {children}
      </UnavailableScreen>
    </GateFrame>
  );
}

function UnavailableScreen({
  title,
  text,
  icon,
  tone,
  children,
}: {
  title: string;
  text: ReactNode;
  icon: IconName;
  tone: 'neutral' | 'danger';
  children?: ReactNode;
}) {
  const chrome = useScreenChrome();
  return (
    <StateView title="Editlet" actions={chrome.windowActions} icon={icon} tone={tone} heading={title} text={text}>
      {children}
    </StateView>
  );
}
