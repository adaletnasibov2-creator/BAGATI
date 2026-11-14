/**
 * Shared pieces of the admin section pages (moved unchanged from app/admin/[...section]/page.tsx; Table is now
 * generic instead of any). Rendered markup is identical.
 */
import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import type { Role } from "@prisma/client";
import AdminMutationForm from "@/components/admin-mutation-form";
import AdminStoreActivationAction from "@/components/admin-store-activation-action";

/** Everything a section renderer needs from the catch-all router. */
export type SectionContext = {
  admin: { id: string; email: string; role: Role };
  parts: string[];
  route: string;
  sp: Record<string, string | undefined>;
  q: string;
  page: number;
  take: number;
  skip: number;
  pageQuery: string;
  shell: (content: ReactNode) => ReactElement;
};

export const card="rounded-2xl border border-[#e7e3d9] bg-white p-5";
export const storeStatuses=["DRAFT","PENDING_REVIEW","ACTIVE","SUSPENDED","REJECTED"];
export const orderStatuses=["PENDING","NEW","CONFIRMED","PREPARING","READY","HANDED_TO_COURIER","PROCESSING","SHIPPED","DELIVERED","CANCELLED","RETURNED"];
export const productStatuses=["DRAFT","ACTIVE","ARCHIVED"];

export function Header({title,detail}:{title:string;detail?:string}){return <div className="mb-6"><p className="text-xs font-semibold uppercase tracking-[.18em] text-[#9b7840]">BAGATI · ADMIN</p><h1 className="mt-2 text-3xl font-semibold text-[#0d1b2a]">{title}</h1>{detail&&<p className="mt-2 text-sm text-slate-500">{detail}</p>}</div>}
export function formatStoreCityName(city?:{name?:string|null}|null){return city?.name || "Şəhər yoxdur";}
export function formatSubscriptionSummary(subscription?:{status?:string|null;plan?:{name?:string|null}|null}|null){if(!subscription)return "Abunəlik yoxdur"; if(subscription.plan?.name) return `${subscription.plan.name} · ${subscription.status || "status yoxdur"}`; return subscription.status || "Abunəlik yoxdur";}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped callers (db:any) keep working until each section is typed
export function Table<T = any>({columns,rows,empty="Qeyd yoxdur."}:{columns:{label:string;cell:(row:NoInfer<T>)=>ReactNode}[];rows:T[];empty?:string}){if(!rows.length)return <div className={card}><p className="text-sm text-slate-500">{empty}</p></div>;return <div className="overflow-x-auto rounded-2xl border border-[#e7e3d9] bg-white"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[#f8f7f4] text-xs uppercase tracking-wide text-slate-500"><tr>{columns.map(c=><th key={c.label} className="px-4 py-3 font-medium">{c.label}</th>)}</tr></thead><tbody className="divide-y divide-[#eeeae2]">{rows.map((row,index)=><tr key={(row as {id?:string}).id||index} className="align-top">{columns.map(c=><td key={c.label} className="px-4 py-3.5">{c.cell(row)}</td>)}</tr>)}</tbody></table></div>}
export function Pager({path,page,total,query}:{path:string;page:number;total:number;query:string}){const pages=Math.max(1,Math.ceil(total/25));if(pages<2)return <p className="mt-3 text-xs text-slate-500">{total} nəticə</p>;const href=(n:number)=>`${path}?${query?`${query}&`:""}page=${n}`;return <div className="mt-4 flex items-center justify-between text-sm"><span className="text-slate-500">Səhifə {page} / {pages} · {total} nəticə</span><div className="flex gap-2">{page>1&&<Link className="rounded-lg border bg-white px-3 py-2" href={href(page-1)}>Əvvəlki</Link>}{page<pages&&<Link className="rounded-lg border bg-white px-3 py-2" href={href(page+1)}>Növbəti</Link>}</div></div>}
export function StatusForm({resource,id,status,options,button="Yenilə",confirm,isActive=false,legalInfoApproved=false}:{resource:string;id:string;status:string;options:readonly string[];button?:string;confirm?:string;isActive?:boolean;legalInfoApproved?:boolean}){if(resource==="stores")return <AdminStoreActivationAction storeId={id} status={status} isActive={isActive} legalInfoApproved={legalInfoApproved}/>;if(resource==="orders")return <div><p className="mb-2 text-sm text-slate-600">Cari status: {status}</p>{options.length?<AdminMutationForm resource={resource} method="PATCH" className="min-w-40" button={button} confirmMessage={confirm} fields={[{name:"id",label:"",type:"hidden",value:id},{name:"status",label:"İcazə verilən növbəti status",type:"select",required:true,options:options.map(s=>({value:s,label:s}))}]}/>:<p className="text-sm text-slate-500">Bu sifariş üçün vahid icazə verilən status keçidi yoxdur.</p>}</div>;return <AdminMutationForm resource={resource} method="PATCH" className="min-w-40" button={button} confirmMessage={confirm} fields={[{name:"id",label:"",type:"hidden",value:id},{name:"status",label:"Status",type:"select",value:status,required:true,options:options.map(s=>({value:s,label:s}))}]}/>}
