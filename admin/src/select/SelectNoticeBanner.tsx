import type { SelectNotice } from './useApplySelect';

import { Button, Icon } from '../ui';

/**
 * The result of select-to-edit on the entry screen: found is only announced (the selection itself shows it), not
 * found is a banner the editor can dismiss. Both clear themselves after a few seconds.
 */
export function SelectNoticeBanner({ notice, dismiss }: { notice: SelectNotice | null; dismiss(): void }) {
  if (!notice) return null;
  if (notice.found)
    return (
      <p role="status" className="editlet-sr-only">
        {notice.text}
      </p>
    );
  return (
    <div className="editlet-card editlet-card--banner editlet-entry__issues" role="status">
      <Icon.Alert />
      <span className="editlet-u-flex-1">{notice.text}</span>
      <Button variant="outline" size="sm" onClick={dismiss}>
        OK
      </Button>
    </div>
  );
}
