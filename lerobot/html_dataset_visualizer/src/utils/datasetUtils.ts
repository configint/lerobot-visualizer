export function getDatasetDisplayName(repoId: string): string {
  const path = repoId.replace(/~/g, "/");
  const match = path.match(
    /^configint\/data-builder\/([^/]+)\/data\/([^/]+)\/?$/,
  );
  if (match) {
    return `${match[1]}/${match[2]}`;
  }
  // fallback: remove trailing tilde and show as-is replacing ~ with /
  return repoId.replace(/~/g, "/");
}
