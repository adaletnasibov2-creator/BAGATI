type NamedCategory = { name: string };

export function categoriesWithOtherLast<T extends NamedCategory>(categories: readonly T[]): T[] {
  return [...categories].sort((left, right) => {
    const leftIsOther = left.name.trim().toLowerCase() === "digər";
    const rightIsOther = right.name.trim().toLowerCase() === "digər";
    return Number(leftIsOther) - Number(rightIsOther);
  });
}
