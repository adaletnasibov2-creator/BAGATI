import assert from "node:assert/strict";
import test from "node:test";
import { categoriesWithOtherLast } from "../lib/category-order";

test("Digər is last regardless of its original position while other categories retain their order", () => {
  const categories = [
    { id: "other", name: "Digər" },
    { id: "accessories", name: "Aksesuarlar" },
    { id: "beauty", name: "Gözəllik" },
    { id: "clothing", name: "Geyim" },
  ];

  assert.deepEqual(
    categoriesWithOtherLast(categories).map(({ id }) => id),
    ["accessories", "beauty", "clothing", "other"],
  );
});

test("category order is unchanged when Digər is absent", () => {
  const categories = [{ name: "Geyim" }, { name: "Aksesuarlar" }];
  assert.deepEqual(categoriesWithOtherLast(categories), categories);
});
