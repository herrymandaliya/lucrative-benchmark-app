import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(JSON.stringify(payload, null, 2));

  // GDPR compliance: Erase all store data (e.g. settings, cached info) from your database here.
  // The payload contains details of the shop that was redacted.

  return new Response();
};
