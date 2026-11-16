import { reportIssues } from './issues';

import { EditletError } from '../../../core/issues';
import { writeTypes } from '../../../node/project';

try {
  process.stdout.write(`${await writeTypes(process.argv[2] ?? process.cwd())}\n`);
} catch (error) {
  if (error instanceof EditletError) reportIssues(error.issues);
  else throw error;
}
