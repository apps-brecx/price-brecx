import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Product, Paginated } from "@fbm/shared";
import { api } from "../lib/api";
import { dateShort } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import "./Products.css";

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
    mutationFn: (id: string) => api.del(`/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["products"] }),
  });

  const data = query.data;

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Group SKUs into products for unified pricing"
        actions={
          <button
            className="btn btn-primary"
            onClick={() => setCreateOpen(true)}
          >
            + New product
          </button>
        }
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No products yet"
          message="Create a product to group related SKUs together."
          action={
            <button
              className="btn btn-primary"
              onClick={() => setCreateOpen(true)}
            >
              + New product
            </button>
          }
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th className="right"># SKUs</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td className="prod-name">{p.name}</td>
                  <td className="prod-desc muted">
                    {p.description || "—"}
                  </td>
                  <td className="right">{p.skuIds.length}</td>
                  <td>{dateShort(p.createdAt)}</td>
                  <td className="right">
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(p.id)}
                    >
                      Delete
                    </button>
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
              disabled={createMut.isPending || !draft.name}
              onClick={() =>
                createMut.mutate({
                  name: draft.name,
                  description: draft.description || undefined,
                  skuIds: [],
                })
              }
            >
              {createMut.isPending ? "Saving…" : "Create"}
            </button>
          </>
        }
      >
        <div className="field">
          <label>Name</label>
          <input
            className="input"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Description</label>
          <input
            className="input"
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
          />
        </div>
      </Modal>
    </div>
  );
}
