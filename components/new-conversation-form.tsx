"use client";

import { useRouter } from "next/navigation";
import { MessageComposer, messagingErrorText, postMessagingJson } from "@/components/message-composer";
import { customerMessagesApi, customerThreadHref } from "@/lib/messaging-client";

/** First message to a store; on success the thread opens. */
export function NewConversationForm({ storeId, context, contextId, allowContactDetails }: { storeId: string; context: "PRODUCT" | "ORDER" | "STORE"; contextId: string | null; allowContactDetails: boolean }) {
  const router = useRouter();
  return <MessageComposer
    allowContactDetails={allowContactDetails}
    placeholder={context === "PRODUCT" ? "Məhsul haqqında sualınızı yazın…" : context === "ORDER" ? "Sifarişlə bağlı sualınızı yazın…" : "Mağazaya sualınızı yazın…"}
    onSend={async (body) => {
      const response = await postMessagingJson(customerMessagesApi, { storeId, context, contextId, body });
      if (!response.ok) return messagingErrorText(response);
      const data = await response.json() as { conversationId: string };
      router.replace(customerThreadHref(data.conversationId));
      return null;
    }}
  />;
}
