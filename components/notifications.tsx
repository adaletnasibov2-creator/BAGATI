import { EmptyState } from "@/components/state-panel";
type NotificationItem = { id: string; title: string; body: string; createdAt: Date };
export function Notifications({ items }: { items: NotificationItem[] }) { return items.length ? <ul className="divide-y divide-[#e9e6df] rounded-2xl border border-[#e9e6df] bg-white">{items.map(item => <li key={item.id} className="p-5"><p className="font-medium">{item.title}</p><p className="mt-1 text-sm text-slate-600">{item.body}</p></li>)}</ul> : <EmptyState title="Bildiriş yoxdur" detail="Yeni bildirişlər burada görünəcək."/>; }
