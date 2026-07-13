import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  console.log(JSON.stringify(payload, null, 2));

  // GDPR compliance: Retrieve and return customer personal data to Shopify here.
  // The payload contains customer and shop details for the data request.

  return new Response();
};
