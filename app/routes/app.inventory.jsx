import { useState } from "react";
import { useFetcher } from "react-router";
import { authenticate } from "../shopify.server";

/* -----------------------------
   PINCODE → LOCATION MAPPING
--------------------------------*/
const LOCATION_PINCODES = {
  "88352981234": ["110001", "110002", "110003","122001", "122002", "201301"], // Gurugram
  "88353014002": ["560001", "560002", "560003", "560004", "560008", "560009", "560010", "560011", "560017", "560038", "560041", "560043", "560068", "560085", "560103"]  // Banglore
};

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const searchQuery = formData.get("searchQuery"); // SKU
  const pincode = formData.get("pincode");

  if (!searchQuery || !pincode) {
    return { error: "SKU and Pincode are required" };
  }

  /* -----------------------------
     FIND MATCHED LOCATION
  --------------------------------*/
  const matchedLocationId = Object.keys(LOCATION_PINCODES).find((locationId) =>
    LOCATION_PINCODES[locationId].includes(pincode)
  );

  if (!matchedLocationId) {
    return { error: "Delivery not available for this pincode" };
  }

  try {
    /* -----------------------------
       STEP 1: FIND VARIANT BY SKU
    --------------------------------*/
    const response = await admin.graphql(
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
      {
        variables: {
          sku: `sku:${searchQuery}`,
        },
      },
    );

    const responseJson = await response.json();

    if (responseJson.data.productVariants.edges.length === 0) {
      return { error: `No product found with SKU: ${searchQuery}` };
    }

    const variant = responseJson.data.productVariants.edges[0].node;

    /* -----------------------------
       STEP 2: GET INVENTORY LEVELS
    --------------------------------*/
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
      {
        variables: {
          id: variant.id,
        },
      },
    );

    const inventoryJson = await inventoryResponse.json();
    const inventoryLevels =
      inventoryJson.data.productVariant.inventoryItem.inventoryLevels.edges;

    /* -----------------------------
       STEP 3: MATCH LOCATION ONLY
    --------------------------------*/
    let matchedInventory = null;

    inventoryLevels.forEach((edge) => {
      const locationId = edge.node.location.id.split("/").pop();

      if (locationId === matchedLocationId) {
        const availableQty =
          edge.node.quantities.find((q) => q.name === "available")?.quantity ?? 0;

        matchedInventory = {
          sku: variant.sku,
          locationId: locationId,
          locationName: edge.node.location.name,
          quantity: availableQty,
        };
      }
    });

    if (!matchedInventory) {
      return { error: "Product not stocked in this warehouse" };
    }

    if (matchedInventory.quantity <= 0) {
      return { error: "Out of stock for this pincode" };
    }

    return {
      success: true,
      product: variant.product,
      inventory: matchedInventory,
    };
  } catch (error) {
    console.error("Inventory error:", error);
    return { error: "Failed to fetch inventory" };
  }
};

/* =========================================================
   REACT COMPONENT
========================================================= */

export default function InventoryPage() {
  const fetcher = useFetcher();
  const isLoading = ["loading", "submitting"].includes(fetcher.state);
  const data = fetcher.data;

  return (
    <s-page heading="Warehouse Inventory Lookup">
      <s-section heading="Check Delivery Availability">
        <s-paragraph>
            "88352981234": ["110001", "110002", "110003", "122001", "122002", "122003"],
            "88353014002": ["560001", "560002", "560003", "560004", "560008", "560009"]
        </s-paragraph>
        <s-card>
          <fetcher.Form
            method="POST"
            style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}
          >
            <div style={{ flex: 2 }}>
              <label>Enter SKU</label>
              <input
                type="text"
                name="searchQuery"
                placeholder="e.g. SKU123"
                required
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>

            <div style={{ flex: 1 }}>
              <label>Enter Pincode</label>
              <input
                type="text"
                name="pincode"
                placeholder="e.g. 122001"
                required
                style={{ width: "100%", padding: "0.5rem" }}
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              style={{
                padding: "0.5rem 1rem",
                alignSelf: "flex-end",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Checking..." : "Check"}
            </button>
          </fetcher.Form>
        </s-card>
      </s-section>

      {data?.error && (
        <s-section heading="Result">
          <s-card>
            <s-paragraph style={{ color: "#d32f2f" }}>
              {data.error}
            </s-paragraph>
          </s-card>
        </s-section>
      )}

      {data?.success && (
        <s-section heading="Delivery Available">
          <s-card>
            <s-paragraph>
              <strong>Product:</strong> {data.product.title}
            </s-paragraph>
            <s-paragraph>
              <strong>Warehouse:</strong> {data.inventory.locationName}
            </s-paragraph>
            <s-paragraph>
              <strong>Location ID:</strong> {data.inventory.locationId}
            </s-paragraph>
            <s-paragraph>
              <strong>Available Quantity:</strong> {data.inventory.quantity}
            </s-paragraph>
          </s-card>
        </s-section>
      )}
    </s-page>
  );
}