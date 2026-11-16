export interface Issue {
  file?: string;
  /** Dot path inside the file ('title', 'tags.2'); '' means the whole file. */
  path: string;
  message: string;
}

export class EditletError extends Error {
  issues: Issue[];

  constructor(issues: Issue[], message?: string) {
    super(message ?? issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '));
    this.name = 'EditletError';
    this.issues = issues;
  }
}
