import { copyFixture } from './fixture';
import { startLocalHost } from './localServer';

const root = process.env.EDITLET_ROOT ?? (await copyFixture());
const { origin } = await startLocalHost({ root, port: Number(process.env.PORT ?? 5180) });
process.stdout.write(`Editlet dev host: ${origin}/  (editor: ${origin}/?editlet)\n`);
process.stdout.write(`Content root: ${root}\n`);
