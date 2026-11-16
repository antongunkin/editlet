import { reportIssues } from './issues';

import { EditletError } from '../../../core/issues';
import { readProject, validateProject } from '../../../node/project';

const root = process.argv[2] ?? process.cwd();
try {
  const issues = await validateProject(root);
  if (issues.length > 0) reportIssues(issues);
  else process.stdout.write(`✓ ${(await readProject(root)).entries.length} entries valid\n`);
} catch (error) {
  if (error instanceof EditletError) reportIssues(error.issues);
  else throw error;
}
