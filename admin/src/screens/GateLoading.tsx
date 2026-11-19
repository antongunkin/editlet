import { BottomBar } from '../ui/parts/bottom-bar';
import { Header } from '../ui/parts/header';
import { Icon } from '../ui/primitives/icon';
import { useScreenChrome } from '../window/chrome';
import { GateFrame } from '../window/GateFrame';

/**
 * The window's frame with a status: before the shell exists, and in the shell until the schema loads. `loading={false}`
 * (the file list failed before there was a schema): only the header and the window's banners, which say why. `status`
 * (in the shell): the bottom bar with the status line, so the branch chip is there to leave a branch that does not load.
 */
export function Loading({ loading = true, status = false }: { loading?: boolean; status?: boolean }) {
  const chrome = useScreenChrome();
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header as="span" title="Editlet" actions={chrome.windowActions} className="shrink-0" />
      {chrome.banners}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        {loading ? (
          <output className="m-0 flex items-center gap-2 text-base text-tray-muted-foreground">
            <Icon name="loader" size={16} className="animate-spin motion-reduce:animate-none" />
            Loading…
          </output>
        ) : null}
      </div>
      {status ? <BottomBar status={chrome.status} className="shrink-0" /> : null}
    </section>
  );
}

/** Before the shell exists (finding the mode, checking the account): the window's frame with a status. */
export function GateLoading() {
  return (
    <GateFrame>
      <Loading />
    </GateFrame>
  );
}
