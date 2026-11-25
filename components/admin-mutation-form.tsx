"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirmDialog } from "@/components/admin-ui/confirm-dialog";

export type AdminField={name:string;label:string;type?:"text"|"email"|"password"|"url"|"number"|"date"|"textarea"|"select"|"checkbox"|"hidden";required?:boolean;value?:string|number|boolean|null;placeholder?:string;options?:{value:string;label:string}[];min?:string;max?:string;step?:string};

/**
 * Generic admin write form (POST/PATCH/DELETE to /api/admin/<resource>). Confirmations (static `confirmMessage` or
 * `confirmWhen`, computed from the values about to be sent) use the accessible ConfirmDialog, not window.confirm.
 * The rendered markup is unchanged from the previous version.
 */
export default function AdminMutationForm({resource,method="POST",fields,button="Yadda saxla",confirmMessage,confirmWhen,className="",onSuccess}:{resource:string;method?:"POST"|"PATCH"|"DELETE";fields:AdminField[];button?:string;confirmMessage?:string;/** Confirmation computed from the values about to be sent (null = no question). */confirmWhen?:(payload:Record<string,unknown>)=>string|null;className?:string;onSuccess?:()=>void}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const {confirm,dialog}=useConfirmDialog();
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const formElement=event.currentTarget;
    if(confirmMessage&&!(await confirm({message:confirmMessage,danger:method==="DELETE"})))return;
    setBusy(true);setError("");setSuccess("");
    const form=new FormData(formElement);
    const payload:Record<string,unknown>=Object.fromEntries(form.entries());
    for(const field of fields){
      if(field.type==="checkbox")payload[field.name]=form.get(field.name)==="on";
      if(field.type==="number"&&payload[field.name]!==undefined)payload[field.name]=String(payload[field.name])===""?null:Number(payload[field.name]);
      if((field.type==="text"||field.type==="url"||field.type==="email"||field.type==="password"||field.type==="textarea"||field.type==="select"||field.type==="date")&&payload[field.name]==="")payload[field.name]=null;
    }
    const dynamicConfirm=confirmWhen?.(payload);
    if(dynamicConfirm&&!(await confirm({message:dynamicConfirm}))){setBusy(false);return;}
    try{
      const response=await fetch(`/api/admin/${resource}`,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Əməliyyat tamamlanmadı");
      setSuccess(result.message||"Dəyişiklik yadda saxlanıldı.");onSuccess?.();router.refresh();
    }catch(reason){setError(reason instanceof Error?reason.message:"Əməliyyat tamamlanmadı")}
    finally{setBusy(false)}
  }
  const input="mt-1 w-full min-h-11 rounded-control border border-line-strong bg-white px-3 py-2.5 text-sm text-fg transition-colors hover:border-primary focus:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus motion-reduce:transition-none";
  return <form onSubmit={submit} className={`grid gap-3 ${className}`}>{fields.map(field=>field.type==="hidden"?<input key={field.name} type="hidden" name={field.name} value={String(field.value??"")}/>:<label key={field.name} className={`grid gap-1 text-sm font-medium text-fg-body ${field.type==="checkbox"?"flex items-center gap-2":""}`}>{field.type==="checkbox"?<><input type="checkbox" name={field.name} defaultChecked={Boolean(field.value)} className="h-4 w-4 accent-primary"/>{field.label}</>:<>{field.label}{field.type==="textarea"?<textarea name={field.name} required={field.required} defaultValue={field.value==null?"":String(field.value)} placeholder={field.placeholder} className={input}/>:field.type==="select"?<select name={field.name} required={field.required} defaultValue={field.value==null?"":String(field.value)} className={input}><option value="">Seçin</option>{field.options?.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select>:<input name={field.name} type={field.type||"text"} required={field.required} min={field.min} max={field.max} step={field.step} defaultValue={field.value==null?"":String(field.value)} placeholder={field.placeholder} className={input}/>}</>}</label>)}{error&&<p role="alert" className="rounded-control bg-red-50 p-3 text-sm text-red-700">{error}</p>}{success&&<p role="status" className="rounded-control bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}<button disabled={busy} className="inline-flex min-h-10 w-fit items-center rounded-control bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-subtle transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 motion-reduce:transition-none">{busy?"Gözləyin…":button}</button>{dialog}</form>}
