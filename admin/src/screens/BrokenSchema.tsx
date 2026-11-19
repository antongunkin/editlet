import { BrokenSchemaView } from './BrokenSchemaView';

import type { Issue } from '../../../core/issues';
import { useCopy } from '../model/useCopy';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { useScreenChrome } from '../window/chrome';
import { GateFrame } from '../window/GateFrame';

/** `<file>: <path>: <message>`, leaving out the empty parts. */
export function issueText(issue: Issue): string {
  const where = [issue.file, issue.path].filter(Boolean).join(': ');
  return where ? `${where}: ${issue.message}` : issue.message;
}

const DEFAULT_FILE = 'cms/schema.json';

/** The prompt *Copy fix prompt* copies: the file, what is wrong with it, and to plan before changing. */
export function fixPrompt(issues: Issue[]): string {
  const file = issues.find((i) => i.file)?.file ?? DEFAULT_FILE;
  return [
    `${file} does not load. Fix these problems:`,
    ...issues.map((issue) => `- ${issueText(issue)}`),
    'Show me the plan before changing anything.',
  ].join('\n');
}

/**
 * Why the schema does not load: the issues and one way on, copying a prompt for the coding agent. `status`: the shell
 * exists (the dev server or GitHub), so the bar shows its status line; the full page of local mode has none.
 */
export function BrokenSchemaScreen({ issues, status = false }: { issues: Issue[]; status?: boolean }) {
  const chrome = useScreenChrome();
  const { copy, state } = useCopy();
  const copied = state === 'copied';
  return (
    <BrokenSchemaView
      actions={chrome.windowActions}
      banners={chrome.banners}
      file={issues.find((i) => i.file)?.file ?? DEFAULT_FILE}
      issues={issues.map(issueText)}
      status={status ? chrome.status : undefined}
      notice={copied ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      cta={
        <Button
          variant="primary"
          size="lg"
          full
          icon={<Icon name={copied ? 'check' : 'copy'} size={20} />}
          onClick={() => void copy(fixPrompt(issues))}
        >
          {copied ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy fix prompt'}
        </Button>
      }
    />
  );
}

/** The schema on disk does not load and nothing else can be shown (local mode before the shell): a full window. */
export function BrokenSchema({ issues }: { issues: Issue[] }) {
  return (
    <GateFrame>
      <BrokenSchemaScreen issues={issues} />
    </GateFrame>
  );
}
