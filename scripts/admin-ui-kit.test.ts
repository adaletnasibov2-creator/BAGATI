/**
 * Admin UI kit (components/admin-ui/*): rendering, accessibility attributes and the window.confirm replacement.
 * No database.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageHeader } from "../components/admin-ui/page-header";
import { Card, Section } from "../components/admin-ui/section";
import { StatusBadge } from "../components/admin-ui/status-badge";
import { EmptyState } from "../components/admin-ui/empty-state";
import { StatCard } from "../components/admin-ui/stat-card";
import { DataTable } from "../components/admin-ui/data-table";
import { FormField } from "../components/admin-ui/form-field";
import { ResultMessage } from "../components/admin-ui/result-message";
import { buttonClass, focusRing } from "../components/admin-ui/styles";

// tsx compiles the components' JSX with the classic runtime, which needs a global React (as in store-public-contact.test.ts).
(globalThis as { React?: typeof React }).React = React;

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const html = (element: React.ReactElement) => renderToStaticMarkup(element);

test("PageHeader: eyebrow, one h1, description and actions", () => {
  const out = html(createElement(PageHeader, { title: "Mağazalar", description: "Təsvir", actions: createElement("a", { href: "/x" }, "Yarat") }));
  assert.match(out, /BAGATI · ADMIN/);
  assert.equal((out.match(/<h1/g) ?? []).length, 1);
  assert.match(out, /<h1[^>]*>Mağazalar<\/h1>/);
  assert.match(out, /Təsvir/);
  assert.match(out, /<a href="\/x">Yarat<\/a>/);
});

test("Section and Card render a heading and content", () => {
  assert.match(html(createElement(Section, { title: "Bölmə", description: "Alt" }, "məzmun")), /<h2[^>]*>Bölmə<\/h2>[\s\S]*Alt[\s\S]*məzmun/);
  assert.match(html(createElement(Card, null, "x")), /rounded-2xl border border-\[#e7e3d9\] bg-white p-5/);
});

test("StatusBadge shows its text (colour is not the only signal)", () => {
  const out = html(createElement(StatusBadge, { tone: "success", children: "Aktiv" }));
  assert.match(out, />Aktiv<\/span>/);
  assert.match(out, /bg-emerald-50/);
});

test("DataTable: one table with labelled cells for the mobile card layout; empty → EmptyState", () => {
  type Row = { id: string; name: string; total: string };
  const out = html(createElement(DataTable<Row>, {
    rows: [{ id: "1", name: "A", total: "12,50 AZN" }, { id: "2", name: "B", total: "3,00 AZN" }],
    rowKey: (row) => row.id,
    caption: "Sifarişlər",
    columns: [{ label: "Ad", cell: (row) => row.name }, { label: "Cəmi", cell: (row) => row.total, numeric: true }],
  }));
  assert.equal((out.match(/<table/g) ?? []).length, 1, "a single DOM (no duplicated rows or forms)");
  assert.match(out, /<caption class="sr-only">Sifarişlər<\/caption>/);
  assert.match(out, /<th scope="col"[^>]*>Ad<\/th>/);
  assert.equal((out.match(/data-label="Cəmi"/g) ?? []).length, 2, "each cell carries its column label");
  assert.match(out, /max-md:before:content-\[attr\(data-label\)\]/, "label shown before the value under 768 px");
  assert.match(out, /max-md:hidden/, "header row hidden on phones");
  const empty = html(createElement(DataTable<Row>, { rows: [], rowKey: (row) => row.id, columns: [], empty: "Sifariş yoxdur." }));
  assert.doesNotMatch(empty, /<table/);
  assert.match(empty, /Sifariş yoxdur\./);
});

test("StatCard links when given href, with a visible focus ring", () => {
  const out = html(createElement(StatCard, { label: "Sifarişlər", value: 3, href: "/admin/orders" }));
  assert.match(out, /<a[^>]*href="\/admin\/orders"/);
  assert.match(out, /focus-visible:outline-2/);
  assert.doesNotMatch(html(createElement(StatCard, { label: "x", value: 1 })), /<a /);
});

test("FormField ties the label to the control and announces errors", () => {
  const out = html(createElement(FormField, { label: "Ad", htmlFor: "name", hint: "İpucu", required: true, children: createElement("input", { id: "name" }) }));
  assert.match(out, /<label for="name"/);
  assert.match(out, /id="name-hint"/);
  const withError = html(createElement(FormField, { label: "Ad", htmlFor: "name", error: "Boş ola bilməz", children: createElement("input", { id: "name" }) }));
  assert.match(withError, /id="name-error" role="alert"/);
});

test("ResultMessage: errors are alerts, other results are status messages", () => {
  assert.match(html(createElement(ResultMessage, { tone: "error", children: "Xəta" })), /role="alert"/);
  assert.match(html(createElement(ResultMessage, { tone: "success", children: "Saxlanıldı" })), /role="status"/);
});

test("buttons have a visible keyboard focus ring", () => {
  for (const variant of ["primary", "secondary", "danger", "ghost"] as const) assert.ok(buttonClass(variant).includes(focusRing), variant);
});

test("ConfirmDialog: native modal dialog, Esc cancels, focus starts on cancel and returns afterwards", () => {
  const source = read("components/admin-ui/confirm-dialog.tsx");
  assert.match(source, /^"use client";/);
  assert.match(source, /<dialog/);
  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /onCancel=\{\(event\) => \{ event\.preventDefault\(\); onClose\(false\); \}\}/);
  assert.match(source, /cancelRef\.current\?\.focus\(\)/);
  assert.match(source, /opener\?\.focus\?\.\(\)/);
  assert.match(source, /aria-labelledby="admin-confirm-title"/);
});

test("no admin component uses window.confirm any more; each uses the dialog and renders it", () => {
  const files = readdirSync(join(root, "components")).filter((name) => /^admin-.*\.tsx$/.test(name));
  const users: string[] = [];
  for (const name of files) {
    const source = read(`components/${name}`);
    assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, ""), /window\.confirm\(/, name);
    if (source.includes("useConfirmDialog()")) {
      users.push(name);
      assert.match(source, /\{dialog\}/, `${name} renders the dialog`);
    }
  }
  assert.deepEqual(users.sort(), [
    "admin-complimentary-manager.tsx", "admin-mutation-form.tsx", "admin-promotion-manager.tsx", "admin-sessions-list.tsx",
    "admin-store-activation-action.tsx", "admin-store-review-actions.tsx", "admin-subscription-manager.tsx", "admin-two-factor-settings.tsx",
  ]);
  const twoFactor = read("components/admin-two-factor-settings.tsx");
  assert.match(twoFactor, /const formElement = event\.currentTarget;\s*if \(!await confirm\(/, "form captured before the await");
  assert.match(twoFactor, /new FormData\(formElement\)/);
  const mutation = read("components/admin-mutation-form.tsx");
  assert.match(mutation, /const formElement=event\.currentTarget;\s*if\(confirmMessage&&!\(await confirm\(\{message:confirmMessage,danger:method==="DELETE"\}\)\)\)return;/);
});
