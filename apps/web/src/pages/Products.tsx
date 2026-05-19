import "./Products.css";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Product, Paginated } from "@fbm/shared";
import { api } from "../lib/api";
import { date } from "../lib/format";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";

interface ProductDraft {
  name: string;
  description: string;
}

const emptyDraft: ProductDraft = { name: "", description: "" };

export function Products() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft);

  const query = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get<Paginated<Product>>("/products"),
  });

  const createMut = useMutation({
    mutationFn: (body: { name: string; description?: string; skuIds: string[] }) =>
      api.post<Product>("/products", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setCreateOpen(false);
      setDraft(emptyDraft);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  function openCreate() {
    setDraft(emptyDraft);
    setCreateOpen(true);
  }

  function submitCreate() {
    const name = draft.name.trim();
    if (!name) return;
    createMut.mutate({
      name,
      description: draft.description.trim() || undefined,
      skuIds: [],
    });
  }

  function confirmDelete(p: Product) {
    if (window.confirm(`Delete product "${p.name}"? This cannot be undone.`)) {
      deleteMut.mutate(p.id);
    }
  }

  const data = query.data;
  const items = data?.items ?? [];

  return (
    <div>
      {/* Header with action button */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 20,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              fontWeight: 500,
            }}
          >
            Group SKUs into products for unified base pricing.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New product
          </button>
        </div>
      </div>

      {/* Products table */}
      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : items.length === 0 ? (
        <EmptyState
          title="No products yet"
          message="Create a product to group related SKUs together."
          action={
            <button className="btn btn-primary" onClick={openCreate}>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{ marginRight: 6, verticalAlign: "-1px" }}
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New product
            </button>
          }
        />
      ) : (
        <div className="card card-table-wrap" style={{ padding: 0 }}>
          <table className="products-table">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 130, textAlign: "right" }}>SKUs</th>
                <th style={{ width: 180 }}>Created</th>
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="prod-name">{p.name}</div>
                    {p.description && (
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--text-3)",
                          marginTop: 3,
                        }}
                      >
                        {p.description}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className="prod-sku">{p.skuIds.length}</span>
                  </td>
                  <td>
                    <span style={{ color: "var(--text-2)" }}>
                      {date(p.createdAt)}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div
                      className="prod-delete"
                      title="Delete product"
                      role="button"
                      aria-label={`Delete ${p.name}`}
                      onClick={() => confirmDelete(p)}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={createOpen}
        title="New product"
        subtitle="Group related SKUs under a single product."
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={createMut.isPending || !draft.name.trim()}
              onClick={submitCreate}
            >
              {createMut.isPending ? "Creating…" : "Create product"}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            Name <span className="req">*</span>
          </label>
          <input
            className="form-control"
            value={draft.name}
            autoFocus
            placeholder="e.g. Syruvia Vanilla Coffee Syrup"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
            }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <textarea
            className="form-control"
            rows={3}
            value={draft.description}
            placeholder="Optional notes about this product."
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
          <div className="form-help">
            SKUs can be linked to this product after it is created.
          </div>
        </div>
        {createMut.isError && (
          <div className="form-help" style={{ color: "var(--danger-fg)" }}>
            Failed to create product. Please try again.
          </div>
        )}
      </Modal>
    </div>
  );
}
