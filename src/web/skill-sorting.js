export function sortSkillsAlphabetically(skills) {
  return [...skills].sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  }));
}
