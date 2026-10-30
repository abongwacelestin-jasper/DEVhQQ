export function repoSlug(name: string) {
  return name.replace('/', '--');
}

export function repoFromSlug(slug: string) {
  return slug.replace('--', '/');
}
