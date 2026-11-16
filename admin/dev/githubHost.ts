import { startGitHubHost } from './githubServer';

const { origin, fake } = await startGitHubHost({ port: Number(process.env.PORT ?? 5181) });
const { owner, repo } = fake.state;
process.stdout.write(`Editlet GitHub host: ${origin}/  (editor: ${origin}/?editlet)\n`);
process.stdout.write(`Fake GitHub: ${owner}/${repo}, base branch main. Sign-in needs no account.\n`);
