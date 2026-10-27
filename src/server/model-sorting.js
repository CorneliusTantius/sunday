const modelNameCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export function sortModelsAlphabetically(models) {
  return [...models].sort((left, right) => {
    const byName = modelNameCollator.compare(left.name || left.id, right.name || right.id);
    if (byName) return byName;
    const byProvider = modelNameCollator.compare(left.providerName || left.provider || '', right.providerName || right.provider || '');
    if (byProvider) return byProvider;
    const byMode = modelNameCollator.compare(left.mode || '', right.mode || '');
    if (byMode) return byMode;
    return modelNameCollator.compare(left.id, right.id);
  });
}
