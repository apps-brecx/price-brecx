import { useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import type { Sku, Paginated } from "@fbm/shared";
import { CHANNEL_LABELS } from "@fbm/shared";
import { api, qs } from "../lib/api";
import { money, num } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Loading, ErrorState, EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import "./PricingV2.css";

const PAGE_SIZE = 50;

function margin(s: Sku): string {
  if (s.basePrice && s.cost) {
    return (((s.basePrice - s.cost) / s.basePrice) * 100).toFixed(1) + "%";
  }
  return "—";
}

export function PricingV2() {
  const qc = useQueryClient();
  const [priceFor, setPriceFor] = useState<Sku | null>(null);

  const query = useQuery({
    queryKey: ["skus", { pageSize: PAGE_SIZE }],
    queryFn: () =>
      api.get<Paginated<Sku>>(`/skus${qs({ pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const priceMut = useMutation({
    mutationFn: (vars: { id: string; price: number }) =>
      api.patch(`/skus/${vars.id}`, { price: vars.price }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skus"] });
      setPriceFor(null);
    },
  });

  const data = query.data;

  return (
    <div>
      <PageHeader
        title="Pricing Workspace"
        subtitle="Review margins and adjust prices across every listing"
      />

      {query.isLoading ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="No products to price"
          message="Add SKUs or connect a marketplace to start managing prices."
        />
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Product</th>
                <th>Channel</th>
                <th className="right">Current Price</th>
                <th className="right">Base Price</th>
                <th className="right">Cost</th>
                <th className="right">Margin</th>
                <th className="right">Stock</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="pv2-title">{s.title}</div>
                    <div className="pv2-sku mono">{s.sku}</div>
                  </td>
                  <td>
                    <span className="badge badge-neutral">
                      {CHANNEL_LABELS[s.channel]}
                    </span>
                  </td>
                  <td className="right strong">{money(s.price)}</td>
                  <td className="right">{money(s.basePrice)}</td>
                  <td className="right">{money(s.cost)}</td>
                  <td className="right">{margin(s)}</td>
                  <td className="right">{num(s.stock)}</td>
                  <td className="right">
                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => setPriceFor(s)}
                    >
                      Set price
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <SetPriceModal
        sku={priceFor}
        onClose={() => setPriceFor(null)}
        onSubmit={(price) =>
          priceFor && priceMut.mutate({ id: priceFor.id, price })
        }
        busy={priceMut.isPending}
      />
    </div>
  );
}

function SetPriceModal({
  sku,
  onClose,
  onSubmit,
  busy,
}: {
  sku: Sku | null;
  onClose: () => void;
  onSubmit: (price: number) => void;
  busy: boolean;
}) {
  const [price, setPrice] = useState(0);
  return (
    <Modal
      open={!!sku}
      title={sku ? `Set price · ${sku.sku}` : ""}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !price}
            onClick={() => onSubmit(price)}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 12 }}>
        Current price {sku ? money(sku.price) : ""}.
      </p>
      <div className="field">
        <label>New price</label>
        <input
          className="input"
          type="number"
          step="0.01"
          onChange={(e) => setPrice(Number(e.target.value))}
        />
      </div>
    </Modal>
  );
}
