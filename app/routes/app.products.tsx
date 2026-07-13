import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";

interface ProductNode {
  id: string;
  title: string;
  status: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(`
    query {
      products(first: 20) {
        nodes {
          id
          title
          status
        }
      }
    }
  `);

  const data = await response.json();

  return {
    products: data.data.products.nodes as ProductNode[],
  };
};

export default function ProductsPage() {
  const { products } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Products">
      <s-section>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          {products.map((product) => (
            <div
              key={product.id}
              style={{
                padding: "12px",
                borderBottom: "1px solid #ddd",
              }}
            >
              <strong>{product.title}</strong>
              <br />
              Status: {product.status}
            </div>
          ))}
        </s-box>
      </s-section>
    </s-page>
  );
}