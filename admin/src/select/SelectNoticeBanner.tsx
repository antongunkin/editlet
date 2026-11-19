import type { SelectNotice } from './useApplySelect';

import { Banner, Button } from '../ui';

/**
 * The result of select-to-edit on the entry screen: found is only announced (the selection itself shows it), not
 * found is a banner the editor can dismiss. Both clear themselves after a few seconds.
 */
export function SelectNoticeBanner({ notice, dismiss }: { notice: SelectNotice | null; dismiss(): void }) {
  if (!notice) return null;
  if (notice.found) return <output className="sr-only">{notice.text}</output>;
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Banner is a component; `role` sets its live region
    <Banner tone="unsaved" role="status" action={<Button onClick={dismiss}>OK</Button>}>
      {notice.text}
    </Banner>
  );
}
