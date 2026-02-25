import { authenticate } from "../shopify.server";

const LOCATION_PINCODES = {
  "88352981234": ["110001", "110002", "110003", "122001", "122002", "201301"],
  "88353014002": ["560001", "560002", "560003", "560004", "560008", "560009", "560010", "560011", "560017", "560038", "560041", "560043", "560068", "560085", "560103"]
};

export const loader = async ({ request }) => {
  try {
    const { admin } = await authenticate.public.appProxy(request);

    const url = new URL(request.url);
    const sku = url.searchParams.get("sku");
    const pincode = url.searchParams.get("pincode");

    if (!sku || !pincode) {
      return new Response(
        JSON.stringify({ error: "SKU and Pincode are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // STEP 1: Match pincode to location
    const matchedLocationId = Object.keys(LOCATION_PINCODES).find((locationId) =>
      LOCATION_PINCODES[locationId].includes(pincode)
    );

    if (!matchedLocationId) {
      return new Response(
        JSON.stringify({ error: "Delivery not available for this pincode" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // STEP 2: Find variant by SKU
    const variantResponse = await admin.graphql(
      `#graphql
      query getProductBySku($sku: String!) {
        productVariants(first: 1, query: $sku) {
          edges {
            node {
              id
              sku
              product {
                id
                title
                handle
              }
            }
          }
        }
      }`,
      { variables: { sku: `sku:${sku}` } }
    );

    const variantJson = await variantResponse.json();

    if (variantJson.data.productVariants.edges.length === 0) {
      return new Response(
        JSON.stringify({ error: `No product found with SKU: ${sku}` }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const variant = variantJson.data.productVariants.edges[0].node;

    // STEP 3: Get inventory levels
    const inventoryResponse = await admin.graphql(
      `#graphql
      query getInventory($id: ID!) {
        productVariant(id: $id) {
          id
          sku
          inventoryItem {
            id
            inventoryLevels(first: 50) {
              edges {
                node {
                  location {
                    id
                    name
                  }
                  quantities(names: ["available"]) {
                    name
                    quantity
                  }
                }
              }
            }
          }
        }
      }`,
      { variables: { id: variant.id } }
    );

    const inventoryJson = await inventoryResponse.json();
    const inventoryLevels =
      inventoryJson.data.productVariant.inventoryItem.inventoryLevels.edges;

    // STEP 4: Match to location
    let matchedInventory = null;

    inventoryLevels.forEach((edge) => {
      const locationId = edge.node.location.id.split("/").pop();

      if (locationId === matchedLocationId) {
        const availableQty =
          edge.node.quantities.find((q) => q.name === "available")?.quantity ?? 0;

        matchedInventory = {
          locationId,
          locationName: edge.node.location.name,
          quantity: availableQty,
        };
      }
    });

    if (!matchedInventory) {
      return new Response(
        JSON.stringify({ error: "Product not stocked in this warehouse" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (matchedInventory.quantity <= 0) {
      return new Response(
        JSON.stringify({ error: "Out of stock for this pincode" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // STEP 5: Return success
      return new Response(
        JSON.stringify({
          available: true,
          location: matchedInventory.locationName,
          quantity: matchedInventory.quantity,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

  } catch (error) {
    console.error("APP PROXY ERROR:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};